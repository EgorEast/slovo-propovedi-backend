import { createZodDto } from 'nestjs-zod';
import { UsersControllerFindAllResponse } from '../../generated';

export class UserListResponseDto extends createZodDto(
  UsersControllerFindAllResponse,
) {}
