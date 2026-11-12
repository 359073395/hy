import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { DatabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUser, isAdmin } from '@/lib/auth';

export type UploadUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/**
 * 校验素材上传访问权限。返回 { user, client, chapter } 或在无权限时返回 { error }。
 * 仅 super_admin / admin 可上传/编辑；employee 为纯只读（上传/删除/编辑一律 403）。
 */
export async function assertUploadAccess(chapterId: string): Promise<
  | { user: UploadUser; client: DatabaseClient; chapter: { id: string; module: string; is_public: boolean } }
  | { error: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: '未登录' }, { status: 401 }) };
  if (!isAdmin(user)) return { error: NextResponse.json({ error: '无权限，仅管理员可上传素材' }, { status: 403 }) };

  const client = getSupabaseClient();
  const { data: chapter, error } = await client
    .from('chapters')
    .select('id, module, is_public')
    .eq('id', chapterId)
    .single();
  if (error || !chapter) return { error: NextResponse.json({ error: '章节不存在' }, { status: 404 }) };
  return { user, client, chapter };
}
