import { createZodDto } from 'nestjs-zod';
import { AuthControllerSignInBody } from '../../generated';

export class SignInRequestDto extends createZodDto(AuthControllerSignInBody) {}
