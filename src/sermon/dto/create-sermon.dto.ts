import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsInt, IsOptional, IsString } from 'class-validator';
import { IsVerseOrPair } from './validators/is-verse-or-pair.validator';

export class CreateSermonDto {
  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty()
  @IsString()
  description: string;

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
  @IsString()
  artist: string;

  @ApiProperty()
  @IsString()
  artwork: string;

  @ApiProperty({ example: 'Genesis', description: 'Bible book reference' })
  @IsString()
  @IsOptional()
  book?: string;

  @ApiProperty()
  @IsInt()
  @IsOptional()
  chapter?: number;

  @ApiProperty()
  @IsVerseOrPair()
  @IsOptional()
  verse?: number | [number, number];

  @ApiProperty({ type: [String], required: false })
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  playlistsIds?: string[];
}
