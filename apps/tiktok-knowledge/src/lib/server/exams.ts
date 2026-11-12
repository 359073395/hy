import type { PoolClient } from 'pg';
import { EXAM_MAX_ATTEMPTS } from '@/lib/constants';
import { flattenPicked, pickExamQuestions } from '@/lib/exam-utils';
import { withTransaction } from '@/lib/server/db';

export interface ExamQuestion {
  id: string;
  qtype: string;
  question_text: string;
  options: string[] | null;
  answer: string | null;
  explanation: string | null;
  sort_order: number;
}

export interface ExamRecord {
  id: string;
  exam_id: string;
  user_id: string;
  status: string;
  score: number | null;
  practical_status: string;
  started_at: string | null;
  question_snapshot: ExamQuestion[] | null;
}

export class ExamError extends Error {
  constructor(message: string, public status: number = 400) { super(message); }
}

export async function lockExamRecord(db: PoolClient, id: string) {
  const found = await db.query<ExamRecord>('SELECT id,exam_id,user_id,status,score,practical_status,started_at,question_snapshot FROM exam_records WHERE id=$1 FOR UPDATE', [id]);
  if (!found.rows[0]) throw new ExamError('考核记录不存在', 404);
  return found.rows[0];
}

export async function snapshotQuestions(db: PoolClient, record: ExamRecord): Promise<ExamQuestion[]> {
  if (record.question_snapshot) return record.question_snapshot;
  const questions = await db.query<ExamQuestion>('SELECT id,qtype,question_text,options,answer,explanation,sort_order FROM questions WHERE exam_id=$1 ORDER BY sort_order,id', [record.exam_id]);
  const sampled = flattenPicked(pickExamQuestions(questions.rows, record.id));
  if (!sampled.some((q) => q.qtype !== 'practical') || !sampled.some((q) => q.qtype === 'practical')) throw new ExamError('题库需要至少包含客观题和简述题，请先导入题库');
  await db.query('UPDATE exam_records SET question_snapshot=$2 WHERE id=$1', [record.id, JSON.stringify(sampled)]);
  return sampled;
}

export async function createAttempt(examId: string, userId: string) {
  return withTransaction(async (db) => {
    const user = await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    if (!user.rows[0]) throw new ExamError('成员不存在', 404);
    const exam = await db.query('SELECT id FROM exams WHERE id=$1', [examId]);
    if (!exam.rows[0]) throw new ExamError('考核不存在', 404);
    const attempts = await db.query<ExamRecord>('SELECT id,status FROM exam_records WHERE user_id=$1 AND exam_id=$2 ORDER BY created_at DESC,id DESC', [userId, examId]);
    if (attempts.rows.some((r) => !['passed', 'failed'].includes(r.status))) throw new ExamError('已有进行中的考核，请先完成');
    if (attempts.rows[0]?.status === 'passed') throw new ExamError('该考核已经通过');
    if (attempts.rows.length >= EXAM_MAX_ATTEMPTS) throw new ExamError(`考核机会已用完（共${EXAM_MAX_ATTEMPTS}次）`);
    const created = await db.query<ExamRecord>("INSERT INTO exam_records(exam_id,user_id,status) VALUES($1,$2,'pending') RETURNING *", [examId, userId]);
    const record = created.rows[0];
    await snapshotQuestions(db, record);
    return { record: { id: record.id, status: record.status }, used_attempts: attempts.rows.length + 1, max_attempts: EXAM_MAX_ATTEMPTS };
  });
}

/** Capture legacy attempts before editing the bank they were issued from. */
export async function freezeLegacyExamRecords(db: PoolClient, examId: string) {
  const legacy = await db.query<{ id: string }>('SELECT id FROM exam_records WHERE exam_id=$1 AND question_snapshot IS NULL FOR UPDATE', [examId]);
  if (!legacy.rows.length) return;
  const original = await db.query<ExamQuestion>('SELECT id,qtype,question_text,options,answer,explanation,sort_order FROM questions WHERE exam_id=$1 ORDER BY sort_order,id', [examId]);
  for (const record of legacy.rows) {
    const snapshot = flattenPicked(pickExamQuestions(original.rows, record.id));
    await db.query('UPDATE exam_records SET question_snapshot=$2 WHERE id=$1', [record.id, JSON.stringify(snapshot)]);
  }
}
