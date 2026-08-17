import { z } from 'zod';
import {
  SermonControllerCreateResponse,
  SermonControllerFindAllResponse,
  SermonControllerGetDistinctValuesResponse,
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
  chapter?: number | number[];
  verse?: number | number[] | (number | number[])[];
}

export type NormalizedSermonResponse = z.infer<
  typeof SermonControllerCreateResponse
>;

export type DistinctValuesResponse = z.infer<
  typeof SermonControllerGetDistinctValuesResponse
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
