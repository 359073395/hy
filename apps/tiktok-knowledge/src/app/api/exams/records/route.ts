import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { pickExamQuestions } from '@/lib/exam-utils';

/**
 * 我的考核记录。
 * 管理员可带 ?all=1 查看全体成绩。
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });

  const url = new URL(req.url);
  const all = url.searchParams.get('all') === '1';
  const client = getSupabaseClient();

  if (all && isAdmin(user)) {
    const { data, error } = await client
      .from('exam_records')
      .select('id, exam_id, user_id, status, score, practical_status, started_at, submitted_at, created_at, answers, question_snapshot, exams(code,name), users(name)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = (data ?? []) as Array<Record<string, unknown>>;

    // 待判定的记录补充简述题题面 + 员工作答，便于管理员判定
    // 简述题按各记录 id 抽样，保证与考生实际作答的那道简述题一致
    const judgeRows = rows.filter((r) => r.status === 'obj_passed');
    const judgeExams = [...new Set(judgeRows.map((r) => r.exam_id as string))];
    const pracByExam = new Map<string, Array<{ id: string; exam_id: string; question_text: string }>>();
    if (judgeExams.length > 0) {
      const { data: pracQs } = await client
        .from('questions')
        .select('id, exam_id, question_text')
        .eq('qtype', 'practical')
        .in('exam_id', judgeExams);
      (pracQs ?? []).forEach((q: { id: string; exam_id: string; question_text: string }) => {
        if (!pracByExam.has(q.exam_id)) pracByExam.set(q.exam_id, []);
        pracByExam.get(q.exam_id)!.push(q);
      });
    }
    const enriched: Array<Record<string, unknown>> = rows.map((r) => {
      if (r.status !== 'obj_passed') return r;
      const examPracs = pracByExam.get(r.exam_id as string) ?? [];
      const answers = (r.answers ?? {}) as Record<string, string>;
      const answerKeys = new Set(Object.keys(answers));
      // 从 answer 键反查考生实际作答的那道简述题（避免"现抽题"依赖数组顺序导致题 id 对不上）
      const answeredPrac =
        examPracs.find((q) => answerKeys.has(q.id)) ??
        pickExamQuestions(examPracs as unknown as Array<{ id: string; qtype: string }>, r.id as string).practical?.[0];
      const snapshot = r.question_snapshot as Array<{ id: string; qtype: string; question_text: string; explanation?: string }> | null;
      const pq = snapshot?.find((q) => q.qtype === 'practical') ?? answeredPrac as { id: string; question_text: string; explanation?: string } | undefined;
      return {
        ...r,
        practical_question: pq?.question_text ?? null,
        practical_reference: pq?.explanation ?? null,
        practical_answer: pq ? (answers[pq.id] ?? '') : '',
      };
    });
    // 待判定置顶，其余按创建时间倒序
    enriched.sort((a, b) => {
      const wa = a.status === 'obj_passed' ? 0 : 1;
      const wb = b.status === 'obj_passed' ? 0 : 1;
      if (wa !== wb) return wa - wb;
      return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
    });
    return NextResponse.json({ records: enriched.map(({ question_snapshot: _snapshot, ...record }) => record) });
  }

  const { data } = await client
    .from('exam_records')
    .select('id, exam_id, status, score, practical_status, started_at, submitted_at, created_at, exams(code,name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  return NextResponse.json({ records: data ?? [] });
}
