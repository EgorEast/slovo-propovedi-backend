import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UsersModule } from '../users/users.module';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RevokedRefreshToken } from './entities/revoked-refresh-token.entity';

@Module({
  imports: [
    UsersModule,
    JwtModule.register({ global: true }),
    TypeOrmModule.forFeature([RevokedRefreshToken]),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
