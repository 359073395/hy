/**
 * 素材上传工具：绕开平台网关 ~16MB 单请求 body 上限。
 * - ≤12MB：走原单请求路由（仍远低于网关上限）；
 * - >12MB：前端按 12MB 分片逐片上传到服务端暂存，完成时由服务端流式 multipart 组装落桶。
 * 所有网络/大小/类型/分片失败均归一为携带 kind 的 UploadError，供界面给出真实原因。
 */

export type UploadErrorKind = 'size' | 'type' | 'network' | 'timeout' | 'server' | 'partial';

export class UploadError extends Error {
  kind: UploadErrorKind;
  constructor(kind: UploadErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

const SINGLE_LIMIT = 12 * 1024 * 1024; // 12MB 内单请求（网关 16MB，安全余量）
const CHUNK_SIZE = 12 * 1024 * 1024; // 分片大小

async function readBodyJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function requestJson(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (e instanceof Error && (e.name === 'AbortError' || /timeout|timed ?out/i.test(e.message))) {
      throw new UploadError('timeout', '上传超时，请重试');
    }
    throw new UploadError('network', '网络中断，请检查网络后重试');
  }
}

export interface UploadProgress {
  percent: number; // 0-100，覆盖网络传输与分片阶段
  phase: string; // 提示文案
}

export interface UploadMaterialOpts {
  chapterId: string;
  sentence: string;
  word: string;
  file: File;
  onProgress?: (p: UploadProgress) => void;
}

export async function uploadMaterial(opts: UploadMaterialOpts): Promise<unknown> {
  const { chapterId, sentence, word, file, onProgress } = opts;
  const url = `/api/chapters/${chapterId}/materials`;

  if (file.size <= SINGLE_LIMIT) {
    onProgress?.({ percent: 0, phase: '上传中…' });
    const fd = new FormData();
    fd.append('sentence', sentence || '');
    fd.append('word', word);
    fd.append('file', file);
    const res = await requestJson(url, { method: 'POST', body: fd });
    if (res.ok) {
      onProgress?.({ percent: 100, phase: '完成' });
      const j = await readBodyJson(res);
      if (j.material) return j.material;
      throw new UploadError('server', '上传返回数据异常，请重试');
    }
    const j = await readBodyJson(res);
    const msg = (j.error as string) || `上传失败（${res.status}）`;
    throw new UploadError(res.status === 413 ? 'size' : 'server', msg);
  }

  return uploadChunked(opts, url);
}

async function uploadChunked(opts: UploadMaterialOpts, baseUrl: string): Promise<unknown> {
  const { chapterId, sentence, word, file, onProgress } = opts;

  onProgress?.({ percent: 1, phase: '正在创建上传会话…' });
  const startRes = await requestJson(`${baseUrl}/parts/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      totalBytes: file.size,
    }),
  });
  const startJson = await readBodyJson(startRes);
  if (!startRes.ok) {
    const msg = (startJson.error as string) || `无法开始上传（${startRes.status}）`;
    throw new UploadError(startRes.status === 413 ? 'size' : 'server', msg);
  }
  const uploadId = startJson.uploadId as string;
  if (!uploadId) throw new UploadError('server', '无法获取上传会话');

  const partCount = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  let doneBytes = 0;

  for (let i = 0; i < partCount; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const blob = file.slice(start, end);
    const fd = new FormData();
    fd.append('uploadId', uploadId);
    fd.append('index', String(i));
    fd.append('file', blob, `part${i}`);
    const partRes = await requestJson(`${baseUrl}/parts`, { method: 'POST', body: fd });
    if (!partRes.ok) {
      const j = await readBodyJson(partRes);
      throw new UploadError(
        partRes.status === 413 ? 'size' : 'server',
        `第 ${i + 1}/${partCount} 片上传失败：${(j.error as string) || `HTTP ${partRes.status}`}`,
      );
    }
    doneBytes += end - start;
    onProgress?.({ percent: Math.min(90, Math.round((doneBytes / file.size) * 100)), phase: `上传中 ${i + 1}/${partCount}` });
  }

  onProgress?.({ percent: 92, phase: '正在合并文件…' });
  const completeRes = await requestJson(`${baseUrl}/parts/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uploadId,
      partCount,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      totalBytes: file.size,
      sentence: sentence || '',
      word,
    }),
  });
  const completeJson = await readBodyJson(completeRes);
  if (!completeRes.ok) {
    const msg = (completeJson.error as string) || `合并失败（${completeRes.status}）`;
    throw new UploadError(completeRes.status === 422 ? 'size' : (completeRes.status === 504 ? 'timeout' : 'server'), msg);
  }
  if (!completeJson.material) throw new UploadError('server', '合并返回数据异常，请重试');
  onProgress?.({ percent: 100, phase: '完成' });
  return completeJson.material;
}