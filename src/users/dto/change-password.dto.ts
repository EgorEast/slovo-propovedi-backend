import { createZodDto } from 'nestjs-zod';
import { UsersControllerChangePasswordBody } from '../../generated';

export class ChangePasswordDto extends createZodDto(
  UsersControllerChangePasswordBody,
) {}
