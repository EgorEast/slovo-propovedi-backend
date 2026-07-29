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
import { AuthResponse, RefreshResponse, AuthService } from './auth.service';
import { SignInRequestDto } from './dto/sign-in-request.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AuthGuard } from './guard/auth.guard';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: HttpStatus.OK, type: AuthResponse })
  signIn(@Body() signInDto: SignInRequestDto): Promise<AuthResponse> {
    return this.authService.signIn(signInDto.email, signInDto.password);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access and refresh tokens' })
  @ApiResponse({ status: HttpStatus.OK, type: RefreshResponse })
  refresh(@Body() refreshDto: RefreshTokenDto): Promise<RefreshResponse> {
    return this.authService.refreshTokens(refreshDto.refreshToken);
  }

  @UseGuards(AuthGuard)
  @Get('profile')
  getProfile(@Request() req) {
    return req.user;
  }
}
