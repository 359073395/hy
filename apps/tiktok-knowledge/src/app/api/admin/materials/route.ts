import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { prependSignedUrl } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/** 后台「素材管理」总览：管理员/超管可看全部素材（含已挂/待重挂），附上传人、章节、签名 URL。 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: '无权限' }, { status: 403 });

  const client = getSupabaseClient();

  const [{ data: materials }, { data: chapters }, { data: users }] = await Promise.all([
    client
      .from('materials')
      .select('id, chapter_id, sentence, word, file_key, file_type, file_name, file_size, uploader_id, status, created_at')
      .order('created_at', { ascending: false }),
    client.from('chapters').select('id, module, section_no, title, is_public'),
    client.from('users').select('id, name'),
  ]);

  const chapterMap = new Map((chapters ?? []).map((c) => [c.id, c]));
  const userMap = new Map((users ?? []).map((u) => [u.id, u.name]));

  const list = await Promise.all(
    (materials ?? []).map(async (m) => {
      const ch = chapterMap.get(m.chapter_id);
      const url = await prependSignedUrl(m.file_key);
      return {
        id: m.id,
        chapter_id: m.chapter_id,
        chapter_deleted: !ch,
        chapter_label: ch ? `${ch.section_no} ${ch.title}` : '（章节已删除）',
        chapter_module: ch?.module ?? null,
        word: m.word,
        sentence: m.sentence,
        file_type: m.file_type,
        file_name: m.file_name ?? null,
        file_size: m.file_size ?? 0,
        url,
        uploader_name: m.uploader_id ? (userMap.get(m.uploader_id) ?? '未知用户') : '未知用户',
        status: m.status,
        created_at: m.created_at,
      };
    }),
  );

  const stats = {
    total: list.length,
    active: list.filter((m) => m.status === 'active').length,
    re_pending: list.filter((m) => m.status === 're_pending').length,
  };

  return NextResponse.json({ materials: list, stats });
}
