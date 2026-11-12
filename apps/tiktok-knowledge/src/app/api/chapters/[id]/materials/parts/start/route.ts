import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { assertUploadAccess } from '@/lib/server/material-guard';
import { resolveMaterialType } from '@/lib/storage';

// 开启一次分片上传会话，返回 uploadId。同时在此处预校验文件类型/大小，尽早给出真实失败原因。
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const acc = await assertUploadAccess(id);
  if ('error' in acc) return acc.error;

  let body: { fileName?: string; contentType?: string; totalBytes?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }
  const fileName = String(body.fileName ?? '').trim();
  const contentType = String(body.contentType ?? '').trim();
  const totalBytes = Number(body.totalBytes ?? 0);
  if (!fileName || !contentType || !(totalBytes > 0)) {
    return NextResponse.json({ error: '缺少文件名/类型/大小' }, { status: 400 });
  }
  try {
    resolveMaterialType(fileName, contentType, totalBytes);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  const uploadId = crypto.randomUUID();
  return NextResponse.json({ uploadId });
}