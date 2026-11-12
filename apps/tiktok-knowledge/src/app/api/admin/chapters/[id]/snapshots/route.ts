import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUser, isAdmin } from '@/lib/auth';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const op = await getCurrentUser();
  if (!op || !isAdmin(op)) return NextResponse.json({ error: '无权限' }, { status: 403 });

  const { id } = await ctx.params;
  const client = getSupabaseClient();
  const { data: block } = await client.from('content_blocks').select('id').eq('chapter_id', id).single();

  if (!block) return NextResponse.json({ snapshots: [] });
  const { data } = await client
    .from('content_snapshots')
    .select('id, version, html, created_at')
    .eq('content_block_id', block.id)
    .order('version', { ascending: false })
    .limit(100);
  return NextResponse.json({ snapshots: data ?? [] });
}