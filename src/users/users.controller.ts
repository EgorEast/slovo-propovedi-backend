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
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { AccessTokenPayload, AuthGuard } from '../auth/guard/auth.guard';
import { RolesGuard } from '../auth/guard/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { IdParamDto } from '../shared/dto/id-param.dto';
import { UsersService } from './users.service';
import { UserRole } from './user-role.enum';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { FindAllUsersQueryDto } from './dto/find-all-users-query.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserListResponseDto } from './dto/user-list-response.dto';

interface AuthenticatedRequest {
  user: Pick<AccessTokenPayload, 'id' | 'role'>;
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles(UserRole.Admin)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: UserListResponseDto })
  findAll(@Query() query: FindAllUsersQueryDto) {
    return this.usersService.findAll(query.page, query.limit);
  }

  @Post()
  @Roles(UserRole.Admin)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: UserResponseDto })
  create(@Body() body: CreateUserDto) {
    return this.usersService.create(body);
  }

  @Get(':id')
  @Roles(UserRole.Admin)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: UserResponseDto })
  findOne(@Param() params: IdParamDto) {
    return this.usersService.findOne(params.id);
  }

  @Patch(':id')
  @Roles(UserRole.Admin)
  @UseGuards(AuthGuard, RolesGuard)
  @ZodResponse({ type: UserResponseDto })
  update(
    @Param() params: IdParamDto,
    @Body() body: UpdateUserDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.usersService.update(params.id, body, req.user.id);
  }

  @Patch(':id/password')
  @Roles(UserRole.Admin)
  @UseGuards(AuthGuard, RolesGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  changePassword(@Param() params: IdParamDto, @Body() body: ChangePasswordDto) {
    return this.usersService.changePassword(params.id, body);
  }

  @Delete(':id')
  @Roles(UserRole.Admin)
  @UseGuards(AuthGuard, RolesGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param() params: IdParamDto, @Req() req: AuthenticatedRequest) {
    return this.usersService.remove(params.id, req.user.id);
  }
}
