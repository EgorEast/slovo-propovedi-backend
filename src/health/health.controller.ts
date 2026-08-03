import { Controller, Get } from '@nestjs/common';
import { ZodResponse } from 'nestjs-zod';
import { HealthResponseDto } from './dto/health-response.dto';

@Controller('health')
export class HealthController {
  @Get()
  @ZodResponse({ type: HealthResponseDto })
  check() {
    return { status: 'ok' };
  }
}
