import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUser, isAdmin } from '@/lib/auth';

/**
 * 管理员查看某考试的完整题库（含正确答案与解析/参考答案）。
 * 仅 super_admin/admin 可访问；按 sort_order 升序返回。
 */
export async function GET(req: Request) {
  const op = await getCurrentUser();
  if (!op || !isAdmin(op)) return NextResponse.json({ error: '无权限' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const examId = searchParams.get('examId');
  if (!examId) return NextResponse.json({ error: '缺少 examId 参数' }, { status: 400 });

  const client = getSupabaseClient();
  const { data, error } = await client
    .from('questions')
    .select('id,exam_id,qtype,question_text,options,answer,explanation,sort_order')
    .eq('exam_id', examId)
    .order('sort_order', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ questions: data ?? [] });
}
