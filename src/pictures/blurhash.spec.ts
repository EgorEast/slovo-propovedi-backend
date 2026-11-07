import sharp from 'sharp';
import { computeBlurhash, encodeBlurhash } from './blurhash';

// 4×3 components encode to size flag (4 - 1) + (3 - 1) * 9 = 21, i.e. 'L'.
const EXPECTED_SIZE_FLAG = 'L';

const makeRawRgba = (width: number, height: number) =>
  sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .raw()
    .toBuffer();

const makePng = (width: number, height: number) =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();

describe('encodeBlurhash', () => {
  it('encodes a raw RGBA buffer into a non-empty blurhash', async () => {
    const width = 4;
    const height = 3;
    const raw = await makeRawRgba(width, height);

    const hash = encodeBlurhash(new Uint8ClampedArray(raw), width, height);

    expect(hash.length).toBeGreaterThan(0);
    expect(hash[0]).toBe(EXPECTED_SIZE_FLAG);
  });

  it('returns the same blurhash for the same input', async () => {
    const width = 4;
    const height = 3;
    const raw = await makeRawRgba(width, height);

    const first = encodeBlurhash(new Uint8ClampedArray(raw), width, height);
    const second = encodeBlurhash(new Uint8ClampedArray(raw), width, height);

    expect(second).toBe(first);
  });
});

describe('computeBlurhash', () => {
  it('encodes a decodable image buffer', async () => {
    const image = await makePng(8, 6);

    const hash = await computeBlurhash(image);

    expect(hash.length).toBeGreaterThan(0);
    expect(hash[0]).toBe(EXPECTED_SIZE_FLAG);
  });
});
