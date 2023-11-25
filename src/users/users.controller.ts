import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

@Controller('users')
@ApiTags('Users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({
    summary: 'Create user',
  })
  create(@Body() createUserDto: CreateUserDto): string {
    return this.usersService.create(createUserDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get users',
  })
  findAll(): string {
    return this.usersService.findAll();
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit user',
  })
  update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
  ): string {
    return this.usersService.update(+id, updateUserDto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Delete user',
  })
  remove(@Param('id') id: string): string {
    return this.usersService.remove(+id);
  }
}
