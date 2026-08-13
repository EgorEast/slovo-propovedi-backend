import { createZodDto } from 'nestjs-zod';
import { UsersControllerUpdateBody } from '../../generated';

export class UpdateUserDto extends createZodDto(UsersControllerUpdateBody) {}
