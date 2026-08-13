import { createZodDto } from 'nestjs-zod';
import { UsersControllerCreateBody } from '../../generated';

export class CreateUserDto extends createZodDto(UsersControllerCreateBody) {}
