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

  @ApiProperty({
    description:
      'Total sermon count. Present only for unfiltered requests — computing it on every paginated page would defeat keyset pagination.',
    nullable: true,
  })
  count: number | null;

  @ApiProperty({
    description:
      'Opaque keyset cursor — pass it as the `cursor` query param to fetch the next page. Null when there are no more pages.',
    nullable: true,
  })
  nextCursor: string | null;
}

export class StreamUrlResponse {
  @ApiProperty({
    description: 'Time-limited presigned URL for direct streaming from MinIO',
  })
  url: string;
}

export class StatusSermonResponse {
  @ApiProperty()
  status: string;
}
