import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateSermonDto {
  @ApiProperty()
  @IsString()
  @IsOptional()
  title: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  description: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  textFileUrl: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  audioUrl: string;

  @ApiProperty()
  @IsString()
  @IsOptional()
  youtubeUrl: string;
}
