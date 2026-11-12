'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthBootstrap } from '@/lib/use-auth-bootstrap';

const exports = [
  { scope: 'members', title: '人员', detail: '姓名、角色、访问等级、状态及原始和自定义令牌', csv: true },
  { scope: 'exams', title: '考核记录', detail: '考试、人员、作答、成绩、审核结果和试题快照', csv: true },
  { scope: 'questions', title: '题库', detail: '全部考试定义、题目、正确答案及解析' },
  { scope: 'knowledge', title: '知识内容与历史', detail: '章节、正文、历史版本及运营闭环内容' },
  { scope: 'materials', title: '素材清单', detail: '图片视频的文件路径、挂接位置、上传人员及状态' },
  { scope: 'audit', title: '操作日志', detail: '系统记录的操作人员、时间和详情' },
  { scope: 'database', title: '全部数据库数据', detail: '所有数据表，包括人员、令牌、会话、考核、知识、素材记录和系统版本' },
];

export default function DataAdminPage() {
  const boot = useAuthBootstrap();
  const router = useRouter();
  useEffect(() => {
    if (!boot.loading && (!boot.user || boot.error)) router.replace('/admin/login?reason=session');
  }, [boot.loading, boot.user, boot.error, router]);
  if (boot.loading) return <p className="p-8">正在验证登录状态…</p>;
  if (!boot.user) return <main className="p-8"><Link href="/admin/login">请先登录后台</Link></main>;
  if (boot.user.role !== 'super_admin') {
    return <main className="mx-auto max-w-3xl space-y-4 p-8">
      <h1 className="text-xl font-bold">数据与备份</h1>
      <p>完整数据包含全员登录令牌及考核答卷，请使用超级管理员账户导出和备份。</p>
      <Link href="/admin" className="text-indigo-700 underline">返回管理后台</Link>
    </main>;
  }

  return <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-xl font-bold">数据与备份</h1>
      <nav className="flex gap-4 text-sm"><Link href="/admin" className="underline">管理后台</Link><Link href="/admin/knowledge" className="underline">知识库管理</Link></nav>
    </header>
    <section className="space-y-4 rounded-xl border bg-white p-6">
      <h2 className="text-lg font-semibold">完整备份</h2>
      <p className="text-sm leading-6 text-slate-600">下载数据库、全部图片视频及正文资源的 TAR.GZ 备份包。系统生成备份时会短暂等待正在进行的写入，完成后开始下载，较大的附件需要更多时间。</p>
      <a href="/api/admin/backup" className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-white">下载完整备份</a>
      <p className="text-sm text-slate-600">备份包含登录凭据和业务数据，请保存在自己的安全位置。</p>
    </section>
    <section className="overflow-hidden rounded-xl border bg-white">
      <h2 className="px-6 pt-6 text-lg font-semibold">按数据类型导出</h2>
      <p className="px-6 py-3 text-sm text-slate-600">JSON 保留完整字段。人员和考核记录还可以下载 CSV，用表格软件查看。素材文件可随完整备份保存。</p>
      <ul className="divide-y">
        {exports.map((item) => <li key={item.scope} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div><h3 className="font-medium">{item.title}</h3><p className="mt-1 text-sm text-slate-500">{item.detail}</p></div>
          <div className="flex gap-3 text-sm">
            <a href={`/api/admin/data?scope=${item.scope}&format=json`} className="rounded-md border px-3 py-2" aria-label={`导出${item.title} JSON`}>JSON</a>
            {item.csv && <a href={`/api/admin/data?scope=${item.scope}&format=csv`} className="rounded-md border px-3 py-2" aria-label={`导出${item.title} CSV`}>CSV</a>}
          </div>
        </li>)}
      </ul>
    </section>
    <section className="space-y-3 rounded-xl border bg-white p-6">
      <h2 className="text-lg font-semibold">可再次导入的知识包</h2>
      <p className="text-sm leading-6 text-slate-600">下载章节、题库及正文图片，之后可以在知识库管理页面预览和导入。选词挂接的图片视频通过完整备份迁移。</p>
      <a href="/api/admin/knowledge" className="inline-block rounded-lg border px-4 py-2">下载知识包 JSON</a>
    </section>
    <section className="space-y-3 rounded-xl border bg-white p-6">
      <h2 className="text-lg font-semibold">恢复完整备份</h2>
      <p className="text-sm leading-6 text-slate-600">把备份包上传到已安装本系统的 VPS，在服务器终端执行下面的命令，将路径替换为实际备份文件。恢复会覆盖应用数据，执行前自动保留一份恢复前备份，目标服务器的域名、端口及数据库连接配置继续生效。</p>
      <pre className="overflow-x-auto rounded-lg bg-slate-100 p-4 text-xs"><code>bash /opt/tiktok-knowledge/install.sh --restore /path/to/backup.tar.gz</code></pre>
    </section>
  </main>;
}
