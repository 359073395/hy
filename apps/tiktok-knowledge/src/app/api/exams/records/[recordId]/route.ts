import { NextResponse } from 'next/server';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { isAnswerCorrect, answerToText } from '@/lib/exam-utils';
import { withTransaction } from '@/lib/server/db';
import { lockExamRecord, snapshotQuestions, ExamError } from '@/lib/server/exams';

function failure(error: unknown) {
  console.error('[exam-record]', error);
  return NextResponse.json({ error: error instanceof ExamError ? error.message : '考核操作失败，请重试' }, { status: error instanceof ExamError ? error.status : 500 });
}

export async function GET(_req: Request, ctx: { params: Promise<{ recordId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { recordId } = await ctx.params;
  try {
    const data = await withTransaction(async (db) => {
      const record = await lockExamRecord(db, recordId);
      if (record.user_id !== user.id && !isAdmin(user)) throw new ExamError('无权限', 403);
      const sampled = await snapshotQuestions(db, record);
      if (!record.started_at && record.status === 'pending') {
        await db.query("UPDATE exam_records SET started_at=now(),status='in_progress' WHERE id=$1", [recordId]);
        record.status = 'in_progress';
      }
      const questions = sampled.map((q) => ({ id: q.id, qtype: q.qtype, question_text: q.question_text, options: q.options, sort_order: q.sort_order, has_objective: q.answer != null, ...(isAdmin(user) ? { answer: q.answer } : {}) }));
      const { question_snapshot: _snapshot, ...publicRecord } = record;
      return { record: publicRecord, questions };
    });
    return NextResponse.json(data);
  } catch (error) { return failure(error); }
}

export async function POST(req: Request, ctx: { params: Promise<{ recordId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
  const { recordId } = await ctx.params;
  const body = await req.json().catch(() => null) as { answers?: unknown } | null;
  if (!body?.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) return NextResponse.json({ error: '答案格式无效' }, { status: 400 });
  const entries = Object.entries(body.answers);
  if (entries.length > 100 || entries.some(([key, value]) => key.length > 128 || typeof value !== 'string' || value.length > 20000)) return NextResponse.json({ error: '答案格式或长度无效' }, { status: 400 });
  const answers = Object.fromEntries(entries) as Record<string, string>;
  try {
    const data = await withTransaction(async (db) => {
      const record = await lockExamRecord(db, recordId);
      if (record.user_id !== user.id) throw new ExamError('无权限', 403);
      if (!['pending', 'in_progress'].includes(record.status)) throw new ExamError('该记录已提交，不可重交', 409);
      const sampled = await snapshotQuestions(db, record);
      const objective = sampled.filter((q) => q.qtype !== 'practical' && q.answer != null);
      const correct = objective.filter((q) => isAnswerCorrect(q.qtype, q.answer, answers[q.id])).length;
      const score = objective.length ? Math.round(correct / objective.length * 100) : 0;
      const passedObj = score >= 80;
      await db.query("UPDATE exam_records SET status=$2,score=$3,practical_status='pending',submitted_at=now(),answers=$4 WHERE id=$1", [recordId, passedObj ? 'obj_passed' : 'failed', score, JSON.stringify(answers)]);
      if (!passedObj) await db.query("UPDATE users SET tier='M2' WHERE id=$1", [record.user_id]);
  // 构造逐题解析（交卷后展示给考生：题干/题型/我的答案/正确答案/对错/解释）
  const review = sampled.map((q) => {
    const isObj = q.qtype !== 'practical';
    const mine = answers[q.id] ?? '';
    let myText = mine;
    let correctText = '';
    if (q.qtype === 'truefalse') {
      correctText = q.answer === 'true' ? '正确' : '错误';
      myText = mine === '' ? '（未作答）' : mine === 'true' ? '正确' : '错误';
    } else if ((q.qtype === 'choice' || q.qtype === 'multiple') && Array.isArray(q.options)) {
      correctText = answerToText(q.qtype, q.answer, q.options);
      if (mine !== '') myText = answerToText(q.qtype, mine, q.options);
    }
    const isCorrect = isObj ? isAnswerCorrect(q.qtype, q.answer, mine) : null; // 简述由管理员判定
    return {
      id: q.id,
      qtype: q.qtype,
      question_text: q.question_text,
      options: q.options,
      my_answer: mine,
      my_answer_text: myText,
      correct_answer: q.answer,
      correct_answer_text: correctText,
      explanation: q.explanation,
      is_correct: isCorrect,
    };
  });


      return { ok: true, score, passed_obj: passedObj, status: passedObj ? 'obj_passed' : 'failed', message: passedObj ? '客观题已达标，等待管理员判定简述题' : '客观题未达标，阅读权限已调整至M2', review };
    });
    return NextResponse.json(data);
  } catch (error) { return failure(error); }
}
