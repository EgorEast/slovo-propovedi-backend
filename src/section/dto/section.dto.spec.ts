import { CreateSectionDto } from './create-section.dto';
import { UpdateSectionDto } from './update-section.dto';

const validCreateSection = {
  title: 'Раздел',
  description: null,
  itemsSize: 'small',
  itemsRows: 3,
  transform: 'high',
};

describe('Section DTO input bounds', () => {
  it('accepts integer itemsRows in range', () => {
    expect(CreateSectionDto.schema.safeParse(validCreateSection).success).toBe(
      true,
    );
  });

  it('rejects a non-integer itemsRows', () => {
    const result = CreateSectionDto.schema.safeParse({
      ...validCreateSection,
      itemsRows: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative itemsRows', () => {
    const result = CreateSectionDto.schema.safeParse({
      ...validCreateSection,
      itemsRows: -1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects itemsRows above the schema maximum', () => {
    const result = CreateSectionDto.schema.safeParse({
      ...validCreateSection,
      itemsRows: 101,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a title above the schema maximum', () => {
    const result = CreateSectionDto.schema.safeParse({
      ...validCreateSection,
      title: 'a'.repeat(301),
    });
    expect(result.success).toBe(false);
  });

  it('applies the same bounds to UpdateSectionDto', () => {
    const result = UpdateSectionDto.schema.safeParse({
      ...validCreateSection,
      playlistsIds: [],
      isDescriptionTitleOnSlideLarge: false,
      whereIsSlideTitleLocated: 'under',
      borderRadius: false,
      itemsRows: 1.5,
    });
    expect(result.success).toBe(false);
  });
});
