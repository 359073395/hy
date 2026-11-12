import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { prependSignedUrl } from '@/lib/storage';
import { mismatchReason, recommendCandidates } from '@/lib/text-match';

/** 章节展示标签：section_no 已含模块号（如 3.12）→ M3.12；否则 M3.{section_no} */
function chapterLabel(chapter: { module: string; section_no: string; title: string }): string {
  const sec = (chapter.section_no ?? '').trim();
  const head = /^\d/.test(sec) ? `${chapter.module.slice(0, 1)}${sec}` : sec ? `${chapter.module}.${sec}` : chapter.module;
  return `${head} ${chapter.title}`;
}

/** 管理员「待重挂清单」：正文编辑后匹配不上的素材，返回完整上下文供重挂判断 */
export async function GET(_req: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: '无权限' }, { status: 403 });

  const client = getSupabaseClient();
  const { data } = await client
    .from('materials')
    .select('id, chapter_id, sentence, word, file_type, file_key, uploader_id, status, created_at')
    .eq('status', 're_pending')
    .order('created_at', { ascending: false });

  const mats = data ?? [];
  if (mats.length === 0) return NextResponse.json({ materials: [] });

  const chapterIds = Array.from(new Set(mats.map((m) => m.chapter_id).filter(Boolean))) as string[];
  const [{ data: chapters }, { data: blocks }] = await Promise.all([
    chapterIds.length
      ? client.from('chapters').select('id, module, section_no, title').in('id', chapterIds)
      : Promise.resolve({ data: [] as { id: string; module: string; section_no: string; title: string }[] }),
    chapterIds.length
      ? client.from('content_blocks').select('chapter_id, html, version').in('chapter_id', chapterIds)
      : Promise.resolve({ data: [] as { chapter_id: string; html: string; version: number }[] }),
  ]);

  const chapterMap = new Map((chapters ?? []).map((c) => [c.id, c]));
  const blockMap = new Map((blocks ?? []).map((b) => [b.chapter_id, b]));

  const result = await Promise.all(
    mats.map(async (m) => {
      const chapter = chapterMap.get(m.chapter_id) ?? null;
      const block = blockMap.get(m.chapter_id) ?? null;
      const currentHtml = block?.html ?? '';
      const deleted = !chapter;
      const candidates = deleted ? [] : recommendCandidates(m.word, m.sentence, currentHtml, 3);
      const url = await prependSignedUrl(m.file_key);
      return {
        id: m.id,
        chapter_id: m.chapter_id,
        chapter_deleted: deleted,
        chapter_label: chapter ? chapterLabel(chapter) : `原章节（${m.chapter_id.slice(0, 8)}…）已删除`,
        module: chapter?.module ?? null,
        sentence: m.sentence,
        word: m.word,
        file_type: m.file_type,
        url,
        created_at: m.created_at,
        reason: deleted ? '原章节已删除' : mismatchReason(m.word, m.sentence, currentHtml),
        // 当前正文里与旧句最相关的段落（候选句子），供管理员对照
        current_sentences: deleted ? [] : candidates.map((c) => c.sentence).slice(0, 2),
        candidates,
      };
    }),
  );

  return NextResponse.json({ materials: result });
}
