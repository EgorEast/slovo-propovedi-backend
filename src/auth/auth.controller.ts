import {
  Body,
  Request,
  Controller,
  Post,
  HttpCode,
  HttpStatus,
  UseGuards,
  Get,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SignInRequestDto } from './dto/sign-in-request.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutRequestDto } from './dto/logout-request.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RefreshResponseDto } from './dto/refresh-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { AuthGuard } from './guard/auth.guard';
import { ZodResponse } from 'nestjs-zod';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with username and password' })
  @ZodResponse({ type: AuthResponseDto })
  signIn(@Body() signInDto: SignInRequestDto): Promise<AuthResponseDto> {
    return this.authService.signIn(signInDto.username, signInDto.password);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access and refresh tokens' })
  @ZodResponse({ type: RefreshResponseDto })
  refresh(@Body() refreshDto: RefreshTokenDto): Promise<RefreshResponseDto> {
    return this.authService.refreshTokens(refreshDto.refreshToken);
  }

  @UseGuards(AuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Выход из системы' })
  logout(@Body() logoutDto: LogoutRequestDto): Promise<void> {
    return this.authService.logout(logoutDto.refreshToken);
  }

  @UseGuards(AuthGuard)
  @Get('profile')
  @ApiOperation({ summary: 'Get current user profile' })
  @ZodResponse({ type: UserResponseDto })
  async getProfile(@Request() req): Promise<UserResponseDto> {
    return await this.authService.getProfile(req.user.id);
  }
}
