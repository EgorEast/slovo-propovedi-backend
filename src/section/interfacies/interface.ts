import { ApiProperty } from '@nestjs/swagger';
import { SectionEntity } from '../entities/section.entity';

export interface UpdateSection {
  title?: string;
  description?: string;
}

export class AllSectionsResponse {
  @ApiProperty({ type: SectionEntity, isArray: true })
  sections: SectionEntity[];
  @ApiProperty()
  count: number;
}

export class StatusSectionsResponse {
  @ApiProperty()
  status: string;
}
