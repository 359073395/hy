import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUser, isAdmin } from '@/lib/auth';

/**
 * 重新选词挂接素材。
 * body: { sentence, word, chapterId? }
 *  - 不传 chapterId：仍挂回原章节
 *  - 传 chapterId：挂到其他章节（原章节被删除 / 管理员指定换章节）
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: '无权限' }, { status: 403 });

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const sentence = String(body.sentence ?? '').trim();
  const word = String(body.word ?? '').trim();
  const targetChapterId = body.chapterId ? String(body.chapterId).trim() : null;
  if (!sentence || !word) return NextResponse.json({ error: '缺少句子或选词' }, { status: 400 });

  const client = getSupabaseClient();
  const { data: mat } = await client.from('materials').select('id, chapter_id, status').eq('id', id).single();
  if (!mat) return NextResponse.json({ error: '素材不存在' }, { status: 404 });

  const finalChapterId = targetChapterId || mat.chapter_id;
  // 目标章节校验：必须存在（原章节已删除时必须换章节）
  const { data: chapter } = await client.from('chapters').select('id').eq('id', finalChapterId).single();
  if (!chapter) {
    return NextResponse.json({ error: '目标章节不存在，请选择「挂到其他章节」' }, { status: 400 });
  }

  // 新词必须确实出现在所给句子中，句子必须能在目标章节正文里找到（防止挂到不存在的位置）
  const { data: block } = await client
    .from('content_blocks')
    .select('html')
    .eq('chapter_id', finalChapterId)
    .single();
  const htmlText = (block?.html ?? '').replace(/<[^>]+>/g, '');
  if (!normalizeIncludes(htmlText, sentence)) {
    return NextResponse.json({ error: '所选句子未在目标章节正文中找到，请在正文里重新选词' }, { status: 400 });
  }
  if (!normalizeIncludes(sentence, word)) {
    return NextResponse.json({ error: '选词必须包含在句子中' }, { status: 400 });
  }

  const { data } = await client
    .from('materials')
    .update({ sentence, word, chapter_id: finalChapterId, status: 'active' })
    .eq('id', id)
    .select('id, chapter_id, sentence, word, file_type, status')
    .single();
  if (!data) return NextResponse.json({ error: '素材不存在或已处理' }, { status: 404 });
  return NextResponse.json({ material: data });
}

function normalizeIncludes(haystack: string, needle: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/[，。！？；：、,.!?;:"'’“”（）()]/g, '');
  return norm(haystack).includes(norm(needle));
}
