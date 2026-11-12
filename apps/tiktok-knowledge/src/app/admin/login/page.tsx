'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BrandLogo } from '@/components/brand-logo';
import { loginWithPassword, me } from '@/lib/client';

export default function AdminLoginPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void me().then(({ user }) => {
      if (cancelled) return;
      if (user?.role === 'admin' || user?.role === 'super_admin') {
        router.replace('/admin');
        return;
      }
      setChecking(false);
    }).catch(() => {
      if (!cancelled) setChecking(false);
    });
    return () => { cancelled = true; };
  }, [router]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await loginWithPassword(username.trim(), password);
      // A password session must not resume a previously cached employee token.
      try { window.sessionStorage.removeItem('manual-last-token'); } catch { /* Storage may be unavailable. */ }
      setPassword('');
      // Reload so the protected page reads the newly issued HttpOnly session.
      window.location.assign('/admin');
    } catch (error) {
      setError(error instanceof Error ? error.message : '登录失败，请重试');
      setSubmitting(false);
    }
  };

  if (checking) return <main className="flex min-h-screen items-center justify-center bg-[#F7F8FF] text-sm text-slate-500">正在验证登录状态…</main>;

  return <main className="flex min-h-screen items-center justify-center bg-[#F7F8FF] px-4 py-10">
    <div className="w-full max-w-md">
      <section className="rounded-[22px] border border-indigo-100 bg-white p-8 shadow-lg shadow-indigo-100/50">
        <div className="mb-4 flex justify-center"><BrandLogo className="h-20 w-auto" /></div>
        <h1 className="text-center text-xl font-bold text-slate-900">后台登录</h1>
        <p className="mt-2 text-center text-sm text-slate-500">使用安装时设置的管理员账号登录</p>
        <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-slate-700" htmlFor="admin-username">用户名</label>
          <input
            id="admin-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
            value={username} onChange={(event) => setUsername(event.target.value)} required maxLength={64}
            disabled={submitting} autoFocus
            className="block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 disabled:bg-slate-50"
          />
          <label className="block text-sm font-medium text-slate-700" htmlFor="admin-password">密码</label>
          <input
            id="admin-password" name="password" type="password" autoComplete="current-password"
            value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={128}
            disabled={submitting}
            className="block w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 disabled:bg-slate-50"
          />
          {error && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <button
            type="submit" disabled={submitting || !username.trim() || !password}
            className="w-full rounded-xl bg-[#5B6CFF] py-2.5 text-sm font-semibold text-white hover:bg-indigo-600 disabled:opacity-50"
          >{submitting ? '登录中…' : '登录后台'}</button>
        </form>
        <div className="mt-5 text-center text-sm"><Link href="/" className="text-indigo-700 underline">员工令牌登录</Link></div>
      </section>
      <p className="mt-4 text-sm leading-6 text-slate-500">忘记用户名或密码时，在服务器的一键脚本中进入「11 应用系统 → 123 TikTok 知识系统 → 4 设置/重置超级管理员账号」。</p>
    </div>
  </main>;
}
