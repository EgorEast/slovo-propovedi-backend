import { ApiProperty } from '@nestjs/swagger';
import { PlaylistEntity } from '../entities/playlist.entity';
import { SermonEntity } from 'src/sermon/entities/sermon.entity';

export interface UpdatePlaylist {
  title?: string;
  description?: string;
  sermons?: SermonEntity[];
}

export class AllPlaylistsResponse {
  @ApiProperty({ type: PlaylistEntity, isArray: true })
  playlists: PlaylistEntity[];

  @ApiProperty()
  count: number;
}

export class StatusPlaylistResponse {
  @ApiProperty()
  status: string;
}
