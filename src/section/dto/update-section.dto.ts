import { PartialType } from '@nestjs/mapped-types';
import { CreateSectionDto } from './create-section.dto';
import { IsOptional, IsString } from 'class-validator';

export class UpdateSectionDto extends PartialType(CreateSectionDto) {
  @IsString()
  @IsOptional()
  title: string;

  @IsString()
  @IsOptional()
  description: string;
}
