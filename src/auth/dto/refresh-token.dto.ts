import { createZodDto } from 'nestjs-zod';
import { AuthControllerRefreshBody } from '../../generated';

export class RefreshTokenDto extends createZodDto(AuthControllerRefreshBody) {}
