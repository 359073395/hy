import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { createAttempt, ExamError } from '@/lib/server/exams';

export async function POST(_req: Request, ctx: { params: Promise<{ examId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { examId } = await ctx.params;
  try { return NextResponse.json(await createAttempt(examId, user.id), { status: 201 }); }
  catch (error) {
    console.error('[exam-retake]', error);
    return NextResponse.json({ error: error instanceof ExamError ? error.message : '创建考核失败' }, { status: error instanceof ExamError ? error.status : 500 });
  }
}
