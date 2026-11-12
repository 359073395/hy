import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { uploadMaterial, deleteObject } from '@/lib/storage';

// 仅 super_admin / admin 可挂载素材；employee 为纯只读。
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  if (!isAdmin(user)) return NextResponse.json({ error: '无权限，仅管理员可上传素材' }, { status: 403 });

  const { id } = await ctx.params;
  const client = getSupabaseClient();
  const { data: chapter, error: chErr } = await client
    .from('chapters')
    .select('id, module, is_public')
    .eq('id', id)
    .single();
  if (chErr || !chapter) return NextResponse.json({ error: '章节不存在' }, { status: 404 });
  if (!isAdmin(user)) {
    return NextResponse.json({ error: '无权访问该章节' }, { status: 403 });
  }

  const form = await req.formData();
  const sentence = String(form.get('sentence') ?? '').trim();
  const word = String(form.get('word') ?? '').trim();
  const file = form.get('file');
  if (!sentence || !word) return NextResponse.json({ error: '缺少句子或选词' }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ error: '缺少文件' }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());

  // 第一步：文件入桶
  let stored;
  try {
    stored = await uploadMaterial(buf, file.name, file.type);
  } catch (e) {
    // 存储失败：明确报错，绝不假成功
    return NextResponse.json({ error: (e as Error).message || '文件存储失败' }, { status: 400 });
  }

  // 第二步：写素材-锚点关联记录。失败必须清理孤儿文件并返回错误，保证「上传成功 = 文件 + 锚点都成功」。
  const { data, error: insertErr } = await client
    .from('materials')
    .insert({
      chapter_id: id,
      sentence,
      word,
      file_key: stored.key,
      file_type: stored.type,
      file_name: file.name,
      file_size: stored.size,
      uploader_id: user.id,
      status: 'active',
    })
    .select('id, chapter_id, sentence, word, file_key, file_type, file_name, file_size, status, uploader_id')
    .single();

  if (insertErr || !data) {
    // 关联记录写入失败：回滚已上传的孤儿文件，避免悬挂在桶里
    await deleteObject(stored.key);
    return NextResponse.json(
      { error: `素材关联记录保存失败，请重试：${insertErr?.message ?? '未知错误'}` },
      { status: 500 },
    );
  }

  // 三要素齐备：文件已存储 + 锚点关联已落库（🎬 标记由前端基于章节素材渲染）
  return NextResponse.json({ material: { ...data, url: stored.url } }, { status: 201 });
}
