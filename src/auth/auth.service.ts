import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ApiProperty } from '@nestjs/swagger';

export class AuthResponse {
  @ApiProperty()
  access_token: string;
}

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async signIn(email: string, pass: string): Promise<AuthResponse> {
    const user = await this.usersService.findOneByEmail(email);
    if (user?.password !== pass) {
      throw new UnauthorizedException();
    }
    const payload = { id: user.id, email: user.email };
    return {
      access_token: await this.jwtService.signAsync(payload),
    };
  }
}
