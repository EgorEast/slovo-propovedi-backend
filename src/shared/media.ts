/**
 * Media taxonomy shared by the HTTP boundary (upload allow-list, file-name
 * params) and the storage layer (bucket scans, content types). Keeping it here
 * makes the taxonomy a single source of truth instead of a copy per module.
 */
export const IMAGE_EXTENSIONS: readonly string[] = [
  '.jpeg',
  '.jpg',
  '.png',
  '.webp',
];

export const AUDIO_TEXT_EXTENSIONS: readonly string[] = [
  '.mp3',
  '.m4a',
  '.pdf',
  '.fb2',
];

export const MEDIA_EXTENSIONS: readonly string[] = [
  ...IMAGE_EXTENSIONS,
  ...AUDIO_TEXT_EXTENSIONS,
];

/**
 * Lowercased extension (with the leading dot) of a file name; names without
 * a dot have no extension and yield an empty string.
 */
export function getFileExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex === -1 ? '' : fileName.slice(dotIndex).toLowerCase();
}

// Stored object names are `randomUUID() + extension` (see
// MinioService.uploadFile), so the extension alternation is derived from the
// taxonomy rather than hand-copied — adding a format updates the allow-list,
// the classification and the file-name validation at once.
const EXTENSION_ALTERNATION = MEDIA_EXTENSIONS.map((extension) =>
  extension.slice(1),
).join('|');

export const STORED_FILE_NAME_PATTERN = new RegExp(
  `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(${EXTENSION_ALTERNATION})$`,
  'i',
);
