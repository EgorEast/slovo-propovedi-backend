import { ApiProperty } from '@nestjs/swagger';
import { SermonEntity } from '../entities/sermon.entity';

export interface UpdateSermon {
  title?: string;
  description?: string;
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
