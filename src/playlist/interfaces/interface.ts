import { ApiProperty } from '@nestjs/swagger';
import { PlaylistEntity } from '../entities/playlist.entity';

export interface UpdatePlaylist {
  title?: string;
  description?: string;
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
