import { SectionEntity } from '../entities/section.entity';
import { PlaylistEntity } from '../../playlist/entities/playlist.entity';
import { SermonEntity } from '../../sermon/entities/sermon.entity';

export interface UpdateSection {
  title?: string;
  description?: string;
  itemsSize?: string;
  itemsRows?: number;
  transform?: string;
  isDescriptionTitleOnSlideLarge?: boolean;
  whereIsSlideTitleLocated?: string;
  borderRadius?: boolean;
}

export type NormalizedPlaylist = Omit<
  PlaylistEntity,
  'sections' | 'sermons'
> & {
  sections: Pick<SectionEntity, 'id' | 'title'>[];
  sermons: SermonEntity[];
};

export type NormalizedSection = Omit<SectionEntity, 'playlists'> & {
  playlists: NormalizedPlaylist[];
};

export class AllSectionsResponse {
  sections: NormalizedSection[];
  count: number;
}

export class StatusSectionsResponse {
  status: string;
}
