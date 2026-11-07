import { encode } from 'blurhash';
import sharp from 'sharp';

/** Component counts the mobile client expects for every picture. */
const COMPONENT_X = 4;
const COMPONENT_Y = 3;

/**
 * Encodes an RGBA pixel buffer into a blurhash with the app-wide 4×3 components.
 * The caller owns channel layout: `raw` must be 4 bytes per pixel.
 */
export function encodeBlurhash(
  raw: Uint8ClampedArray,
  width: number,
  height: number,
): string {
  return encode(raw, width, height, COMPONENT_X, COMPONENT_Y);
}

/**
 * Decodes an image and returns its blurhash. EXIF orientation is applied
 * (`rotate()`) so the placeholder matches what the client displays, and alpha
 * is forced because the blurhash encoder requires 4 channels.
 */
export async function computeBlurhash(image: Buffer): Promise<string> {
  const { data, info } = await sharp(image)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return encodeBlurhash(new Uint8ClampedArray(data), info.width, info.height);
}
