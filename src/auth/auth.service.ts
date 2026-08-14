import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { UserRole } from '../users/user-role.enum';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RefreshResponseDto } from './dto/refresh-response.dto';
import { UserResponseDto } from './dto/user-response.dto';

const BCRYPT_PREFIXES = ['$2a$', '$2b$', '$2y$'];

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
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
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await this.validatePassword(password, user);

    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // The role lives in the JWT so guards can authorize per-request. email is
    // retained for backwards compatibility with already-issued refresh tokens;
    // it is NOT used for lookup (getProfile re-fetches by id, refresh re-fetches
    // the live user by id).
    const payload = { id: user.id, email: user.email, role: user.role };
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

  async refreshTokens(refreshToken: string): Promise<RefreshResponseDto> {
    let verified: { id: string };

    try {
      verified = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Re-fetch the LIVE user so a stale or demoted role takes effect on the
    // next access token, and so old refresh tokens (whose payload carried no
    // role) are upgraded to role-bearing ones.
    const user = await this.usersService.findOneById(verified.id);

    if (!user) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return this.generateTokens({
      id: user.id,
      email: user.email,
      role: user.role,
    });
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
