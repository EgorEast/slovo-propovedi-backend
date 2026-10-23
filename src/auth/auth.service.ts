import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { LessThan, Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user-role.enum';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RefreshResponseDto } from './dto/refresh-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { RevokedRefreshToken } from './entities/revoked-refresh-token.entity';

const BCRYPT_PREFIXES = ['$2a$', '$2b$', '$2y$'];

// Bcrypt hash (cost 10, same as BCRYPT_ROUNDS in UsersService) of a random
// throwaway string. A committed constant is used instead of hashing at module
// load: no startup CPU, no import-time side effect for tests, and the value
// guards nothing — it only burns the same ~bcrypt cost as a real check.
const DUMMY_PASSWORD_HASH =
  '$2b$10$96rsAYi/v./SGUcJ9JHoDOkR8tt0qWivRBwqIG0M6n56i1HBNwHlS';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    @InjectRepository(RevokedRefreshToken)
    private revokedTokensRepository: Repository<RevokedRefreshToken>,
  ) {}

  private get accessSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET environment variable is not set');
    }
    return secret;
  }

  private get refreshSecret(): string {
    const secret = process.env.JWT_REFRESH_SECRET;
    if (!secret) {
      throw new Error('JWT_REFRESH_SECRET environment variable is not set');
    }
    return secret;
  }

  async signIn(username: string, password: string): Promise<AuthResponseDto> {
    const user = await this.usersService.findOneByUsername(username);

    if (!user) {
      // Unknown username must cost the same as a wrong password: without this
      // bcrypt.compare the 401 would return ~immediately and reveal whether
      // the username exists. The result is discarded — the dummy hash never
      // matches.
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      this.logFailedSignIn(username);
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await this.validatePassword(password, user);

    if (!isValid) {
      this.logFailedSignIn(username);
      throw new UnauthorizedException('Invalid credentials');
    }

    // The role lives in the JWT so guards can authorize per-request. email is
    // retained for backwards compatibility with already-issued refresh tokens;
    // it is NOT used for lookup (getProfile re-fetches by id, refresh re-fetches
    // the live user by id). tokenVersion ties the pair to the account's current
    // session version: a password change bumps it and revokes both tokens.
    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    };
    const tokens = await this.generateTokens(payload);

    return {
      ...tokens,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    };
  }

  // Audit trail for brute-force detection. The attempted username is the only
  // credential-adjacent value logged: passwords and tokens must never reach the
  // logs. JSON.stringify escapes quotes/newlines so a crafted username cannot
  // forge log lines. The 401 response stays generic — no user enumeration.
  private logFailedSignIn(username: string): void {
    this.logger.warn(
      `Failed sign-in attempt for username=${JSON.stringify(username)}`,
    );
  }

  async refreshTokens(refreshToken: string): Promise<RefreshResponseDto> {
    let verified: { id: string; exp: number; tokenVersion?: number };

    try {
      verified = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Fast-fail denylist gate: a token killed by logout() or by a previous
    // rotation is dead before we pay for the user re-fetch.
    if (await this.isRevoked(refreshToken)) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    // Re-fetch the LIVE user so a stale or demoted role takes effect on the
    // next access token, and so old refresh tokens (whose payload carried no
    // role) are upgraded to role-bearing ones.
    const user = await this.usersService.findOneById(verified.id);

    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // A password change bumps token_version; a refresh token minted before it
    // is dead even though its signature and expiry are still valid. A missing
    // claim means a pre-versioning token, i.e. version 0.
    if (user.tokenVersion !== (verified.tokenVersion ?? 0)) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    // ROTATION: the presented token is revoked before the fresh pair is
    // signed, so a failed store means no new tokens are ever issued. No
    // separate transaction is needed for the logout-vs-refresh race: the
    // insert itself is the serialization point — UNIQUE(token_hash) +
    // ON CONFLICT DO NOTHING turns a token a concurrent logout/rotation
    // already stored into a no-op, storeRevokedToken reports false, and no
    // sibling pair is minted.
    const stored = await this.storeRevokedToken(
      refreshToken,
      user.id,
      verified.exp,
    );
    if (!stored) {
      throw new UnauthorizedException('Refresh token has been revoked');
    }

    return this.generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });
  }

  // Logout is idempotent: a revoked token resolves with 204, and so does an
  // unusable (invalid/expired) token — there is nothing left to revoke.
  async logout(refreshToken: string): Promise<void> {
    let verified: { id: string; exp: number };

    try {
      verified = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      return;
    }

    // A deleted account's token is already unusable (refresh re-fetches the
    // user and would 401), so skip storing: the row would violate the
    // revoked_refresh_token.user_id FK and turn the idempotent 204 into a 500.
    const user = await this.usersService.findOneById(verified.id);
    if (!user) {
      return;
    }

    // Opportunistic purge: rows whose token already expired are garbage — no
    // scheduled job needed.
    await this.revokedTokensRepository.delete({
      expiresAt: LessThan(new Date()),
    });

    // orIgnore() keeps a double logout a 204 (UNIQUE on token_hash).
    await this.storeRevokedToken(refreshToken, user.id, verified.exp);
  }

  // Store the sha256 hash of a presented refresh token so it can never be used
  // again. Returns true when the row was actually inserted; false when the
  // hash was already present (a concurrent logout/rotation) — ON CONFLICT DO
  // NOTHING swallows the duplicate, so Postgres RETURNING yields zero rows.
  private async storeRevokedToken(
    refreshToken: string,
    userId: string,
    exp: number,
  ): Promise<boolean> {
    const insertResult = await this.revokedTokensRepository
      .createQueryBuilder()
      .insert()
      .into(RevokedRefreshToken)
      .values({
        tokenHash: this.hashToken(refreshToken),
        userId,
        expiresAt: new Date(exp * 1000),
      })
      .orIgnore()
      .execute();

    return insertResult.raw.length > 0;
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async isRevoked(refreshToken: string): Promise<boolean> {
    const revoked = await this.revokedTokensRepository.findOne({
      where: { tokenHash: this.hashToken(refreshToken) },
      select: { id: true },
    });
    return revoked !== null;
  }

  async getProfile(userId: string): Promise<UserResponseDto> {
    const user = await this.usersService.findOneById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      role: user.role,
    };
  }

  private async generateTokens(payload: {
    id: string;
    email: string;
    role: UserRole;
    tokenVersion: number;
  }) {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.accessSecret,
        expiresIn: '30m',
      }),
      this.jwtService.signAsync(payload, {
        secret: this.refreshSecret,
        expiresIn: '30d',
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private isPasswordBcryptHash(hashedPassword: string): boolean {
    return BCRYPT_PREFIXES.some((prefix) => hashedPassword.startsWith(prefix));
  }

  private async validatePassword(
    inputPassword: string,
    user: { id: string; password: string },
  ): Promise<boolean> {
    if (this.isPasswordBcryptHash(user.password)) {
      return bcrypt.compare(inputPassword, user.password);
    }

    // Legacy plaintext — compare directly, then re-hash if matched
    const matchesPlaintext = inputPassword === user.password;

    if (matchesPlaintext) {
      const rehashed = await bcrypt.hash(inputPassword, 10);
      await this.usersService.updatePassword(user.id, rehashed);
    }

    return matchesPlaintext;
  }
}
