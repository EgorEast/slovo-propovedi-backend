import { PlaylistEntity } from '../entities/playlist.entity';
import { SermonEntity } from 'src/sermon/entities/sermon.entity';

export interface UpdatePlaylist {
  title?: string;
  description?: string;
  sermons?: SermonEntity[];
}

export class AllPlaylistsResponse {
  playlists: PlaylistEntity[];
  count: number;
}

export class StatusPlaylistResponse {
  status: string;
}
