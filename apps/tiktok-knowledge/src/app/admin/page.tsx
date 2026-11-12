'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, performLogout } from '@/lib/client';
import { useAuthBootstrap } from '@/lib/use-auth-bootstrap';
import { BrandMark } from '@/components/brand-logo';

interface Member {
  id: string;
  name: string;
  role: string;
  tier: string;
  status: string;
  created_at: string;
  token?: string | null;
  tokenCustom?: string | null;
}
interface ExamDef { id: string; code: string; name: string; scope: string; pass_score: number; }
interface BankQuestion {
  id: string;
  qtype: 'truefalse' | 'choice' | 'multiple' | 'practical';
  question_text: string;
  options: string[] | null;
  answer: string | null;
  explanation: string | null;
  sort_order: number;
}
interface RecordRow {
  id: string;
  user_id: string;
  exam_id: string;
  status: string;
  score: number | null;
  practical_status: string;
  submitted_at: string | null;
  created_at: string;
  answers?: Record<string, string> | null;
  practical_question?: string | null;
  practical_answer?: string;
  practical_reference?: string | null;
  exams?: { name: string; code: string } | { name: string; code: string }[];
  users?: { name: string } | { name: string }[];
}
interface RPCandidate { word: string; sentence: string; score: number; }
interface RPItem {
  id: string;
  chapter_id: string;
  chapter_deleted: boolean;
  chapter_label: string;
  module: string | null;
  sentence: string;
  word: string;
  file_type: string;
  url: string | null;
  created_at: string;
  reason: string;
  current_sentences: string[];
  candidates: RPCandidate[];
}

interface LibItem {
  id: string;
  chapter_id: string;
  chapter_deleted: boolean;
  chapter_label: string;
  chapter_module: string | null;
  word: string;
  sentence: string;
  file_type: string;
  file_name: string | null;
  file_size: number;
  url: string | null;
  uploader_name: string;
  status: string;
  created_at: string;
}

const TIERS = ['M2', 'M4', 'M6'];
const ROLES = ['employee', 'admin', 'super_admin'];
const STATUS_TEXT: Record<string, string> = { pending: '待开始', in_progress: '进行中', obj_passed: '客观达标·待实操', failed: '未通过', passed: '已通过' };

function nameOf(r: { exams?: unknown } | undefined): string {
  if (!r) return '-';
  const e = r.exams as { name?: string } | { name?: string }[] | undefined;
  if (Array.isArray(e)) return e[0]?.name ?? '-';
  return (e as { name?: string } | undefined)?.name ?? '-';
}
function userOf(r: { users?: unknown } | undefined): string {
  if (!r) return '-';
  const u = r.users as { name?: string } | { name?: string }[] | undefined;
  if (Array.isArray(u)) return u[0]?.name ?? '-';
  return (u as { name?: string } | undefined)?.name ?? '-';
}

