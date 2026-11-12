'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, performLogout } from '@/lib/client';
import { useAuthBootstrap } from '@/lib/use-auth-bootstrap';
import { BrandMark } from '@/components/brand-logo';

interface ExamItem {
  id: string;
  code: string;
  name: string;
  scope: string;
  pass_score: number;
  record: {
    id: string;
    status: string;
    score: number | null;
    practical_status: string;
    submitted_at: string | null;
  } | null;
  used_attempts: number;
  max_attempts: number;
  max_retries: number;
  remaining_attempts: number;
  can_retake: boolean;
  has_active: boolean;
}
interface Question {
  id: string;
  qtype: 'choice' | 'multiple' | 'truefalse' | 'practical';
  question_text: string;
  options: string[] | null;
  sort_order: number;
  has_objective: boolean;
}
interface RecordDetail {
  id: string;
  status: string;
  score: number | null;
  practical_status: string;
}
interface ReviewItem {
  id: string;
  qtype: 'choice' | 'multiple' | 'truefalse' | 'practical';
  question_text: string;
  options: string[] | null;
  my_answer: string;
  my_answer_text: string;
  correct_answer: string | null;
  correct_answer_text: string;
  explanation: string | null;
  is_correct: boolean | null;
}

const STATUS_TEXT: Record<string, string> = {
  pending: '待开始',
  in_progress: '进行中',
  obj_passed: '客观题已达标',
  failed: '未通过',
  passed: '已通过',
};

