import { createZodDto } from 'nestjs-zod';
import { AuthControllerRefreshResponse } from '../../generated';

export class RefreshResponseDto extends createZodDto(
  AuthControllerRefreshResponse,
) {}
