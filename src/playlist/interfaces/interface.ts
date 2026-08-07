import { z } from 'zod';
import {
  PlaylistControllerCreateResponse,
  PlaylistControllerFindAllResponse,
} from '../../generated';

export interface UpdatePlaylist {
  title?: string;
  description?: string;
}

export type NormalizedPlaylistResponse = z.infer<
  typeof PlaylistControllerCreateResponse
>;

export class AllPlaylistsResponse {
  playlists: z.infer<typeof PlaylistControllerFindAllResponse>['playlists'];
  count: number;
}

export class StatusPlaylistResponse {
  status: string;
}
