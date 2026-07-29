import { ApiProperty } from '@nestjs/swagger';
import { SermonEntity } from '../entities/sermon.entity';

export interface UpdateSermon {
  title?: string;
  description?: string;
  textFileUrl?: string;
  audioUrl?: string;
  youtubeUrl?: string;
  artist?: string;
  artwork?: string;
  book?: string;
  chapter?: number;
  verse?: number | [number, number];
}

export class AllSermonsResponse {
  @ApiProperty({ type: SermonEntity, isArray: true })
  sermons: SermonEntity[];

  @ApiProperty()
  count: number;
}

export class StatusSermonResponse {
  @ApiProperty()
  status: string;
}
