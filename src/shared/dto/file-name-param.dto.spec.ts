import { FileNameParamDto } from './file-name-param.dto';

const VALID_NAME = '3f2504e0-4f89-41d3-9a0c-0305e82c3301.mp3';

const parse = (fileName: string) =>
  FileNameParamDto.schema.safeParse({ fileName });

describe('FileNameParamDto', () => {
  it('accepts a stored object name (UUID + media extension)', () => {
    expect(parse(VALID_NAME).success).toBe(true);
    expect(parse('3f2504e0-4f89-41d3-9a0c-0305e82c3301.pdf').success).toBe(
      true,
    );
  });

  it('accepts uppercase extensions and UUID hex', () => {
    expect(parse('3F2504E0-4F89-41D3-9A0C-0305E82C3301.MP3').success).toBe(
      true,
    );
  });

  it('rejects arbitrary names and object keys', () => {
    expect(parse('cover.png').success).toBe(false);
    expect(parse('3f2504e0-4f89-41d3-9a0c-0305e82c3301').success).toBe(false);
    expect(parse('3f2504e0-4f89-41d3-9a0c-0305e82c3301.exe').success).toBe(
      false,
    );
  });

  it.each([
    '../../etc/passwd',
    '../../sermon.mp3',
    '..%2f..%2fsermon.mp3',
    '%2e%2e%2f%2e%2e%2fsermon.mp3',
    '3f2504e0-4f89-41d3-9a0c-0305e82c3301.mp3/../../x',
    '3f2504e0-4f89-41d3-9a0c-0305e82c3301.mp3\x00.txt',
  ])('rejects traversal attempt %p', (fileName) => {
    expect(parse(fileName).success).toBe(false);
  });

  it('rejects unknown keys at the boundary', () => {
    const result = FileNameParamDto.schema.safeParse({
      fileName: VALID_NAME,
      bucket: 'other',
    });

    expect(result.success).toBe(false);
  });

  it('rejects a file name longer than 255 characters', () => {
    expect(
      parse(`3f2504e0-4f89-41d3-9a0c-0305e82c3301.${'a'.repeat(255)}.mp3`)
        .success,
    ).toBe(false);
  });
});
