import { NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { createAttempt, ExamError } from '@/lib/server/exams';

export async function POST(req: Request, ctx: { params: Promise<{ examId: string }> }) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: '无权限' }, { status: 403 });
  const { examId } = await ctx.params;
  const body = await req.json().catch(() => null) as { userId?: string } | null;
  if (!body?.userId) return NextResponse.json({ error: '请选择成员' }, { status: 400 });
  try { return NextResponse.json(await createAttempt(examId, body.userId), { status: 201 }); }
  catch (error) {
    console.error('[exam-assign]', error);
    return NextResponse.json({ error: error instanceof ExamError ? error.message : '创建考核失败' }, { status: error instanceof ExamError ? error.status : 500 });
  }
}
