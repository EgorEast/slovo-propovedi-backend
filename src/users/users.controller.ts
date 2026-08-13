import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { AuthGuard } from '../auth/guard/auth.guard';
import { IdParamDto } from '../shared/dto/id-param.dto';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserListResponseDto } from './dto/user-list-response.dto';

interface AuthenticatedRequest {
  user: {
    id: string;
  };
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @UseGuards(AuthGuard)
  @ZodResponse({ type: UserListResponseDto })
  findAll() {
    return this.usersService.findAll();
  }

  @Post()
  @UseGuards(AuthGuard)
  @ZodResponse({ type: UserResponseDto })
  create(@Body() body: CreateUserDto) {
    return this.usersService.create(body);
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  @ZodResponse({ type: UserResponseDto })
  findOne(@Param() params: IdParamDto) {
    return this.usersService.findOne(params.id);
  }

  @Patch(':id')
  @UseGuards(AuthGuard)
  @ZodResponse({ type: UserResponseDto })
  update(@Param() params: IdParamDto, @Body() body: UpdateUserDto) {
    return this.usersService.update(params.id, body);
  }

  @Patch(':id/password')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(@Param() params: IdParamDto, @Body() body: ChangePasswordDto) {
    return this.usersService.changePassword(params.id, body);
  }

  @Delete(':id')
  @UseGuards(AuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param() params: IdParamDto, @Req() req: AuthenticatedRequest) {
    return this.usersService.remove(params.id, req.user.id);
  }
}
