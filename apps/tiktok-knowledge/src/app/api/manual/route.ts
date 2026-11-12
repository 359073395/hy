import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUser, canReadModule } from '@/lib/auth';
import { prependSignedUrl } from '@/lib/storage';
import { MODULES } from '@/lib/constants';

const MODULE_ORDER = new Map(MODULES.map((m, i) => [m.code, i]));

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const client = getSupabaseClient();

  const [{ data: chapters }, { data: blocks }, { data: materials }] = await Promise.all([
    client.from('chapters').select('id, module, section_no, title, sort_order, is_public').order('sort_order'),
    client.from('content_blocks').select('id, chapter_id, html, version, updated_at'),
    client.from('materials').select('id, chapter_id, sentence, word, file_key, file_type, file_name, file_size, uploader_id, status').eq('status', 'active'),
  ]);
  if (!chapters) return NextResponse.json({ error: '章节读取失败' }, { status: 500 });

  const blockByChapter = new Map(blocks?.map((b) => [b.chapter_id, b]) ?? []);
  const matsByChapter = new Map<string, typeof materials>();
  for (const m of materials ?? []) {
    const arr = matsByChapter.get(m.chapter_id) ?? [];
    arr.push(m);
    matsByChapter.set(m.chapter_id, arr);
  }

  // 锁定章节：本次请求直接不下发（含正文与素材）
  const visible = chapters.filter((c) => canReadModule(c.module, c.is_public, user));
  visible.sort((a, b) => {
    const ma = MODULE_ORDER.get(a.module) ?? 99;
    const mb = MODULE_ORDER.get(b.module) ?? 99;
    if (ma !== mb) return ma - mb;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });

  const result = [];
  for (const c of visible) {
    const block = blockByChapter.get(c.id);
    const chapterMats = (matsByChapter.get(c.id) ?? []).map((m) => ({
      id: m.id,
      word: m.word,
      sentence: m.sentence,
      file_type: m.file_type,
      url: null as string | null,
    }));
    result.push({
      id: c.id,
      module: c.module,
      section_no: c.section_no,
      title: c.title,
      sort_order: c.sort_order,
      is_public: c.is_public,
      html: block?.html ?? '',
      version: block?.version ?? 1,
      updated_at: block?.updated_at ?? null,
      materials: chapterMats,
    });
  }

  // 批量生成素材签名 URL
  const urlPromises: Promise<unknown>[] = [];
  for (const ch of result) {
    for (const m of ch.materials) {
      const raw = matsByChapter.get(ch.id)?.find((x) => x.id === m.id);
      urlPromises.push(
        (async () => {
          m.url = await prependSignedUrl(raw?.file_key);
        })(),
      );
    }
  }
  await Promise.all(urlPromises);

  return NextResponse.json({ user, chapters: result });
}