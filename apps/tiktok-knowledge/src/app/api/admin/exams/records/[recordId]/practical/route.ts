import { NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { withTransaction } from '@/lib/server/db';
import { lockExamRecord, ExamError } from '@/lib/server/exams';

export async function POST(req: Request, ctx: { params: Promise<{ recordId: string }> }) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) return NextResponse.json({ error: '无权限' }, { status: 403 });
  const { recordId } = await ctx.params;
  const body = await req.json().catch(() => null) as { status?: string } | null;
  const practical = body?.status;
  if (practical !== 'passed' && practical !== 'failed') return NextResponse.json({ error: '判定结果无效' }, { status: 400 });
  try {
    const result = await withTransaction(async (db) => {
      const record = await lockExamRecord(db, recordId);
      if (['passed', 'failed'].includes(record.status) && record.practical_status === practical) return { ok: true, status: record.status, practical_status: practical };
      if (record.status !== 'obj_passed') throw new ExamError('该考核未处于待判定状态', 409);
      await db.query('UPDATE exam_records SET status=$2,practical_status=$2,official_passed=$3 WHERE id=$1', [recordId, practical, practical === 'passed']);
      if (practical === 'passed') {
        const exam = await db.query<{ code: string }>('SELECT code FROM exams WHERE id=$1', [record.exam_id]);
        const tier = ({ ops_assistant: 'M2', product_ops: 'M4', content_ops: 'M6' } as Record<string, string>)[exam.rows[0]?.code] ?? 'M2';
        await db.query("UPDATE users SET tier=CASE WHEN tier='M6' OR $2='M6' THEN 'M6' WHEN tier='M4' OR $2='M4' THEN 'M4' ELSE 'M2' END WHERE id=$1", [record.user_id, tier]);
      } else await db.query("UPDATE users SET tier='M2' WHERE id=$1", [record.user_id]);
      await db.query("INSERT INTO audit_logs(user_id,action,detail) VALUES($1,'exam_judged',$2)", [user.id, JSON.stringify({ recordId, status: practical })]);
      return { ok: true, status: practical, practical_status: practical, message: practical === 'passed' ? '考核通过，阅读权限已按岗位更新' : '考核未通过，阅读权限已调整至M2' };
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[exam-judge]', error);
    return NextResponse.json({ error: error instanceof ExamError ? error.message : '判定失败' }, { status: error instanceof ExamError ? error.status : 500 });
  }
}
