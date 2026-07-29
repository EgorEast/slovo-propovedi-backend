import { ApiProperty } from '@nestjs/swagger';
import { SectionEntity } from '../entities/section.entity';

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
