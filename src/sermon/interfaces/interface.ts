import { z } from 'zod';
import {
  SermonControllerCreateResponse,
  SermonControllerFindAllResponse,
} from '../../generated';

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

export type NormalizedSermonResponse = z.infer<
  typeof SermonControllerCreateResponse
>;

export class AllSermonsResponse {
  sermons: z.infer<typeof SermonControllerFindAllResponse>['sermons'];
  count: number | null;
  nextCursor: string | null;
}

export class StreamUrlResponse {
  url: string;
}

export class StatusSermonResponse {
  status: string;
}
