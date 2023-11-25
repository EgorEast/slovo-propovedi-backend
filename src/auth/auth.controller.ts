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
import { AuthResponse, AuthService } from './auth.service';
import { SignInRequestDto } from './dto/sign-in-request.dto';
import { AuthGuard } from './guard/auth.guard';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @ApiOperation({
    summary: 'login to admin panel',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: AuthResponse,
  })
  signIn(@Body() signInDto: SignInRequestDto): Promise<AuthResponse> {
    return this.authService.signIn(signInDto.email, signInDto.password);
  }

  @UseGuards(AuthGuard)
  @Get('profile')
  getProfile(@Request() req) {
    return req.user;
  }
}
