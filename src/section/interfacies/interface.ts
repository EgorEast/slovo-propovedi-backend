import { z } from 'zod';
import {
  SectionControllerCreateResponse,
  SectionControllerFindAllResponse,
} from '../../generated';

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

/**
 * The normalized section shape is exactly the OpenAPI response schema — the
 * service constructs it field-by-field (no raw entity spreads) so the
 * ZodSerializerInterceptor's strict parse never sees an unexpected key.
 */
export type NormalizedSection = z.infer<typeof SectionControllerCreateResponse>;

export type NormalizedPlaylist = NormalizedSection['playlists'][number];

export type AllSectionsResponseShape = z.infer<
  typeof SectionControllerFindAllResponse
>;

export class AllSectionsResponse {
  sections: AllSectionsResponseShape['sections'];
  count: number;
}

export class StatusSectionsResponse {
  status: string;
}
