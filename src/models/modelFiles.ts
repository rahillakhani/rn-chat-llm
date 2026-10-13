import { Directory, File, Paths } from 'expo-file-system';

import type { ModelSpec } from '../config/models';

// Models live in the app's document directory so the OS won't purge them like cache files.
// File.downloadFileAsync writes to a temp location and moves into place only on success,
// so a partially downloaded file never looks complete.

function modelsDir(): Directory {
  const dir = new Directory(Paths.document, 'models');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function modelFile(spec: ModelSpec): File {
  return new File(modelsDir(), spec.fileName);
}

export function isModelDownloaded(spec: ModelSpec): boolean {
  const file = modelFile(spec);
  return file.exists && file.size === spec.sizeBytes;
}

export type DownloadProgress = { bytesWritten: number; totalBytes: number };

export async function downloadModel(
  spec: ModelSpec,
  onProgress: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<File> {
  const file = modelFile(spec);
  if (isModelDownloaded(spec)) return file;
  if (file.exists) file.delete();

  if (Paths.availableDiskSpace < spec.sizeBytes * 1.1) {
    throw new Error(
      `Not enough free storage for ${spec.label} (${formatBytes(spec.sizeBytes)} needed).`,
    );
  }

  return File.downloadFileAsync(spec.url, file, {
    idempotent: true,
    signal,
    onProgress: ({ bytesWritten, totalBytes }) =>
      onProgress({ bytesWritten, totalBytes: totalBytes > 0 ? totalBytes : spec.sizeBytes }),
  });
}

export function deleteModel(spec: ModelSpec): void {
  const file = modelFile(spec);
  if (file.exists) file.delete();
}

/** Delete model files left over from earlier app versions (e.g. a replaced embedding model). */
export function deleteUnusedModels(keep: readonly ModelSpec[]): void {
  const keepNames = new Set(keep.map((m) => m.fileName));
  for (const entry of modelsDir().list()) {
    if (entry instanceof File && !keepNames.has(entry.name)) entry.delete();
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}
