import { PartialType } from '@nestjs/mapped-types';
import { CreatePlaylistDto } from './create-playlist.dto';
import { IsOptional, IsString } from 'class-validator';

export class UpdatePlaylistDto extends PartialType(CreatePlaylistDto) {
  @IsString()
  @IsOptional()
  title: string;

  @IsString()
  @IsOptional()
  description: string;
}
