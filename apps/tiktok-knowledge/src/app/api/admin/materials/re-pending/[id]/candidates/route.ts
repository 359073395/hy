import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { recommendCandidates } from '@/lib/text-match';

function chapterLabel(chapter: { module: string; section_no: string; title: string }): string {
  const sec = (chapter.section_no ?? '').trim();
  const head = /^\d/.test(sec) ? `${chapter.module.slice(0, 1)}${sec}` : sec ? `${chapter.module}.${sec}` : chapter.module;
  return `${head} ${chapter.title}`;
}

/**
 * 待重挂素材 → 推荐挂接候选。
 * 返回目标章节与 1~3 个推荐新词候选（含所在句子、得分），前端在手册页高亮供点击挂接。
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: '无权限' }, { status: 403 });

  const { id } = await ctx.params;
  const client = getSupabaseClient();
  const { data: mat } = await client
    .from('materials')
    .select('id, chapter_id, sentence, word, file_type, status')
    .eq('id', id)
    .single();
  if (!mat) return NextResponse.json({ error: '素材不存在' }, { status: 404 });

  const { data: chapter } = await client
    .from('chapters')
    .select('id, module, section_no, title')
    .eq('id', mat.chapter_id)
    .single();
  if (!chapter) {
    return NextResponse.json({
      chapter_deleted: true,
      chapter_id: mat.chapter_id,
      candidates: [],
      old_word: mat.word,
      old_sentence: mat.sentence,
    });
  }

  const { data: block } = await client
    .from('content_blocks')
    .select('html')
    .eq('chapter_id', mat.chapter_id)
    .single();

  const candidates = recommendCandidates(mat.word, mat.sentence, block?.html ?? '', 3);
  return NextResponse.json({
    chapter_deleted: false,
    chapter_id: mat.chapter_id,
    chapter_label: chapterLabel(chapter),
    old_word: mat.word,
    old_sentence: mat.sentence,
    file_type: mat.file_type,
    status: mat.status,
    candidates,
  });
}
