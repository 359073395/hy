import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface StoredFile { key: string; url: string; type: 'video' | 'image'; size: number; contentType: string }
export const PART_STAGING_PREFIX = 'part_uploads';
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
const ROOT_NAMES = new Set(['materials', 'knowledge-assets', PART_STAGING_PREFIX]);

// Persistent uploads are supplied by the runtime volume, outside the application bundle.
export function dataDirectory(): string {
  const directory = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  return path.resolve(/* turbopackIgnore: true */ directory);
}

/** Reject traversal and symlinks before reading or writing any stored object. */
export async function resolveStoragePath(key: string): Promise<string> {
  const segments = key.split('/');
  if (segments.length < 2 || !ROOT_NAMES.has(segments[0]) || segments.some((s) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s))) {
    throw new Error('Invalid file key');
  }
  let current = dataDirectory();
  for (const segment of segments) {
    current = path.join(/* turbopackIgnore: true */ current, segment);
    try {
      if ((await lstat(/* turbopackIgnore: true */ current)).isSymbolicLink()) throw new Error('Symbolic links are not allowed in storage');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return current;
}

export function fileUrl(key: string): string { return `/api/files/${key.split('/').map(encodeURIComponent).join('/')}`; }

export function resolveMaterialType(fileName: string, contentType: string, sizeBytes: number): { type: 'video' | 'image'; ext: string } {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new Error('文件大小无效');
  const video = contentType === 'video/mp4' || contentType === 'video/quicktime' || /\.(mp4|mov)$/i.test(fileName);
  if (video) {
    if (sizeBytes > 200 * 1024 * 1024) throw new Error('视频不能超过 200MB，建议压缩后上传');
    return { type: 'video', ext: contentType === 'video/quicktime' || /\.mov$/i.test(fileName) ? 'mov' : 'mp4' };
  }
  const ext = IMAGE_TYPES[contentType];
  if (!ext) throw new Error('仅支持 MP4/MOV 视频或 JPG/PNG/GIF/WebP 图片');
  if (sizeBytes > 20 * 1024 * 1024) throw new Error('图片不能超过 20MB');
  return { type: 'image', ext };
}

async function atomicWrite(key: string, buffer: Buffer): Promise<void> {
  const target = await resolveStoragePath(key);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function uploadMaterial(buffer: Buffer, fileName: string, contentType: string): Promise<StoredFile> {
  const { type, ext } = resolveMaterialType(fileName, contentType, buffer.length);
  const key = `materials/${randomUUID()}.${ext}`;
  await atomicWrite(key, buffer);
  return { key, url: fileUrl(key), type, size: buffer.length, contentType };
}

function validateUploadId(uploadId: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) throw new Error('上传会话无效');
}

export function stagingPartKey(uploadId: string, index: number): string {
  validateUploadId(uploadId);
  if (!Number.isInteger(index) || index < 0 || index > 9999) throw new Error('分片序号无效');
  return `${PART_STAGING_PREFIX}/${uploadId}/${index}`;
}

export async function storeUploadPart(fileKey: string, buffer: Buffer): Promise<void> {
  if (!/^part_uploads\/[0-9a-f-]{36}\/\d{1,4}$/i.test(fileKey)) throw new Error('分片路径无效');
  if (!buffer.length || buffer.length > 14 * 1024 * 1024) throw new Error('分片大小无效');
  await atomicWrite(fileKey, buffer);
}

export async function readUploadPart(fileKey: string): Promise<Buffer> {
  if (!fileKey.startsWith(`${PART_STAGING_PREFIX}/`)) throw new Error('分片路径无效');
  const target = await resolveStoragePath(fileKey);
  return readFile(/* turbopackIgnore: true */ target);
}

export async function uploadMaterialFromParts(opts: {
  fileName: string; contentType: string; totalBytes: number; partCount: number; readPart: (index: number) => Promise<Buffer>;
}): Promise<StoredFile> {
  const { type, ext } = resolveMaterialType(opts.fileName, opts.contentType, opts.totalBytes);
  if (!Number.isInteger(opts.partCount) || opts.partCount < 1 || opts.partCount > 512) throw new Error('分片数量无效');
  const key = `materials/${randomUUID()}.${ext}`;
  const target = await resolveStoragePath(key);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  const file = await open(/* turbopackIgnore: true */ temporary, 'wx', 0o600);
  let total = 0;
  try {
    for (let index = 0; index < opts.partCount; index++) {
      const chunk = await opts.readPart(index);
      total += chunk.length;
      if (total > opts.totalBytes) throw new Error('分片总大小与声明不符');
      await file.writeFile(chunk);
    }
    if (total !== opts.totalBytes) throw new Error('分片总大小与声明不符');
    await file.sync();
    await file.close();
    await rename(temporary, target);
  } catch (error) {
    await file.close().catch(() => undefined);
    await rm(temporary, { force: true });
    throw error;
  }
  return { key, url: fileUrl(key), type, size: total, contentType: opts.contentType };
}

export async function prependSignedUrl(fileKey: string | null | undefined): Promise<string | null> {
  if (!fileKey) return null;
  try { await resolveStoragePath(fileKey); return fileUrl(fileKey); } catch { return null; }
}

export async function deleteObject(fileKey: string | null | undefined): Promise<void> {
  if (!fileKey) return;
  const target = await resolveStoragePath(fileKey);
  await rm(target, { force: true });
  if (fileKey.startsWith(`${PART_STAGING_PREFIX}/`)) await rmdir(path.dirname(target)).catch(() => undefined);
}

export function parsePartIndex(key: string): number {
  const match = /^(\d+)(?:_|$)/.exec(key.slice(key.lastIndexOf('/') + 1));
  return match ? Number(match[1]) : -1;
}

export async function listStagedParts(uploadId: string): Promise<string[]> {
  validateUploadId(uploadId);
  const prefix = `${PART_STAGING_PREFIX}/${uploadId}`;
  const folder = path.dirname(await resolveStoragePath(`${prefix}/0`));
  try { return (await readdir(/* turbopackIgnore: true */ folder)).filter((name) => /^\d+$/.test(name)).map((name) => `${prefix}/${name}`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

export async function resolveStagedParts(uploadId: string, partCount: number): Promise<string[] | null> {
  if (!Number.isInteger(partCount) || partCount < 1 || partCount > 512) return null;
  const byIndex = new Map((await listStagedParts(uploadId)).map((key) => [parsePartIndex(key), key]));
  const result: string[] = [];
  for (let index = 0; index < partCount; index++) {
    const key = byIndex.get(index);
    if (!key) return null;
    result.push(key);
  }
  return result;
}
