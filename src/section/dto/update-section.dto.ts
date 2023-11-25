import { PartialType } from '@nestjs/mapped-types';
import { CreateSectionDto } from './create-section.dto';
import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSectionDto extends PartialType(CreateSectionDto) {
  @ApiProperty()
  @IsString()
  @IsOptional()
  title: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  description: string;
}
