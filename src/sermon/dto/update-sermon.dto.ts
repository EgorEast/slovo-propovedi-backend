import { PartialType } from '@nestjs/mapped-types';
import { CreateSermonDto } from './create-sermon.dto';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSermonDto extends PartialType(CreateSermonDto) {
  @ApiProperty()
  @IsString()
  @IsOptional()
  title?: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  textFileUrl?: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  audioUrl?: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  youtubeUrl?: string;

  @ApiProperty()
  @IsOptional()
  playlist?: string;
}