export default function ExamsPage() {
  const router = useRouter();
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [taking, setTaking] = useState<RecordDetail | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ examId?: string; score: number; passed_obj: boolean; status: string; message: string; review?: ReviewItem[] } | null>(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const boot = useAuthBootstrap();

  const loadExams = useCallback(async () => {
    try {
      const res = await api<{ exams: ExamItem[] }>('/api/exams');
      setExams(res.exams);
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (boot.loading) return;
    if (boot.error || !boot.user) {
      router.replace('/?reason=session');
      return;
    }
    loadExams();
  }, [boot.loading, boot.error, boot.user, loadExams, router]);

  const start = async (recordId: string) => {
    setBusy(true);
    setToast('');
    setResult(null);
    try {
      const res = await api<{ record: RecordDetail; questions: Question[] }>(`/api/exams/records/${recordId}`);
      setTaking(res.record);
      setQuestions(res.questions);
      setAnswers({});
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const retake = async (examId: string) => {
    setBusy(true);
    setToast('');
    setResult(null);
    try {
      const res = await api<{ record: RecordDetail; questions: Question[]; used_attempts: number; max_attempts: number; remaining_attempts: number }>(`/api/exams/${examId}/retake`, { method: 'POST' });
      await start(res.record.id);
      await loadExams();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 多选题切换选项：answers[qid] 以「升序逗号分隔下标」存储（如 "0,2"）
  const toggleMulti = (qid: string, idx: number) => {
    setAnswers((a) => {
      const cur = (a[qid] ?? '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
      const set = new Set(cur.filter((n) => Number.isInteger(n)));
      if (set.has(idx)) set.delete(idx);
      else set.add(idx);
      const next = [...set].sort((x, y) => x - y).join(',');
      return { ...a, [qid]: next };
    });
  };

  const submit = async () => {
    if (!taking) return;
    setBusy(true);
    try {
      const res = await api<{ score: number; passed_obj: boolean; status: string; message: string; review?: ReviewItem[] }>(`/api/exams/records/${taking.id}`, {
        method: 'POST',
        body: JSON.stringify({ answers }),
      });
      setResult(res);
      setToast(res.message);
      await loadExams();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const logoutHandler = async () => {
    await performLogout();
  };

  if (boot.loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#F7F8FF] text-sm text-slate-500">正在验证登录状态…</div>;
  }

  if (taking) {
    return (
      <div className="min-h-screen bg-[#F7F8FF] px-4 py-6 text-slate-800">
        <div className="mx-auto max-w-2xl">
          <button onClick={() => setTaking(null)} className="mb-3 text-xs text-slate-500 hover:text-slate-700">← 返回考核列表</button>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h1 className="text-base font-bold text-slate-900">在线答题</h1>
              <span className="text-xs text-slate-400">客观题达 {80} 分后由管理员实操判定</span>
            </div>
            <div className="space-y-5">
              {questions.map((q, i) => (
                <div key={q.id} className="rounded-lg border border-slate-100 p-3">
                  <div className="mb-2 text-sm font-medium text-slate-800">
                    <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                      {q.qtype === 'choice' ? '单选' : q.qtype === 'multiple' ? '多选' : q.qtype === 'truefalse' ? '判断' : '实操'}
                    </span>
                    {i + 1}. {q.question_text}
                  </div>
                  {q.qtype === 'choice' && q.options && (
                    <div className="ml-1 space-y-1">
                      {q.options.map((opt, idx) => (
                        <label key={idx} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                          <input
                            type="radio"
                            name={q.id}
                            value={String(idx)}
                            checked={answers[q.id] === String(idx)}
                            onChange={() => setAnswers((a) => ({ ...a, [q.id]: String(idx) }))}
                            className="accent-rose-600"
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  )}
                  {q.qtype === 'multiple' && q.options && (
                    <div className="ml-1 space-y-1">
                      <p className="mb-1 text-[11px] text-slate-400">多选题：选出所有正确项，全部选对才得分</p>
                      {q.options.map((opt, idx) => {
                        const selected = (answers[q.id] ?? '').split(',').map((s) => s.trim()).includes(String(idx));
                        return (
                          <label key={idx} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleMulti(q.id, idx)}
                              className="accent-rose-600"
                            />
                            {opt}
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {q.qtype === 'truefalse' && (
                    <div className="ml-1 flex gap-6 text-sm text-slate-700">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input type="radio" name={q.id} value="true" checked={answers[q.id] === 'true'} onChange={() => setAnswers((a) => ({ ...a, [q.id]: 'true' }))} className="accent-rose-600" />
                        正确
                      </label>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input type="radio" name={q.id} value="false" checked={answers[q.id] === 'false'} onChange={() => setAnswers((a) => ({ ...a, [q.id]: 'false' }))} className="accent-rose-600" />
                        错误
                      </label>
                    </div>
                  )}
                  {q.qtype === 'practical' && (
                    <textarea
                      value={answers[q.id] ?? ''}
                      onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                      placeholder="在此填写实操说明…"
                      rows={3}
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-rose-400"
                    />
                  )}
                </div>
              ))}
            </div>
            <button onClick={submit} disabled={busy} className="mt-5 w-full rounded-lg bg-[#5B6CFF] py-2.5 text-sm font-medium text-white hover:bg-[#4a5ae0] disabled:opacity-50">
              {busy ? '提交判分中…' : '交卷'}
            </button>
            {result && (
              <>
                <div className={`mt-3 rounded-lg p-3 text-sm ${result.passed_obj ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>
                  <p><b>客观题得分：{result.score} 分</b>（达标线 80）</p>
                  <p>{result.message}</p>
                </div>
                {result.review && result.review.length > 0 && (
                  <div className="mt-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-bold text-slate-900">答案解析</p>
                      <p className="text-[11px] text-slate-400">简述题由管理员结合关键词判定</p>
                    </div>
                    {result.review.map((item, idx) => {
                      const isObj = item.qtype !== 'practical';
                      return (
                        <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="mb-1.5 flex items-start gap-2">
                            <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                              {item.qtype === 'choice' ? '单选' : item.qtype === 'multiple' ? '多选' : item.qtype === 'truefalse' ? '判断' : '简述'}
                            </span>
                            <p className="text-sm font-medium text-slate-800">{idx + 1}. {item.question_text}</p>
                          </div>
                          {(item.qtype === 'choice' || item.qtype === 'multiple') && item.options && (
                            <div className="ml-1 mt-1 space-y-0.5">
                              {item.options.map((opt, oi) => {
                                const mySet = (item.my_answer ?? '').split(',').map((s) => s.trim()).filter(Boolean);
                                const ansSet = (item.correct_answer ?? '').split(',').map((s) => s.trim()).filter(Boolean);
                                const isSel = item.qtype === 'multiple' ? mySet.includes(String(oi)) : String(item.my_answer) === String(oi);
                                const isAns = item.qtype === 'multiple' ? ansSet.includes(String(oi)) : String(item.correct_answer) === String(oi);
                                let cls = 'text-slate-600';
                                if (isAns) cls = 'font-semibold text-emerald-600';
                                else if (isSel) cls = 'text-rose-500';
                                return (
                                  <div key={oi} className={`flex items-center gap-1.5 text-xs ${cls}`}>
                                    <span>{isAns ? '✓' : isSel ? '✗' : '○'}</span>
                                    <span>{opt}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <div className="ml-1 mt-1.5 text-xs text-slate-500">
                            {isObj ? (
                              <>
                                <span>我的答案：{item.my_answer_text || '未作答'}</span>
                                <span className="mx-1 text-slate-200">|</span>
                                <span className={item.is_correct ? 'text-emerald-600' : 'text-rose-500'}>
                                  {item.is_correct ? '回答正确' : '正确答案：' + item.correct_answer_text}
                                </span>
                              </>
                            ) : (
                              <span>简述回答已提交，等待管理员判定</span>
                            )}
                          </div>
                          {item.explanation && (
                            <div className="ml-1 mt-1.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs leading-relaxed text-slate-600">
                              <b className="text-slate-700">解析：</b>{item.explanation}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {result && result.status === 'failed' && (() => {
                  const exam = exams.find((x) => x.record?.id === taking.id);
                  if (exam && exam.can_retake) {
                    return (
                      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                        <p className="text-amber-800">本次未达标（客观题需 ≥80 分）。你还有 <b>{exam.remaining_attempts}</b> 次补考机会。</p>
                        <button
                          onClick={() => retake(exam.id)}
                          disabled={busy}
                          className="mt-2 w-full rounded-lg bg-[#5B6CFF] py-2 text-xs font-medium text-white hover:bg-[#4a5ae0] disabled:opacity-50"
                        >
                          {busy ? '正在生成补考…' : '再考一次（补考）'}
                        </button>
                      </div>
                    );
                  }
                  return <div className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-600">补考机会已用完，请联系管理员安排补训与补考。</div>;
                })()}
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F8FF] px-4 py-6 text-slate-800">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BrandMark className="h-7 w-7" />
            <div>
              <h1 className="text-lg font-bold text-slate-900">我的考核</h1>
              <p className="text-xs text-slate-400">考核由管理员发起；客观题 ≥80 分且实操通过方为达标</p>
            </div>
          </div>
          <div className="flex gap-2">
            <a href="/manual" className="rounded-md bg-slate-100 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-200">返回手册</a>
            <button onClick={logoutHandler} className="rounded-md px-3 py-1.5 text-xs text-slate-500 hover:text-rose-600">退出</button>
          </div>
        </div>
        {err && <div className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-600">{err}</div>}
        {toast && <div className="mb-3 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-600">{toast}</div>}
        <div className="space-y-3">
          {exams.map((e) => (
            <div key={e.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">{e.name}</h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    范围：{e.scope} · 达标 {e.pass_score} 分
                    {e.record && <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] ${e.record.status === 'passed' ? 'bg-emerald-50 text-emerald-600' : e.record.status === 'failed' ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-500'}`}>{STATUS_TEXT[e.record.status] ?? e.record.status}</span>}
                  </p>
                  {e.record && e.record.score != null && <p className="mt-1 text-xs text-slate-400">客观题得分：{e.record.score} · 实操：{{ pending: '待判定', passed: '已通过', failed: '未通过' }[e.record.practical_status] ?? '—'}</p>}
                  {e.record && e.record.status === 'failed' && (
                    <p className={`mt-1 text-[11px] ${e.can_retake ? 'text-amber-600' : 'text-rose-500'}`}>
                      已用 {e.used_attempts}/{e.max_attempts} 次机会{e.can_retake ? ` · 还可补考 ${e.remaining_attempts} 次` : ' · 补考机会已用完'}
                    </p>
                  )}
                </div>
                {e.record && !['passed', 'failed'].includes(e.record.status) ? (
                  <button onClick={() => start(e.record!.id)} disabled={busy} className="shrink-0 rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50">
                    {e.record.status === 'obj_passed' ? '已完成（待实操）' : '进入答题'}
                  </button>
                ) : e.record && e.record.status === 'failed' && e.can_retake ? (
                  <button onClick={() => retake(e.id)} disabled={busy} className="shrink-0 rounded-md bg-[#5B6CFF] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#4a5ae0] disabled:opacity-50">
                    补考
                  </button>
                ) : !e.record ? (
                  <span className="shrink-0 text-xs text-slate-300">未发起</span>
                ) : (
                  <span className="shrink-0 text-xs text-slate-300">已结束</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}