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
  sections: SectionEntity[];
  count: number;
}

export class StatusSectionsResponse {
  status: string;
}
