import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class FindAllSermonsQueryDto {
  @ApiPropertyOptional({
    description:
      'Page size for keyset pagination. Omit to return all sermons (backward compatible).',
    example: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  @ApiPropertyOptional({
    description:
      'Opaque keyset cursor — the id of the last sermon returned by the previous page.',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  @IsOptional()
  @IsUUID()
  cursor?: string;
}
