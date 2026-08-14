import { createZodDto } from 'nestjs-zod';
import { AuthControllerLogoutBody } from '../../generated';

export class LogoutRequestDto extends createZodDto(AuthControllerLogoutBody) {}
