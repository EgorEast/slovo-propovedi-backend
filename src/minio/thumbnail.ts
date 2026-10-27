import sharp from 'sharp';

/**
 * Longest side of a preview. Mobile cards are laid out on a ≤ 430 dp basis and
 * the originals are ~1000 px, so 640 px keeps cards sharp at a fraction of the
 * size (tens of KB instead of 1–1.7 MB).
 */
export const THUMBNAIL_MAX_SIDE = 640;
const THUMBNAIL_QUALITY = 80;

export const THUMBNAIL_CONTENT_TYPE = 'image/webp';

/**
 * Card-size WebP preview of an image. EXIF orientation is applied (`rotate()`)
 * because the metadata is not carried over; images smaller than the limit are
 * not enlarged.
 */
export function createThumbnail(image: Buffer): Promise<Buffer> {
  return sharp(image)
    .rotate()
    .resize({
      fit: 'inside',
      height: THUMBNAIL_MAX_SIDE,
      width: THUMBNAIL_MAX_SIDE,
      withoutEnlargement: true,
    })
    .webp({ quality: THUMBNAIL_QUALITY })
    .toBuffer();
}
