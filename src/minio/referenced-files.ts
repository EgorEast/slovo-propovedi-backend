import { MinioService, ReferencedFileNames } from './minio.service';

export interface FileReferencingSermon {
  audioUrl?: string | null;
  textFileUrl?: string | null;
  artwork?: string | null;
}

export interface FileReferencingPlaylist {
  artwork?: string | null;
}

/**
 * Builds the sets of bucket object names referenced by the stored URL columns
 * of sermons (audioUrl/textFileUrl/artwork) and playlists (artwork). Shared by
 * the orphans endpoints and the sermon file cleanup, so both agree on what
 * "referenced" means. Malformed/foreign URLs are skipped — one bad row must
 * not break the scan.
 */
export function collectReferencedFileNames(
  sermons: readonly FileReferencingSermon[],
  playlists: readonly FileReferencingPlaylist[],
): ReferencedFileNames {
  const audio = new Set<string>();
  const text = new Set<string>();
  const artwork = new Set<string>();
  for (const sermon of sermons) {
    addExtractedName(audio, sermon.audioUrl);
    addExtractedName(text, sermon.textFileUrl);
    addExtractedName(artwork, sermon.artwork);
  }
  for (const playlist of playlists) {
    addExtractedName(artwork, playlist.artwork);
  }
  return { audio, text, artwork };
}

/** True when the object name appears in any reference set. */
export function isReferencedAnywhere(
  fileName: string,
  referenced: ReferencedFileNames,
): boolean {
  return (
    referenced.audio.has(fileName) ||
    referenced.text.has(fileName) ||
    referenced.artwork.has(fileName)
  );
}

function addExtractedName(
  set: Set<string>,
  fileUrl: string | null | undefined,
): void {
  if (!fileUrl) {
    return;
  }
  try {
    set.add(MinioService.extractFileNameFromUrl(fileUrl));
  } catch {
    // Skipped deliberately — see collectReferencedFileNames().
  }
}
