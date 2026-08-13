import { createZodDto } from 'nestjs-zod';
import { UsersControllerCreateResponse } from '../../generated';

export class UserResponseDto extends createZodDto(
  UsersControllerCreateResponse,
) {}
