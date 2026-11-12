'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthBootstrap } from '@/lib/use-auth-bootstrap';
import { api } from '@/lib/client';
import { MODULES } from '@/lib/constants';
import { loopSchema, type LoopStation } from '@/lib/knowledge-package';

interface Preview { chapters: number; newChapters: number; existingChapters: number; exams: number; questions: number; assets: number; assetBytes: number; loopStations: number; }
interface ImportResult { addedChapters: number; updatedChapters: number; skippedChapters: number; filledChapterContents: number; addedQuestions: number; updatedQuestions: number; loopStations: number; }
interface KnowledgeStatus { chapters: number; exams: number; questions: number; assets: number; loopStations: number; loop: LoopStation[] | null; loopError: string | null; loopRevision: string; }

async function knowledgeRequest(body: unknown) {
  const response = await fetch('/api/admin/knowledge', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json() as { error?: string; preview?: Preview; result?: ImportResult };
  if (!response.ok) throw new Error(data.error ?? '操作失败');
  return data;
}

export default function KnowledgeAdminPage() {
  const boot = useAuthBootstrap();
  const router = useRouter();
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
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [stations, setStations] = useState<LoopStation[]>([]);
  const [loopRevision, setLoopRevision] = useState('');
  const [loopDirty, setLoopDirty] = useState(false);
  const [loopSaved, setLoopSaved] = useState('');

  const loadStatus = useCallback(async (resetLoop: boolean) => {
    const data = await api<KnowledgeStatus>('/api/admin/knowledge/status');
    setStatus(data);
    if (resetLoop) {
      setStations(data.loop ?? []);
      setLoopRevision(data.loopRevision);
      setLoopDirty(false);
    }
    if (data.loopError) setError(data.loopError);
  }, []);

  useEffect(() => {
    if (!boot.loading && (!boot.user || boot.error)) router.replace('/admin/login?reason=session');
  }, [boot.loading, boot.user, boot.error, router]);

  useEffect(() => {
    if (boot.loading || !boot.user || !['admin', 'super_admin'].includes(boot.user.role)) return;
    void loadStatus(true).catch((error: Error) => setError(error.message));
  }, [boot.loading, boot.user, loadStatus]);

  if (boot.loading) return <p className="p-8">正在验证登录状态…</p>;
  if (!boot.user) return <main className="p-8"><Link href="/admin/login">请先登录后台</Link></main>;
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
      await loadStatus(!loopDirty);
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

  const updateStation = (index: number, patch: Partial<LoopStation>) => {
    setStations((current) => current.map((station, i) => i === index ? { ...station, ...patch } : station));
    setLoopDirty(true); setLoopSaved('');
  };

  const saveLoop = async () => {
    const parsed = loopSchema.safeParse(stations);
    if (!parsed.success) { setError(parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).slice(0, 3).join('；')); return; }
    setBusy(true); setError(''); setLoopSaved('');
    try {
      await api('/api/admin/knowledge/loop', { method: 'PUT', body: JSON.stringify({ stations: parsed.data, revision: loopRevision }) });
      await loadStatus(true);
      setLoopSaved('闭环图已保存，前台重新打开闭环图即可查看。');
    } catch (error) { setError(error instanceof Error ? error.message : '闭环图保存失败'); }
    finally { setBusy(false); }
  };

  const addStation = () => {
    setStations((current) => [...current, {
      id: `station-${Date.now()}`, seq: current.length + 1, kind: 'station', cls: 'lp-s-engine',
      part: '', name: '新节点', sub: '', color: '#5B6CFF', drive: '', modules: [], points: [], upstream: '', downstream: '',
    }]);
    setLoopDirty(true); setLoopSaved('');
  };

  return <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
    <header className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-xl font-bold">知识库管理</h1><nav className="flex gap-4 text-sm"><a className="underline" href="/admin">管理后台</a><a className="underline" href="/manual">阅读与编辑手册</a></nav></header>
    {error && <div role="alert" className="rounded-lg bg-rose-50 p-4 text-rose-700">{error}</div>}
    <section className="space-y-4 rounded-xl border bg-white p-6">
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">当前知识数据</h2><button disabled={busy} onClick={() => void loadStatus(false).catch((error: Error) => setError(error.message))} className="text-sm text-indigo-700 underline disabled:opacity-50">刷新统计</button></div>
      {status ? <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-5">
        <div><dt>章节</dt><dd className="mt-1 text-xl font-semibold">{status.chapters}</dd></div>
        <div><dt>题库</dt><dd className="mt-1 text-xl font-semibold">{status.exams}</dd></div>
        <div><dt>题目</dt><dd className="mt-1 text-xl font-semibold">{status.questions}</dd></div>
        <div><dt>正文图片</dt><dd className="mt-1 text-xl font-semibold">{status.assets}</dd></div>
        <div><dt>闭环节点</dt><dd className="mt-1 text-xl font-semibold">{status.loopStations}</dd></div>
      </dl> : <p className="text-sm text-slate-500">正在读取站点数据…</p>}
      {status?.chapters === 0 && <p className="text-sm text-amber-800">当前站点尚未导入章节，请在下方选择原知识包，补齐手册、题库、图片和闭环图。</p>}
      <p className="text-xs text-slate-500">正文图片按已保存正文引用统计，选词挂接的图片和视频在管理后台的素材库中维护。</p>
    </section>
    <section className="space-y-4 rounded-xl border bg-white p-6">
      <h2 className="text-lg font-semibold">导入知识更新</h2>
      <p className="text-sm text-slate-600">上传知识包 JSON，导入章节、题库、正文图片和闭环图。知识包最大40MB，图片合计最大32MB。包外章节及人员考核记录会保留，已开始考试使用原试题。</p>
      <label className="block text-sm font-medium">选择知识包<input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => void selectFile(event.target.files?.[0])} className="mt-2 block w-full rounded border p-2" /></label>
      {busy && <p role="status" className="text-sm text-indigo-600">正在处理，请稍候…</p>}
      {preview && <div className="space-y-4 rounded-lg bg-slate-50 p-4">
        <p className="break-all font-medium">{fileName}</p>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><dt>章节</dt><dd>{preview.chapters} 个，新增 {preview.newChapters} 个，已有 {preview.existingChapters} 个</dd></div><div><dt>题库</dt><dd>{preview.exams} 套，{preview.questions} 道题</dd></div><div><dt>正文图片</dt><dd>{preview.assets} 张，{(preview.assetBytes / 1024 / 1024).toFixed(1)} MB</dd></div><div><dt>闭环图</dt><dd>{preview.loopStations} 个节点</dd></div></dl>
        <label className="block text-sm">导入方式<select disabled={busy} value={mode} onChange={(event) => setMode(event.target.value as 'add' | 'update')} className="ml-3 rounded border bg-white p-2"><option value="add">新增及补齐缺失正文，保留已有内容</option><option value="update">更新已有章节和同题干题目</option></select></label>
        <button disabled={busy} onClick={() => void apply()} className="rounded-lg bg-indigo-600 px-4 py-2 text-white disabled:opacity-50">确认导入</button>
      </div>}
      {result && <p role="status" className="rounded-lg bg-emerald-50 p-4 text-emerald-800">导入完成。新增章节 {result.addedChapters} 个，更新 {result.updatedChapters} 个，补齐正文 {result.filledChapterContents} 个，跳过 {result.skippedChapters} 个。新增题目 {result.addedQuestions} 道，更新 {result.updatedQuestions} 道。站点闭环图共 {result.loopStations} 个节点。</p>}
    </section>
    <section className="space-y-4 rounded-xl border bg-white p-6"><h2 className="text-lg font-semibold">新增章节</h2><form onSubmit={(event) => void createChapter(event)} className="flex flex-wrap items-end gap-3"><label className="text-sm">模块<select value={module} onChange={(event) => setModule(event.target.value)} className="mt-1 block rounded border p-2">{MODULES.map((m) => <option key={m.code} value={m.code}>{m.code} {m.label}</option>)}</select></label><label className="text-sm">章节编号<input required maxLength={16} value={sectionNo} onChange={(event) => setSectionNo(event.target.value)} placeholder="例如 1.17" className="mt-1 block w-28 rounded border p-2" /></label><label className="grow text-sm">标题<input required maxLength={255} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 block w-full rounded border p-2" /></label><button disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-white disabled:opacity-50">新增并打开</button></form><p className="text-sm text-slate-500">新增后在手册中点击“编辑”填写正文，也可查看和恢复章节历史版本。</p></section>
    <section className="space-y-4 rounded-xl border bg-white p-6" id="loop-editor">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">带货闭环图</h2><a className="text-sm text-indigo-700 underline" href="/loop">查看前台闭环图</a></div>
      {stations.length === 0 && <p className="text-sm text-slate-600">导入含闭环图的原知识包，或新增节点建立闭环图。</p>}
      {stations.map((station, index) => <details key={station.id} className="rounded-lg border p-4">
        <summary className="cursor-pointer font-medium">{station.name}</summary>
        <fieldset disabled={busy} className="mt-4 space-y-4 disabled:opacity-60">
          <div className="grid gap-3 sm:grid-cols-2">
            {([['name', '名称'], ['part', '部件名称'], ['sub', '副标题'], ['upstream', '上游'], ['downstream', '下游']] as const).map(([field, label]) => <label key={field} className="text-sm">{label}<input value={station[field]} onChange={(event) => updateStation(index, { [field]: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label>)}
          </div>
          <label className="block text-sm">作用说明<textarea value={station.drive} rows={3} onChange={(event) => updateStation(index, { drive: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label>
          <div className="space-y-2"><h3 className="text-sm font-medium">关联模块与章节</h3>
            {station.modules.map((module, moduleIndex) => <div key={moduleIndex} className="grid gap-2 rounded border p-3 sm:grid-cols-[100px_1fr_100px_auto]">
              <label className="text-xs">模块或章节编号<input value={module.code} onChange={(event) => updateStation(index, { modules: station.modules.map((item, i) => i === moduleIndex ? { ...item, code: event.target.value } : item) })} className="mt-1 block w-full rounded border p-2" /></label>
              <label className="text-xs">链接名称<input value={module.name} onChange={(event) => updateStation(index, { modules: station.modules.map((item, i) => i === moduleIndex ? { ...item, name: event.target.value } : item) })} className="mt-1 block w-full rounded border p-2" /></label>
              <label className="text-xs">颜色<input value={module.color} onChange={(event) => updateStation(index, { modules: station.modules.map((item, i) => i === moduleIndex ? { ...item, color: event.target.value } : item) })} className="mt-1 block w-full rounded border p-2" /></label>
              <button type="button" onClick={() => updateStation(index, { modules: station.modules.filter((_, i) => i !== moduleIndex) })} className="self-end p-2 text-sm text-rose-700">移除链接</button>
            </div>)}
            <button type="button" onClick={() => updateStation(index, { modules: [...station.modules, { code: 'M1', name: '模块名称', color: station.color }] })} className="text-sm text-indigo-700 underline">添加关联链接</button>
          </div>
          <div className="space-y-2"><h3 className="text-sm font-medium">操作要点</h3>
            {station.points.map((point, pointIndex) => <div key={pointIndex} className="space-y-2 rounded border p-3">
              <label className="block text-xs">要点内容<textarea rows={2} value={point.text} onChange={(event) => updateStation(index, { points: station.points.map((item, i) => i === pointIndex ? { ...item, text: event.target.value } : item) })} className="mt-1 block w-full rounded border p-2" /></label>
              <div className="flex items-end gap-3"><label className="text-xs">跳转章节（选填）<input value={point.to ?? ''} onChange={(event) => updateStation(index, { points: station.points.map((item, i) => i === pointIndex ? { ...item, to: event.target.value } : item) })} className="mt-1 block rounded border p-2" /></label><button type="button" onClick={() => updateStation(index, { points: station.points.filter((_, i) => i !== pointIndex) })} className="p-2 text-sm text-rose-700">移除要点</button></div>
            </div>)}
            <button type="button" onClick={() => updateStation(index, { points: [...station.points, { text: '新要点' }] })} className="text-sm text-indigo-700 underline">添加操作要点</button>
          </div>
          <details className="rounded border p-3"><summary className="cursor-pointer text-sm">显示设置</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">
            <p className="text-xs text-slate-500">节点标识 {station.id}</p>
            <label className="text-sm">类型<select value={station.kind} onChange={(event) => updateStation(index, { kind: event.target.value as LoopStation['kind'] })} className="ml-2 rounded border p-2"><option value="station">环形节点</option><option value="cross">横向节点</option></select></label>
            <label className="text-sm">序号<input type="number" min={1} max={10000} value={station.seq ?? ''} onChange={(event) => updateStation(index, { seq: event.target.value ? Number(event.target.value) : undefined })} className="mt-1 block w-full rounded border p-2" /></label>
            <label className="text-sm">颜色<input value={station.color} onChange={(event) => updateStation(index, { color: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label>
            <label className="text-sm">样式类名<input value={station.cls} onChange={(event) => updateStation(index, { cls: event.target.value })} className="mt-1 block w-full rounded border p-2" /></label>
          </div></details>
          <button type="button" onClick={() => { setStations((current) => current.filter((_, i) => i !== index)); setLoopDirty(true); setLoopSaved(''); }} className="text-sm text-rose-700 underline">移除此节点</button>
        </fieldset>
      </details>)}
      <div className="flex flex-wrap items-center gap-4">
        <button disabled={busy || !status || !!status.loopError || stations.length >= 20} onClick={addStation} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-50">新增节点</button>
        <button disabled={busy || !loopDirty || !loopRevision} onClick={() => void saveLoop()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white disabled:opacity-50">保存闭环图</button>
        <button disabled={busy || !status} onClick={() => { if (!loopDirty || window.confirm('重新载入会替换页面中尚未保存的闭环修改，继续？')) void loadStatus(true).catch((error: Error) => setError(error.message)); }} className="text-sm text-indigo-700 underline disabled:opacity-50">重新载入</button>
        {loopDirty && <span className="text-sm text-amber-700">闭环修改待保存</span>}
      </div>
      {loopSaved && <p role="status" className="text-sm text-emerald-700">{loopSaved}</p>}
    </section>
    <section className="space-y-3 rounded-xl border bg-white p-6"><h2 className="text-lg font-semibold">导出知识包</h2><p className="text-sm text-slate-600">下载当前章节、题库和正文内图片，供迁移或后续更新。选词挂接的视频附件通过服务器数据备份保存。</p><button disabled={busy} onClick={() => void download()} className="rounded-lg border px-4 py-2 disabled:opacity-50">下载知识包 JSON</button></section>
  </main>;
}
