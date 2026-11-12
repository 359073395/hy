'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuthBootstrap } from '@/lib/use-auth-bootstrap';
import { api } from '@/lib/client';
import { MODULES } from '@/lib/constants';

interface Preview { chapters: number; newChapters: number; existingChapters: number; exams: number; questions: number; assets: number; assetBytes: number; }
interface ImportResult { addedChapters: number; updatedChapters: number; skippedChapters: number; addedQuestions: number; updatedQuestions: number; }

async function knowledgeRequest(body: unknown) {
  const response = await fetch('/api/admin/knowledge', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json() as { error?: string; preview?: Preview; result?: ImportResult };
  if (!response.ok) throw new Error(data.error ?? '操作失败');
  return data;
}

export default function KnowledgeAdminPage() {
  const boot = useAuthBootstrap();
  const [pack, setPack] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mode, setMode] = useState<'add' | 'update'>('add');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [module, setModule] = useState('M1');
  const [sectionNo, setSectionNo] = useState('');
  const [title, setTitle] = useState('');

  if (boot.loading) return <p className="p-8">正在验证登录状态…</p>;
  if (!boot.user) return <main className="p-8"><Link href="/">请先登录</Link></main>;
  if (!['admin', 'super_admin'].includes(boot.user.role)) return <main className="p-8">仅管理员可管理知识库。<a className="ml-4 underline" href="/manual">返回手册</a></main>;

  const selectFile = async (file?: File) => {
    setPreview(null); setResult(null); setPack(null); setError('');
    if (!file) return;
    setFileName(file.name);
    if (file.size > 40 * 1024 * 1024) { setError('知识包不能超过40MB'); return; }
    setBusy(true);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const data = await knowledgeRequest({ action: 'preview', package: parsed });
      if (!data.preview) throw new Error('服务器未返回预览');
      setPack(parsed); setPreview(data.preview);
    } catch (error) { setError(error instanceof Error ? error.message : '文件读取失败'); }
    finally { setBusy(false); }
  };

  const apply = async () => {
    if (!pack || !preview) return;
    if (mode === 'update' && !window.confirm('更新包内同编号章节和同题干题目？修改前的章节正文会保存历史版本。')) return;
    setBusy(true); setError('');
    try {
      const data = await knowledgeRequest({ action: 'apply', mode, package: pack });
      if (!data.result) throw new Error('服务器未返回导入结果');
      setResult(data.result); setPreview(null); setPack(null);
    } catch (error) { setError(error instanceof Error ? error.message : '导入失败'); }
    finally { setBusy(false); }
  };

  const download = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/admin/knowledge', { credentials: 'same-origin' });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error ?? '导出失败'); }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = 'knowledge-package.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setError(error instanceof Error ? error.message : '导出失败'); }
    finally { setBusy(false); }
  };

  const createChapter = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const created = await api<{ id: string }>('/api/admin/chapters', { method: 'POST', body: JSON.stringify({ module, sectionNo, title, sortOrder: 1000, isPublic: ['M7', 'M8', 'APPENDIX'].includes(module), html: '<p>点击本小节的编辑按钮，填写正文。</p>' }) });
      window.location.assign(`/manual#${created.id}`);
    } catch (error) { setError(error instanceof Error ? error.message : '新增章节失败'); setBusy(false); }
  };

  return <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
    <header className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-xl font-bold">知识库管理</h1><nav className="flex gap-4 text-sm"><a className="underline" href="/admin">管理后台</a><a className="underline" href="/manual">阅读与编辑手册</a></nav></header>
    {error && <div role="alert" className="rounded-lg bg-rose-50 p-4 text-rose-700">{error}</div>}
    <section className="space-y-4 rounded-xl border bg-white p-6">
      <h2 className="text-lg font-semibold">导入知识更新</h2>
      <p className="text-sm text-slate-600">上传知识包 JSON，导入章节、题库和正文图片。知识包最大40MB，图片合计最大32MB。包外章节及人员考核记录会保留，已开始考试使用原试题。</p>
      <label className="block text-sm font-medium">选择知识包<input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => void selectFile(event.target.files?.[0])} className="mt-2 block w-full rounded border p-2" /></label>
      {busy && <p role="status" className="text-sm text-indigo-600">正在处理，请稍候…</p>}
      {preview && <div className="space-y-4 rounded-lg bg-slate-50 p-4">
        <p className="break-all font-medium">{fileName}</p>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3"><div><dt>章节</dt><dd>{preview.chapters} 个，新增 {preview.newChapters} 个，已有 {preview.existingChapters} 个</dd></div><div><dt>题库</dt><dd>{preview.exams} 套，{preview.questions} 道题</dd></div><div><dt>正文图片</dt><dd>{preview.assets} 张，{(preview.assetBytes / 1024 / 1024).toFixed(1)} MB</dd></div></dl>
        <label className="block text-sm">导入方式<select disabled={busy} value={mode} onChange={(event) => setMode(event.target.value as 'add' | 'update')} className="ml-3 rounded border bg-white p-2"><option value="add">仅新增，跳过已有章节和同题干题目</option><option value="update">更新已有章节和同题干题目</option></select></label>
        <button disabled={busy} onClick={() => void apply()} className="rounded-lg bg-indigo-600 px-4 py-2 text-white disabled:opacity-50">确认导入</button>
      </div>}
      {result && <p role="status" className="rounded-lg bg-emerald-50 p-4 text-emerald-800">导入完成。新增章节 {result.addedChapters} 个，更新 {result.updatedChapters} 个，跳过 {result.skippedChapters} 个。新增题目 {result.addedQuestions} 道，更新 {result.updatedQuestions} 道。</p>}
    </section>
    <section className="space-y-4 rounded-xl border bg-white p-6"><h2 className="text-lg font-semibold">新增章节</h2><form onSubmit={(event) => void createChapter(event)} className="flex flex-wrap items-end gap-3"><label className="text-sm">模块<select value={module} onChange={(event) => setModule(event.target.value)} className="mt-1 block rounded border p-2">{MODULES.map((m) => <option key={m.code} value={m.code}>{m.code} {m.label}</option>)}</select></label><label className="text-sm">章节编号<input required maxLength={16} value={sectionNo} onChange={(event) => setSectionNo(event.target.value)} placeholder="例如 1.17" className="mt-1 block w-28 rounded border p-2" /></label><label className="grow text-sm">标题<input required maxLength={255} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label><button disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-white disabled:opacity-50">新增并打开</button></form><p className="text-sm text-slate-500">新增后在手册中点击“编辑”填写正文，也可查看和恢复章节历史版本。</p></section>
    <section className="space-y-3 rounded-xl border bg-white p-6"><h2 className="text-lg font-semibold">导出知识包</h2><p className="text-sm text-slate-600">下载当前章节、题库和正文内图片，供迁移或后续更新。选词挂接的视频附件通过服务器数据备份保存。</p><button disabled={busy} onClick={() => void download()} className="rounded-lg border px-4 py-2 disabled:opacity-50">下载知识包 JSON</button></section>
  </main>;
}
