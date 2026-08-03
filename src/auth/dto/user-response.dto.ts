import { createZodDto } from 'nestjs-zod';
import { AuthControllerGetProfileResponse } from '../../generated';

export class UserResponseDto extends createZodDto(AuthControllerGetProfileResponse) {}