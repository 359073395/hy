import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUser } from '@/lib/auth';
import { EXAM_MAX_ATTEMPTS, EXAM_MAX_RETRIES } from '@/lib/constants';

/**
 * 员工端：查看三套考核定义 + 我的考核记录（含是否收到考核入口、补考次数）。
 * 每门考核共 EXAM_MAX_ATTEMPTS 次机会（1 次正考 + EXAM_MAX_RETRIES 次补考）。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const client = getSupabaseClient();
  const [{ data: exams }, { data: records }, { data: attemptsRows }] = await Promise.all([
    client.from('exams').select('id, code, name, scope, pass_score').order('code'),
    client
      .from('exam_records')
      .select('id, exam_id, status, score, practical_status, started_at, submitted_at, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    client.from('exam_records').select('exam_id').eq('user_id', user.id),
  ]);

  // 每个考试已发起的记录数 = 已用机会数
  const usedByExam = new Map<string, number>();
  for (const r of attemptsRows ?? []) {
    usedByExam.set(r.exam_id, (usedByExam.get(r.exam_id) ?? 0) + 1);
  }

  // 每个考试取最新一条记录作为当前记录
  const recordList = records ?? [];
  const latestByExam = new Map<string, (typeof recordList)[number]>();
  for (const r of recordList) {
    if (!latestByExam.has(r.exam_id)) latestByExam.set(r.exam_id, r);
  }

  const result = (exams ?? []).map((e) => {
    const record = latestByExam.get(e.id) ?? null;
    const usedAttempts = usedByExam.get(e.id) ?? 0;
    const remainingAttempts = Math.max(0, EXAM_MAX_ATTEMPTS - usedAttempts);
    const finishedFailed = record != null && record.status === 'failed';
    // 仅在「最新记录未通过」且「还有剩余机会」时允许（自助）补考/正考
    const canRetake = finishedFailed && remainingAttempts > 0;
    const hasActive = record != null && !['passed', 'failed'].includes(record.status);
    return {
      ...e,
      record,
      used_attempts: usedAttempts,
      max_attempts: EXAM_MAX_ATTEMPTS,
      max_retries: EXAM_MAX_RETRIES,
      remaining_attempts: remainingAttempts,
      can_retake: canRetake,
      has_active: hasActive,
    };
  });
  return NextResponse.json({ exams: result });
}