import { NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { readLimitedJson } from '@/lib/knowledge-package';
import { exportKnowledge, importKnowledge, previewKnowledge } from '@/lib/server/knowledge-import';

export const runtime = 'nodejs';

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: '仅管理员可导出知识库' }, { status: 403 });
  try {
    const pack = await exportKnowledge();
    return NextResponse.json(pack, { headers: {
      'Content-Disposition': 'attachment; filename="knowledge-package.json"',
      'Cache-Control': 'no-store',
    } });
  } catch (error) {
    console.error('[knowledge-export]', error);
    return NextResponse.json({ error: '导出失败，请检查正文图片文件是否完整及总大小是否超过32MB' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: '仅管理员可导入知识库' }, { status: 403 });
  try {
    const body = await readLimitedJson(req) as { action?: unknown; mode?: unknown; package?: unknown };
    if (!body || !['preview', 'apply'].includes(String(body.action))) return NextResponse.json({ error: '操作无效' }, { status: 400 });
    const preview = await previewKnowledge(body.package);
    if (body.action === 'preview') return NextResponse.json({ preview });
    if (body.mode !== 'add' && body.mode !== 'update') return NextResponse.json({ error: '导入方式无效' }, { status: 400 });
    const result = await importKnowledge(body.package, body.mode, user.id);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    console.error('[knowledge-import]', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : '知识包导入失败' }, { status: 400 });
  }
}
