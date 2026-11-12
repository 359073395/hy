import { NextResponse } from 'next/server';
import { assertUploadAccess } from '@/lib/server/material-guard';
import { storeUploadPart, PART_STAGING_PREFIX } from '@/lib/storage';

const MAX_PART = 14 * 1024 * 1024; // 单个分片请求上限（需 < 生产网关 16MB）

// 服务端接收单个分片（≤14MB）并落到对象存储暂存区，最终由 complete 阶段流式组装。
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const acc = await assertUploadAccess(id);
  if ('error' in acc) return acc.error;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }
  const uploadId = String(form.get('uploadId') ?? '');
  const index = Number(form.get('index'));
  const file = form.get('file');
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) return NextResponse.json({ error: 'uploadId 无效' }, { status: 400 });
  if (!Number.isInteger(index) || index < 0 || index > 9999) {
    return NextResponse.json({ error: '分片序号无效' }, { status: 400 });
  }
  if (!(file instanceof File)) return NextResponse.json({ error: '缺少分片文件' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: '分片为空' }, { status: 400 });
  if (file.size > MAX_PART) {
    return NextResponse.json({ error: '分片超过限制，请缩小单片大小后重试' }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const stagingKey = `${PART_STAGING_PREFIX}/${uploadId}/${index}`;
  try {
    await storeUploadPart(stagingKey, buf);
  } catch {
    return NextResponse.json({ error: '分片暂存失败，请重试' }, { status: 500 });
  }
  return NextResponse.json({ ok: true, index, bytes: file.size });
}