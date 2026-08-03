import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

const BCRYPT_PREFIXES = ['$2a$', '$2b$', '$2y$'];

export class UserResponse {
  id: string;
  name: string;
  email: string;
}

export class AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: UserResponse;
}

export class RefreshResponse {
  accessToken: string;
  refreshToken: string;
}

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

  async signIn(email: string, password: string): Promise<AuthResponse> {
    const user = await this.usersService.findOneByEmail(email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await this.validatePassword(password, user);

    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { id: user.id, email: user.email };
    const tokens = await this.generateTokens(payload);

    return {
      ...tokens,
      user: { id: user.id, name: user.name, email: user.email },
    };
  }

  async refreshTokens(refreshToken: string): Promise<RefreshResponse> {
    try {
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.refreshSecret,
      });

      return this.generateTokens({ id: payload.id, email: payload.email });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async getProfile(userId: string): Promise<UserResponse> {
    const user = await this.usersService.findOneById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    return { id: user.id, name: user.name, email: user.email };
  }

  private async generateTokens(payload: { id: string; email: string }) {
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
