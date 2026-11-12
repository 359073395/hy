import { NextResponse } from 'next/server';
import {
  uploadMaterialFromParts,
  readUploadPart,
  deleteObject,
  resolveStagedParts,
} from '@/lib/storage';
import { assertUploadAccess } from '@/lib/server/material-guard';

const MAX_PARTS = 512;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024; // 200MB

/**
 * 分片上传完成：读取暂存分片 → 流式 multipart 组装落到对象桶 → 写入素材关联记录 → 清理暂存分片。
 * 单次 body 始终远小于网关 16MB 限制，可支撑到 200MB。
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const acc = await assertUploadAccess(id);
  if ('error' in acc) return acc.error;
  const { user, client } = acc;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体解析失败' }, { status: 400 });
  }

  const uploadId = typeof body.uploadId === 'string' ? body.uploadId.trim() : '';
  const partCount = Number(body.partCount);
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  const contentType = typeof body.contentType === 'string' ? body.contentType.trim() : '';
  const totalBytes = Number(body.totalBytes);
  const sentence = typeof body.sentence === 'string' ? body.sentence.trim() : '';
  const word = typeof body.word === 'string' ? body.word.trim() : '';

  if (!/^[0-9a-fA-F-]{8,64}$/.test(uploadId)) {
    return NextResponse.json({ error: '上传会话无效，请重新上传' }, { status: 400 });
  }
  if (!Number.isInteger(partCount) || partCount <= 0 || partCount > MAX_PARTS) {
    return NextResponse.json({ error: '分片数量无效，请重新上传' }, { status: 400 });
  }
  if (!fileName || !contentType) {
    return NextResponse.json({ error: '缺少文件名或类型' }, { status: 400 });
  }
  if (!Number.isFinite(totalBytes) || totalBytes <= 0 || totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      { error: totalBytes > MAX_TOTAL_BYTES ? '视频不能超过 200MB，建议压缩后上传' : '文件大小无效' },
      { status: 422 },
    );
  }
  if (!word) return NextResponse.json({ error: '缺少锚点词' }, { status: 400 });

  // 存储 SDK 会对分片对象名追加随机后缀，实际键需通过前缀列出后按序号解析
  let partKeys: string[] | null = null;
  try {
    partKeys = await resolveStagedParts(uploadId, partCount);
  } catch (e) {
    console.error(
      '[chunk-complete] 分片枚举失败:',
      e instanceof Error ? e.message : e,
      'uploadId=',
      uploadId,
    );
  }
  if (!partKeys) {
    return NextResponse.json({ error: '分片不完整或已过期，请重新上传' }, { status: 400 });
  }

  let stored;
  try {
    stored = await uploadMaterialFromParts({
      fileName,
      contentType,
      totalBytes,
      partCount,
      readPart: (i) => readUploadPart(partKeys![i]),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '上传失败';
    // 类型/大小校验失败：清理已暂存分片并回滚
    await Promise.allSettled(partKeys.map((k) => deleteObject(k)));
    return NextResponse.json({ error: msg }, { status: 422 });
  }

  // 写入素材关联记录
  const { data, error: insertErr } = await client
    .from('materials')
    .insert({
      chapter_id: id,
      word,
      sentence,
      file_key: stored.key,
      file_type: stored.type,
      file_name: fileName,
      file_size: stored.size,
      uploader_id: user.id,
      status: 'active',
    })
    .select('id, chapter_id, sentence, word, file_key, file_type, file_name, file_size, status, uploader_id')
    .single();

  // 无论成败都清理暂存分片（用实际键清理）
  await Promise.allSettled(partKeys.map((k) => deleteObject(k)));

  if (insertErr || !data) {
    await deleteObject(stored.key).catch(() => undefined);
    return NextResponse.json(
      { error: `素材关联记录保存失败，请重试：${insertErr?.message ?? '未知错误'}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ material: { ...data, url: stored.url } }, { status: 201 });
}