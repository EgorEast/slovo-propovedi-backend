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
  verse?: number | number[];
}

export class AllSermonsResponse {
  sermons: SermonEntity[];
  count: number | null;
  nextCursor: string | null;
}

export class StreamUrlResponse {
  url: string;
}

export class StatusSermonResponse {
  status: string;
}
