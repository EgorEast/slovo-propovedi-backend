import { createZodDto } from 'nestjs-zod';
import { AuthControllerSignInResponse } from '../../generated';

export class AuthResponseDto extends createZodDto(
  AuthControllerSignInResponse,
) {}