export default function AdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'members' | 'exams' | 'materials' | 'library' | 'bank'>('members');
  const [members, setMembers] = useState<Member[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [rps, setRps] = useState<RPItem[]>([]);
  const [lib, setLib] = useState<LibItem[]>([]);
  const [libStats, setLibStats] = useState({ total: 0, active: 0, re_pending: 0 });
  const [lightbox, setLightbox] = useState<{ url: string; type: string } | null>(null);
  const [exams, setExams] = useState<ExamDef[]>([]);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  // 新增成员表单
  const [name, setName] = useState('');
  const [ntoken, setNtoken] = useState('');
  const [nrole, setNrole] = useState('employee');
  const [ntier, setNtier] = useState('M2');

  // 批量导入
  const [bulkText, setBulkText] = useState('');
  const [bulkResult, setBulkResult] = useState<Member[]>([]);

  // 考核发起
  const [assignExam, setAssignExam] = useState('');
  const [assignUser, setAssignUser] = useState('');

  // 题库管理（bank）
  const [bankExam, setBankExam] = useState('');
  const [bankQtype, setBankQtype] = useState<'all' | 'truefalse' | 'choice' | 'multiple' | 'practical'>('all');
  const [bankQuestions, setBankQuestions] = useState<BankQuestion[]>([]);
  const [bankLoading, setBankLoading] = useState(false);
  const [editQ, setEditQ] = useState<BankQuestion | null>(null);
  const [eqText, setEqText] = useState('');
  const [eqOptions, setEqOptions] = useState<string[]>(['', '', '', '']);
  const [eqAnswer, setEqAnswer] = useState('');
  const [eqExplanation, setEqExplanation] = useState('');
  const [clearUserId, setClearUserId] = useState('');

  // 认证引导：处理已有会话与 URL hash 令牌免输直进
  const boot = useAuthBootstrap();
  const role = boot.user?.role ?? null;
  const isSuper = role === 'super_admin';
  const isAdminRole = role === 'admin' || role === 'super_admin';

  const loadMembers = useCallback(async () => {
    try {
      const r = await api<{ users: Member[] }>('/api/admin/users');
      setMembers(r.users);
    } catch (e) {
      setToast((e as Error).message);
    }
  }, []);
  const loadExams = useCallback(async () => {
    try {
      const r = await api<{ exams: ExamDef[] }>('/api/exams');
      setExams(r.exams);
    } catch (e) {
      setToast((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (boot.loading) return;
    if (boot.error || !boot.user) {
      router.replace('/?reason=session');
      return;
    }
    if (!isAdminRole) return;
    void loadMembers();
    void loadExams();
  }, [boot.loading, boot.error, boot.user, isAdminRole, router, loadMembers, loadExams]);

  const loadRecords = useCallback(async () => {
    try {
      const r = await api<{ records: RecordRow[] }>('/api/exams/records?all=1');
      setRecords(r.records);
    } catch (e) {
      setToast((e as Error).message);
    }
  }, []);
  const loadRP = useCallback(async () => {
    try {
      const r = await api<{ materials: RPItem[] }>('/api/admin/materials/re-pending');
      setRps(r.materials);
    } catch (e) {
      setToast((e as Error).message);
    }
  }, []);

  const loadLibrary = useCallback(async () => {
    try {
      const r = await api<{ materials: LibItem[]; stats: { total: number; active: number; re_pending: number } }>('/api/admin/materials');
      setLib(r.materials);
      setLibStats(r.stats);
    } catch (e) {
      setToast((e as Error).message);
    }
  }, []);

  const deleteLibraryItem = async (item: LibItem) => {
    if (!window.confirm(`确认删除素材「${item.file_name || item.word}」？此操作不可恢复。`)) return;
    try {
      await api(`/api/materials/${item.id}`, { method: 'DELETE' });
      setToast('已删除');
      await Promise.all([loadLibrary(), loadRP()]);
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  const openTab = (t: 'members' | 'exams' | 'materials' | 'library' | 'bank') => {
    setTab(t);
    if (t === 'exams') loadRecords();
    if (t === 'materials') loadRP();
    if (t === 'library') loadLibrary();
    if (t === 'bank') {
      const target = bankExam || exams[0]?.id || '';
      if (target && target !== bankExam) setBankExam(target);
      if (target) loadBank(target);
    }
  };

  // 题库管理：加载某考试全部题目（含答案/解析）
  const loadBank = useCallback(async (examId: string) => {
    if (!examId) { setBankQuestions([]); return; }
    setBankLoading(true);
    try {
      const r = await api<{ questions: BankQuestion[] }>(`/api/admin/questions?examId=${examId}`);
      setBankQuestions(r.questions);
    } catch {
      setToast('题库加载失败');
    } finally {
      setBankLoading(false);
    }
  }, []);

  const openEditQ = (q: BankQuestion) => {
    setEditQ(q);
    setEqText(q.question_text);
    setEqOptions(q.options ? [...q.options] : ['', '', '', '']);
    setEqAnswer(q.answer ?? '');
    setEqExplanation(q.explanation ?? '');
  };

  const toggleEqMulti = (idx: number) => {
    const cur = eqAnswer.split(',').map((s) => s.trim()).filter(Boolean).map(Number);
    const set = new Set(cur.filter((n) => Number.isInteger(n)));
    if (set.has(idx)) set.delete(idx);
    else set.add(idx);
    setEqAnswer([...set].sort((a, b) => a - b).join(','));
  };

  const saveEditQ = async () => {
    if (!editQ) return;
    setBusy(true);
    try {
      await api(`/api/admin/questions/${editQ.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          qtype: editQ.qtype,
          question_text: eqText,
          options: editQ.qtype === 'choice' || editQ.qtype === 'multiple' ? eqOptions : null,
          answer: editQ.qtype === 'practical' ? null : eqAnswer,
          explanation: eqExplanation,
        }),
      });
      setToast('题目已保存');
      setEditQ(null);
      loadBank(bankExam);
    } catch (e) {
      setToast((e as Error).message || '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const addMember = async () => {
    if (!name.trim()) return setToast('请输入姓名');
    setBusy(true);
    try {
      const r = await api<{ user: Member; token?: string }>('/api/admin/users', { method: 'POST', body: JSON.stringify({ name, token: ntoken, role: nrole, tier: ntier }) });
      setToast(`已新增「${r.user.name}」${r.token ? `，令牌：${r.token}` : ''}`);
      setName('');
      setNtoken('');
      await loadMembers();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const bulkImport = async () => {
    let arr: unknown;
    try {
      arr = JSON.parse(bulkText);
    } catch {
      return setToast('批量导入需为合法 JSON 数组');
    }
    if (!Array.isArray(arr) || arr.length === 0) return setToast('数组不能为空');
    setBusy(true);
    try {
      const r = await api<{ users: Member[] }>('/api/admin/users/bulk', { method: 'POST', body: JSON.stringify(arr) });
      setBulkResult(r.users);
      setToast(`导入 ${r.users.length} 人成功`);
      await loadMembers();
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const renameMember = async (member: Member) => {
    const updatedName = window.prompt('修改成员姓名', member.name);
    if (updatedName?.trim() && updatedName.trim() !== member.name) await patchMember(member.id, { name: updatedName.trim() });
  };

  const patchMember = async (id: string, body: Record<string, unknown>) => {
    try {
      await api(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      await loadMembers();
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  const resetCustom = async (id: string, nm: string) => {
    if (!confirm(`确认清空成员「${nm}」的自定义密令？重置后仅原始密令可用。`)) return;
    try {
      await api(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ clearCustom: true }) });
      setToast(`已重置「${nm}」的自定义密令`);
      await loadMembers();
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  const delMember = async (id: string, nm: string) => {
    if (!confirm(`确认删除成员「${nm}」？此操作不可恢复。`)) return;
    try {
      await api(`/api/admin/users/${id}`, { method: 'DELETE' });
      await loadMembers();
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  const assign = async () => {
    if (!assignExam || !assignUser) return setToast('请选择考核与成员');
    try {
      await api(`/api/admin/exams/${assignExam}/assign`, { method: 'POST', body: JSON.stringify({ userId: assignUser }) });
      setToast('考核已发起');
      loadRecords();
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  const copyToken = async (token?: string | null) => {
    if (!token) return setToast('该成员暂无令牌记录');
    try {
      await navigator.clipboard.writeText(token);
      setToast('令牌已复制');
    } catch {
      // 老浏览器兜底
      const ta = document.createElement('textarea');
      ta.value = token;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setToast('令牌已复制'); } catch { setToast('复制失败，请手动复制'); }
      document.body.removeChild(ta);
    }
  };

  // 删除单条考核记录（清理测试/误考）
  const deleteRecord = async (r: RecordRow) => {
    const nm = userOf(r);
    const em = nameOf(r);
    if (!window.confirm(`确认删除「${nm}」的「${em}」这条考核记录？\n\n删除后该记录彻底消失、不可恢复，但不会影响其当前权限。`)) return;
    try {
      await api(`/api/admin/exams/records/${r.id}`, { method: 'DELETE' });
      setToast('已删除该条记录');
      loadRecords();
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  // 清空某成员的全部考核记录
  const clearUserRecords = async () => {
    const m = members.find((x) => x.id === clearUserId);
    if (!m) { setToast('请先选择成员'); return; }
    const cnt = records.filter((r) => r.user_id === m.id).length;
    if (!window.confirm(`确认清空「${m.name}」的全部考核记录（共 ${cnt} 条）？\n\n此操作不可恢复，仅删除考试记录、不影响账号与当前权限。`)) return;
    try {
      const r = await api<{ deleted: number; name: string }>('/api/admin/exams/records/clear', { method: 'POST', body: JSON.stringify({ userId: m.id }) });
      setToast(`已清空「${r.name ?? m.name}」${r.deleted} 条记录`);
      loadRecords();
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  const practicalJudge = async (r: RecordRow, status: 'passed' | 'failed') => {
    const nm = userOf(r);
    const em = nameOf(r);
    const tip = status === 'passed'
      ? `确认将「${nm}」的「${em}」实操判定为【通过】？客观+实操双达标后该成员将获得对应权限。`
      : `确认将「${nm}」的「${em}」实操判定为【不通过】？其权限将被回收至 M2，且不可撤销。`;
    if (!window.confirm(`${tip}\n\n此操作立即生效，请核对简述题作答后再确认。`)) return;
    try {
      await api(`/api/admin/exams/records/${r.id}/practical`, { method: 'POST', body: JSON.stringify({ status }) });
      setToast('已判定');
      loadRecords();
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  // 重新挂接：跳到手册页，由系统做模糊匹配并高亮推荐词，点击即挂接（3 次点击内完成）；
  // 原章节已删除时，进入手册后自行选择章节并右键/长按选词挂接。
  const relink = (id: string) => {
    // 先把 repin 目标暂存到 sessionStorage：登录硬刷新/认证弹回时 URL 的 ?repin= 可能丢失，
    // 手册页会用它兜底恢复，保证重新挂接不因刷新/登录跳转而中断。
    try {
      sessionStorage.setItem('manual-repin-id', id);
    } catch {
      /* ignore */
    }
    router.push(`/manual?repin=${encodeURIComponent(id)}`);
  };
  const delRP = async (id: string, word: string) => {
    if (!window.confirm(`确认删除素材「${word}」？该操作不可恢复，素材文件也会被删除。`)) return;
    try {
      await api(`/api/materials/${id}`, { method: 'DELETE' });
      setToast('素材已删除');
      loadRP();
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  // 句子中高亮原锚点词
  const highlightWord = (sentence: string, word: string) => {
    const idx = sentence.toLowerCase().indexOf(word.toLowerCase());
    if (idx < 0) return <span className="break-words">{sentence}</span>;
    return (
      <span className="break-words">
        {sentence.slice(0, idx)}
        <mark className="rounded bg-amber-200 px-0.5 font-semibold text-amber-900">{sentence.slice(idx, idx + word.length)}</mark>
        {sentence.slice(idx + word.length)}
      </span>
    );
  };

  const logoutHandler = async () => {
    await performLogout();
  };

  if (boot.loading) {
    return <div className="flex min-h-screen items-center justify-center bg-[#F7F8FF] text-sm text-slate-500">正在验证登录状态…</div>;
  }
  // 无权限：普通员工访问管理后台
  if (boot.user && !isAdminRole) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F8FF] px-4">
        <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <div className="text-3xl">🔒</div>
          <h1 className="mt-3 text-base font-semibold text-slate-900">无访问权限</h1>
          <p className="mt-2 text-sm text-slate-500">
            当前身份「{boot.user.name} · {boot.user.role === 'employee' ? '员工' : boot.user.role}」无权访问管理后台，仅管理员/超管可进入。
          </p>
          <button
            onClick={() => router.push('/manual')}
            className="mt-5 w-full rounded-lg bg-[#5B6CFF] py-2.5 text-sm font-medium text-white hover:bg-[#4a5ae0]"
          >
            返回手册
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F8FF] text-slate-800">
      <header className="sticky top-0 z-[1500] flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-2">
          <BrandMark className="h-7 w-7" />
          <span className="text-sm font-semibold">管理后台</span>
        </div>
        <div className="flex items-center gap-2">
          <a href="/admin/knowledge" className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs text-white hover:bg-indigo-500">知识库管理</a>
          {boot.user?.role === 'super_admin' && <a href="/admin/data" className="rounded-md bg-slate-100 px-2.5 py-1 text-xs hover:bg-slate-200">数据与备份</a>}
          <a href="/manual" className="rounded-md bg-slate-100 px-2.5 py-1 text-xs hover:bg-slate-200">返回手册</a>
          <button onClick={logoutHandler} className="rounded-md px-2 py-1 text-xs text-slate-500 hover:text-rose-600">退出</button>
        </div>
      </header>
      {toast && <div className="fixed left-1/2 top-12 z-[2500] -translate-x-1/2 rounded-lg bg-[#5B6CFF] px-4 py-2 text-xs text-white shadow">{toast}</div>}

      <div className="mx-auto max-w-5xl px-4 py-5">
        <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-white p-1 shadow-sm">
          {(['members', 'exams', 'bank', 'library', 'materials'] as const).map((t) => (
            <button key={t} onClick={() => openTab(t)} className={`min-w-fit flex-1 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium transition ${tab === t ? 'bg-[#5B6CFF] text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {{
                members: '成员管理',
                exams: '考核管理',
                bank: '题库管理',
                library: `素材库(${libStats.total})`,
                materials: `待重挂${rps.length ? `(${rps.length})` : ''}`,
              }[t]}
            </button>
          ))}
        </div>

        {/* 成员管理 */}
        {tab === 'members' && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">新增成员</h3>
                <div className="space-y-2">
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="姓名 *" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-rose-400" />
                  <input value={ntoken} onChange={(e) => setNtoken(e.target.value)} placeholder="令牌（留空自动生成）" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-rose-400" />
                  <div className="grid grid-cols-2 gap-2">
                    <select value={nrole} onChange={(e) => setNrole(e.target.value)} className="rounded-md border border-slate-300 px-2 py-2 text-sm outline-none">
                      <option value="employee">员工</option>
                      {isSuper && <option value="admin">管理员</option>}
                      {isSuper && <option value="super_admin">超管</option>}
                    </select>
                    <select value={ntier} onChange={(e) => setNtier(e.target.value)} className="rounded-md border border-slate-300 px-2 py-2 text-sm outline-none">
                      {TIERS.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <button onClick={addMember} disabled={busy} className="w-full rounded-md bg-[#5B6CFF] py-2 text-sm text-white hover:bg-[#4a5ae0] disabled:opacity-50">新增</button>
                </div>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-800">批量导入（迁移旧系统令牌）</h3>
                <textarea value={bulkText} onChange={(e) => setBulkText(e.target.value)} rows={4} placeholder='[{ "name":"张三","token":"zz-001","role":"employee","tier":"M2" }, ...]' className="w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-rose-400" />
                <button onClick={bulkImport} disabled={busy} className="mt-2 w-full rounded-md bg-[#5B6CFF] py-2 text-sm text-white hover:bg-[#4a5ae0] disabled:opacity-50">导入</button>
                {bulkResult.length > 0 && (
                  <div className="mt-2 max-h-40 overflow-auto rounded-md bg-[#F7F8FF] p-2 text-xs">
                    {bulkResult.map((u) => (
                      <div key={u.id} className="flex justify-between py-0.5">
                        <span>{u.name}</span>
                        <code className="text-rose-600">{(u as Member & { token?: string }).token ?? '—'}</code>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* 移动端：成员卡片 */}
            <div className="space-y-2 md:hidden">
              {members.map((m) => (
                <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800">{m.name}{(isSuper || m.role === 'employee') && <button onClick={() => void renameMember(m)} className="ml-2 text-xs text-indigo-600">改名</button>}</div>
                      <div className="mt-0.5 text-[11px] text-slate-400">{m.role === 'super_admin' ? '超管' : m.role === 'admin' ? '管理员' : '员工'} · {m.tier}</div>
                    </div>
                    <button disabled={!isSuper && m.role !== 'employee'} onClick={() => patchMember(m.id, { status: m.status === 'active' ? 'disabled' : 'active' })} className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${m.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                      {m.status === 'active' ? '已启用' : '已停用'}
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {isSuper && (
                      <select value={m.role} onChange={(e) => patchMember(m.id, { role: e.target.value })} className="rounded border border-slate-200 px-1.5 py-1">
                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    )}
                    <select disabled={!isSuper && m.role !== 'employee'} value={m.tier} onChange={(e) => patchMember(m.id, { tier: e.target.value })} className="rounded border border-slate-200 px-1.5 py-1">
                      {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <span className="inline-flex items-center gap-1 rounded bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                      原始:{(m as Member & { token?: string | null }).token || '无'}
                    </span>
                    <button onClick={() => copyToken((m as Member & { token?: string | null }).token)} className="rounded bg-[#5B6CFF] px-2 py-0.5 text-[11px] text-white hover:bg-[#4a5ae0]">复制</button>
                    <span className="inline-flex items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 font-mono text-[11px] text-violet-700">
                      自定义:{(m as Member & { tokenCustom?: string | null }).tokenCustom || '未设置'}
                    </span>
                    <button onClick={() => copyToken((m as Member & { tokenCustom?: string | null }).tokenCustom)} className="rounded bg-violet-500 px-2 py-0.5 text-[11px] text-white hover:bg-violet-400">复制</button>
                    {(m as Member & { tokenCustom?: string | null }).tokenCustom ? (
                      <button disabled={!isSuper && m.role !== 'employee'} onClick={() => resetCustom(m.id, m.name)} className="rounded bg-rose-50 px-2 py-0.5 text-[11px] text-rose-600 hover:bg-rose-100">重置自定义</button>
                    ) : null}
                    <button disabled={!isSuper && m.role !== 'employee'} onClick={() => delMember(m.id, m.name)} className="ml-auto rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-600">删除</button>
                  </div>
                </div>
              ))}
            </div>

            {/* 桌面端：成员表格 */}
            <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                    <th className="px-4 py-2.5 font-medium">姓名</th>
                    <th className="px-3 py-2.5 font-medium">角色</th>
                    <th className="px-3 py-2.5 font-medium">级别</th>
                    <th className="px-3 py-2.5 font-medium">状态</th>
                    <th className="px-3 py-2.5 font-medium">登录令牌</th>
                    <th className="px-3 py-2.5 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                      <td className="px-4 py-2">{m.name}{(isSuper || m.role === 'employee') && <button onClick={() => void renameMember(m)} className="ml-2 text-xs text-indigo-600">改名</button>}</td>
                      <td className="px-3 py-2">
                        {isSuper ? (
                          <select value={m.role} onChange={(e) => patchMember(m.id, { role: e.target.value })} className="rounded border border-slate-200 px-1.5 py-1 text-xs">
                            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                        ) : (
                          <span className="text-xs">{m.role === 'super_admin' ? '超管' : m.role === 'admin' ? '管理员' : '员工'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <select disabled={!isSuper && m.role !== 'employee'} value={m.tier} onChange={(e) => patchMember(m.id, { tier: e.target.value })} className="rounded border border-slate-200 px-1.5 py-1 text-xs">
                          {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <button disabled={!isSuper && m.role !== 'employee'} onClick={() => patchMember(m.id, { status: m.status === 'active' ? 'disabled' : 'active' })} className={`rounded-full px-2 py-0.5 text-[11px] ${m.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                          {m.status === 'active' ? '已启用' : '已停用'}
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <code className="font-mono text-[11px] text-slate-500">原始:{(m as Member & { token?: string | null }).token || '—'}</code>
                            <button onClick={() => copyToken((m as Member & { token?: string | null }).token)} className="rounded bg-[#5B6CFF] px-1.5 py-0.5 text-[10px] text-white hover:bg-[#4a5ae0]">复制</button>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <code className="font-mono text-[11px] text-violet-600">自定义:{(m as Member & { tokenCustom?: string | null }).tokenCustom || '未设置'}</code>
                            <button onClick={() => copyToken((m as Member & { tokenCustom?: string | null }).tokenCustom)} className="rounded bg-violet-500 px-1.5 py-0.5 text-[10px] text-white hover:bg-violet-400">复制</button>
                            {(m as Member & { tokenCustom?: string | null }).tokenCustom ? (
                              <button disabled={!isSuper && m.role !== 'employee'} onClick={() => resetCustom(m.id, m.name)} className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-600 hover:bg-rose-100">重置自定义</button>
                            ) : null}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <button disabled={!isSuper && m.role !== 'employee'} onClick={() => delMember(m.id, m.name)} className="text-xs text-slate-400 hover:text-rose-600">删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 考核管理 */}
        {tab === 'exams' && (
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-800">对员工发起考核</h3>
              <div className="grid gap-2 sm:grid-cols-3">
                <select value={assignExam} onChange={(e) => setAssignExam(e.target.value)} className="rounded-md border border-slate-300 px-2 py-2 text-sm">
                  <option value="">选择考核</option>
                  {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <select value={assignUser} onChange={(e) => setAssignUser(e.target.value)} className="rounded-md border border-slate-300 px-2 py-2 text-sm">
                  <option value="">选择成员</option>
                  {members.filter((m) => m.role === 'employee').map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <button onClick={assign} className="rounded-md bg-[#5B6CFF] py-2 text-sm text-white hover:bg-[#4a5ae0]">发起考核</button>
              </div>
              <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <select value={clearUserId} onChange={(e) => setClearUserId(e.target.value)} className="rounded-md border border-slate-300 px-2 py-2 text-sm">
                  <option value="">选择要清空考核记录的成员</option>
                  {members.filter((m) => m.role === 'employee').map((m) => <option key={m.id} value={m.id}>{m.name}（{records.filter((r) => r.user_id === m.id).length} 条）</option>)}
                </select>
                <button onClick={clearUserRecords} className="rounded-md border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-100">清空该成员记录</button>
              </div>
            </div>
            {(() => {
              const judgingCount = records.filter((r) => r.status === 'obj_passed').length;
              return judgingCount > 0 ? (
                <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-800">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                  有 <b>{judgingCount}</b> 条考核待你判定（客观题已达标，请阅读下方简述题作答后点「通过 / 不过」）
                </div>
              ) : null;
            })()}
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full min-w-[680px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                    <th className="px-4 py-2.5 font-medium">成员</th>
                    <th className="px-3 py-2.5 font-medium">考核</th>
                    <th className="px-3 py-2.5 font-medium">得分</th>
                    <th className="px-3 py-2.5 font-medium">实操</th>
                    <th className="px-3 py-2.5 font-medium">状态</th>
                    <th className="px-3 py-2.5 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => {
                    const judging = r.status === 'obj_passed';
                    return (
                      <Fragment key={r.id}>
                        <tr className={judging ? 'border-b border-amber-100 bg-amber-50/70' : 'border-b border-slate-50'}>
                          <td className="px-4 py-2">{userOf(r)}</td>
                          <td className="px-3 py-2">{nameOf(r)}</td>
                          <td className="px-3 py-2">{r.score ?? '—'}</td>
                          <td className="px-3 py-2">
                            {judging
                              ? <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-800">待判定</span>
                              : ({ pending: '待判定', passed: '通过', failed: '未通过' }[r.practical_status] ?? '—')}
                          </td>
                          <td className="px-3 py-2"><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px]">{STATUS_TEXT[r.status] ?? r.status}</span></td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              {judging && (
                                <>
                                  <button onClick={() => practicalJudge(r, 'passed')} className="rounded-md bg-emerald-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-emerald-600">通过</button>
                                  <button onClick={() => practicalJudge(r, 'failed')} className="rounded-md bg-rose-500 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-rose-600">不过</button>
                                </>
                              )}
                              <button onClick={() => deleteRecord(r)} className="rounded-md border border-slate-200 px-2 py-1 text-[12px] text-slate-500 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600">删除</button>
                            </div>
                          </td>
                        </tr>
                        {judging && (
                          <tr className="border-b border-amber-100 bg-amber-50/40">
                            <td colSpan={6} className="px-4 py-2.5">
                              {r.practical_question ? (
                                <div className="text-[12px] leading-relaxed">
                                  <p className="font-medium text-slate-700">简述题：{r.practical_question}</p>
                                  {r.practical_reference && <p className="mt-1 text-slate-500">参考答案：{r.practical_reference}</p>}
                                  <p className="mt-1 text-slate-600">员工作答：{r.practical_answer ? r.practical_answer : <span className="text-slate-400">（未作答）</span>}</p>
                                </div>
                              ) : (
                                <span className="text-[12px] text-slate-400">简述题信息加载失败，可结合试卷判定</span>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 素材库（全部素材总览） */}
        {tab === 'library' && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800">素材管理</h3>
              <div className="flex gap-2 text-[11px] text-slate-500">
                <span className="rounded-full bg-slate-100 px-2 py-0.5">共 {libStats.total}</span>
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-600">已挂 {libStats.active}</span>
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-600">待重挂 {libStats.re_pending}</span>
              </div>
            </div>
            <p className="mb-3 text-xs text-slate-400">全部上传素材总览：可判断素材是否真正挂上、点「定位到正文」进入手册查看、或删除（二次确认）。</p>
            {lib.length === 0 ? (
              <p className="text-sm text-slate-400">暂无素材</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {lib.map((m) => (
                  <div key={m.id} className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <div className="flex w-28 shrink-0 items-center justify-center">
                      {m.url ? (
                        m.file_type === 'video' ? (
                          <button type="button" onClick={() => setLightbox({ url: m.url as string, type: 'video' })} className="group relative block h-24 w-28 overflow-hidden rounded-lg bg-black" aria-label="播放视频">
                            <video src={m.url} preload="metadata" muted playsInline className="h-full w-full object-cover opacity-80" />
                            <span className="absolute inset-0 flex items-center justify-center">
                              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-rose-600 shadow group-hover:scale-110">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                              </span>
                            </span>
                          </button>
                        ) : (
                          <button type="button" onClick={() => setLightbox({ url: m.url as string, type: 'image' })} className="block h-24 w-28 overflow-hidden rounded-lg">
                            <img src={m.url} alt={m.word} className="h-full w-full object-cover" />
                          </button>
                        )
                      ) : (
                        <div className="flex h-24 w-28 items-center justify-center rounded-lg bg-slate-200 text-[10px] text-slate-400">无预览</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${m.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {m.status === 'active' ? '已挂' : '待重挂'}
                        </span>
                        <span className="text-slate-400">{m.file_type === 'video' ? '🎬 视频' : '🖼 图片'}</span>
                      </div>
                      <div className="mt-1 truncate font-medium text-slate-800" title={m.file_name ?? ''}>{m.file_name || '未命名'}</div>
                      <div className="mt-0.5 text-slate-500">
                        {m.chapter_deleted ? <span className="text-rose-500">章节已删除</span> : <span>{m.chapter_label}</span>}
                        <span className="mx-1 text-slate-300">·</span>锚点词「{m.word}」
                      </div>
                      <div className="mt-0.5 text-slate-400">
                        {m.file_size ? `${(m.file_size / 1048576).toFixed(1)}MB · ` : ''}{m.uploader_name} · {new Date(m.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </div>
                      <div className="mt-2 flex gap-1.5">
                        {!m.chapter_deleted && (
                          <a
                            href={m.word ? `/manual#${m.chapter_id}/${encodeURIComponent(m.word)}` : `/manual#${m.chapter_id}`}
                            className="rounded bg-[#5B6CFF] px-2 py-1 text-[11px] text-white hover:bg-slate-700"
                          >
                            定位到正文
                          </a>
                        )}
                        <button onClick={() => deleteLibraryItem(m)} className="rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-600 hover:bg-rose-100">删除</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 待重挂素材 */}
        {tab === 'bank' && (
          <div>
            <div className="mb-3 rounded-lg bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={bankExam}
                  onChange={(e) => { setBankExam(e.target.value); loadBank(e.target.value); }}
                  className="rounded-md border border-slate-300 px-2 py-2 text-sm"
                >
                  {exams.map((x) => <option key={x.id} value={x.id}>{x.name}（{x.code}）</option>)}
                </select>
                <div className="flex gap-1">
                  {(['all', 'truefalse', 'choice', 'multiple', 'practical'] as const).map((qt) => (
                    <button
                      key={qt}
                      onClick={() => setBankQtype(qt)}
                      className={`rounded-md px-2.5 py-1.5 text-xs ${bankQtype === qt ? 'bg-[#5B6CFF] text-white' : 'bg-slate-100 text-slate-600'}`}
                    >
                      {{ all: '全部', truefalse: '判断', choice: '单选', multiple: '多选', practical: '简述' }[qt]}
                    </button>
                  ))}
                </div>
                <span className="ml-auto text-xs text-slate-400">
                  {bankLoading
                    ? '加载中…'
                    : (() => {
                        const c = (t: string) => bankQuestions.filter((q) => q.qtype === t).length;
                        return `判断${c('truefalse')} 单选${c('choice')} 多选${c('multiple')} 简述${c('practical')}`;
                      })()}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              {bankQuestions
                .filter((q) => bankQtype === 'all' || q.qtype === bankQtype)
                .map((q) => (
                  <div key={q.id} className="rounded-lg bg-white p-3 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium text-slate-800">
                        <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                          {q.qtype === 'choice' ? '单选' : q.qtype === 'multiple' ? '多选' : q.qtype === 'truefalse' ? '判断' : '简述'}
                        </span>
                        {q.question_text}
                      </p>
                      <button
                        onClick={() => openEditQ(q)}
                        className="shrink-0 rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        编辑
                      </button>
                    </div>
                    {(q.qtype === 'choice' || q.qtype === 'multiple') && q.options && (
                      <div className="ml-1 mt-2 space-y-1">
                        {q.options.map((opt, oi) => {
                          const ansIdx = q.qtype === 'multiple' ? (q.answer ?? '').split(',').map((s) => s.trim()) : [q.answer ?? ''];
                          const isAns = ansIdx.includes(String(oi));
                          return (
                            <div key={oi} className={`flex items-center gap-1.5 text-xs ${isAns ? 'font-semibold text-emerald-600' : 'text-slate-600'}`}>
                              <span>{isAns ? '✓' : '○'}</span>
                              <span>{opt}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {q.qtype === 'truefalse' && (
                      <p className="ml-1 mt-2 text-xs text-slate-600">
                        正确答案：<b className={q.answer === 'true' ? 'text-emerald-600' : 'text-rose-500'}>{q.answer === 'true' ? '正确' : '错误'}</b>
                      </p>
                    )}
                    {q.explanation && (
                      <p className="ml-1 mt-1.5 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs leading-relaxed text-slate-600">
                        <b className="text-slate-700">{q.qtype === 'practical' ? '参考答案：' : '解析：'}</b>
                        {q.explanation}
                      </p>
                    )}
                  </div>
                ))}
              {!bankLoading && bankQuestions.length === 0 && (
                <p className="py-10 text-center text-sm text-slate-400">该考试暂无题目</p>
              )}
            </div>
          </div>
        )}

        {tab === 'materials' && (
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="mb-1 text-sm font-semibold text-slate-800">待重挂素材清单</h3>
            <p className="mb-3 text-xs text-slate-400">正文被编辑后自动匹配失败。可预览素材、查看原句与当前正文，点「重新挂接」进入手册选择推荐词。</p>
            {rps.length === 0 ? (
              <p className="text-sm text-slate-400">暂无待重挂素材</p>
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {rps.map((m) => (
                  <div key={m.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:flex-row">
                    {/* 素材预览 */}
                    <div className="flex w-full shrink-0 items-center justify-center sm:w-36">
                      {m.url ? (
                        m.file_type === 'video' ? (
                          <button
                            type="button"
                            onClick={() => setLightbox({ url: m.url as string, type: 'video' })}
                            className="group relative block h-28 w-full overflow-hidden rounded-lg bg-black sm:h-24 sm:w-36"
                            aria-label="播放视频"
                          >
                            <video src={m.url} preload="metadata" muted playsInline className="h-full w-full object-cover opacity-80" />
                            <span className="absolute inset-0 flex items-center justify-center">
                              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-rose-600 shadow group-hover:scale-110">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                              </span>
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setLightbox({ url: m.url as string, type: 'image' })}
                            className="block h-28 w-full overflow-hidden rounded-lg bg-white sm:h-24 sm:w-36"
                            aria-label="查看图片"
                          >
                            <img src={m.url} alt={m.word} loading="lazy" className="h-full w-full object-cover" />
                          </button>
                        )
                      ) : (
                        <div className="flex h-24 w-36 items-center justify-center rounded-lg bg-slate-200 text-[11px] text-slate-400">预览加载失败</div>
                      )}
                    </div>

                    {/* 上下文信息 */}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className={`rounded px-1.5 py-0.5 font-medium ${m.file_type === 'video' ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700'}`}>
                          {m.file_type === 'video' ? '🎬 视频' : '🖼 图片'}
                        </span>
                        <span className={`rounded px-1.5 py-0.5 font-medium ${m.chapter_deleted ? 'bg-rose-100 text-rose-700' : 'bg-slate-200 text-slate-600'}`}>
                          {m.chapter_deleted ? `⚠️ 原章节 ${(m.chapter_label.match(/\d+\.\d+/) ?? ['?'])[0]} 已删除` : m.chapter_label}
                        </span>
                      </div>

                      <div className="mt-2 text-[11px] font-semibold text-slate-500">原句</div>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-700">{highlightWord(m.sentence, m.word)}</p>
                      <div className="mt-1.5 text-[11px] text-amber-700">失配原因：{m.reason}</div>

                      {!m.chapter_deleted && m.current_sentences.length > 0 && (
                        <>
                          <div className="mt-2 text-[11px] font-semibold text-slate-500">当前正文相关段落</div>
                          <div className="mt-0.5 max-h-20 space-y-1 overflow-auto rounded bg-white p-1.5">
                            {m.current_sentences.map((s, i) => (
                              <p key={i} className="text-[11px] leading-relaxed text-slate-500">{s}</p>
                            ))}
                          </div>
                        </>
                      )}

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button onClick={() => relink(m.id)} className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700">
                          {m.chapter_deleted ? '挂到其他章节' : '重新挂接'}
                        </button>
                        <button onClick={() => delRP(m.id, m.word)} className="rounded-md bg-white px-3 py-1.5 text-xs text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50">
                          删除素材
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 素材预览弹层 */}
      {lightbox && (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/80 p-4" onClick={() => setLightbox(null)}>
          <button className="absolute right-4 top-4 text-white/80 hover:text-white" aria-label="关闭">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
          </button>
          {lightbox.type === 'video' ? (
            <video src={lightbox.url} controls autoPlay playsInline className="max-h-[85vh] max-w-full rounded-lg" onClick={(e) => e.stopPropagation()} />
          ) : (
            <img src={lightbox.url} alt="素材预览" className="max-h-[85vh] max-w-full rounded-lg object-contain" onClick={(e) => e.stopPropagation()} />
          )}
        </div>
      )}

      {/* 题库编辑弹层 */}
      {editQ && (
        <div className="fixed inset-0 z-[2600] flex items-center justify-center bg-black/50 p-4" onClick={() => setEditQ(null)}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <p className="mb-3 text-sm font-bold text-slate-900">
              编辑题目（{editQ.qtype === 'choice' ? '单选' : editQ.qtype === 'multiple' ? '多选' : editQ.qtype === 'truefalse' ? '判断' : '简述'}）
            </p>

            <label className="mb-1 block text-xs text-slate-500">题干</label>
            <textarea
              value={eqText}
              onChange={(e) => setEqText(e.target.value)}
              rows={3}
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#5B6CFF]"
            />

            {(editQ.qtype === 'choice' || editQ.qtype === 'multiple') && (
              <div className="mb-3">
                <label className="mb-1 block text-xs text-slate-500">
                  选项（{editQ.qtype === 'multiple' ? '勾选所有正确项，至少 2 项' : '选中唯一正确项'}）
                </label>
                {eqOptions.map((opt, oi) => (
                  <div key={oi} className="mb-1.5 flex items-center gap-2">
                    <input
                      type={editQ.qtype === 'multiple' ? 'checkbox' : 'radio'}
                      name="eq-answer"
                      checked={
                        editQ.qtype === 'multiple'
                          ? eqAnswer.split(',').map((s) => s.trim()).includes(String(oi))
                          : eqAnswer === String(oi)
                      }
                      onChange={() => (editQ.qtype === 'multiple' ? toggleEqMulti(oi) : setEqAnswer(String(oi)))}
                      className="accent-[#5B6CFF]"
                    />
                    <input
                      value={opt}
                      onChange={(e) => { const arr = [...eqOptions]; arr[oi] = e.target.value; setEqOptions(arr); }}
                      placeholder={`选项 ${oi + 1}`}
                      className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-[#5B6CFF]"
                    />
                  </div>
                ))}
              </div>
            )}

            {editQ.qtype === 'truefalse' && (
              <div className="mb-3">
                <label className="mb-1 block text-xs text-slate-500">正确答案</label>
                <select value={eqAnswer} onChange={(e) => setEqAnswer(e.target.value)} className="rounded-md border border-slate-300 px-2 py-2 text-sm">
                  <option value="">请选择</option>
                  <option value="true">正确</option>
                  <option value="false">错误</option>
                </select>
              </div>
            )}

            <label className="mb-1 block text-xs text-slate-500">
              {editQ.qtype === 'practical' ? '参考答案（管理员判定对照）' : '解析'}
            </label>
            <textarea
              value={eqExplanation}
              onChange={(e) => setEqExplanation(e.target.value)}
              rows={4}
              className="mb-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#5B6CFF]"
            />

            <div className="flex justify-end gap-2">
              <button onClick={() => setEditQ(null)} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={saveEditQ} disabled={busy} className="rounded-md bg-[#5B6CFF] px-3 py-2 text-sm text-white hover:bg-[#4a5ae0] disabled:opacity-50">
                {busy ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
