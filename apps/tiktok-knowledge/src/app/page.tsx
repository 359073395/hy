'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { login } from '@/lib/client';
import { useAuthBootstrap } from '@/lib/use-auth-bootstrap';
import { BrandLogo } from '@/components/brand-logo';

export default function LoginPage() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 认证引导：已有会话直接进手册；hash 带令牌则免输直进，成功后清 hash
  const boot = useAuthBootstrap();

  useEffect(() => {
    if (boot.loading) return;
    if (boot.user) {
      router.replace('/manual');
      return;
    }
    if (boot.error) {
      setError(boot.error);
      return;
    }
    // 被手册页因会话失效踢回：展示明确原因，而不是静默回到登录页
    const params = new URLSearchParams(window.location.search);
    if (params.get('reason') === 'session') {
      setError('登录状态已失效或令牌无效，请重新输入令牌登录');
    }
  }, [boot.loading, boot.user, boot.error, router]);

  const doLogin = async (t: string) => {
    await login(t);
    // 硬跳转整页加载：直接带上刚 Set-Cookie 的会话，避免 SPA 软导航后
    // manual 页独立 useAuthBootstrap 重新 me() 时序未拿到 user 而被静默踢回。
    window.location.assign('/manual');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await doLogin(token.trim());
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  if (boot.loading || boot.user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        正在验证登录状态…
      </div>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10" style={{ background: '#F7F8FF' }}>
      <div className="w-full max-w-md">
        <div
          className="rounded-[22px] border p-8"
          style={{ borderColor: 'rgba(91,108,255,0.14)', background: '#fff', boxShadow: '0 18px 50px rgba(91,108,255,0.10)' }}
        >
          <div className="mb-3 flex justify-center">
            <BrandLogo className="h-24 w-auto" />
          </div>
          <div className="mb-1 text-center text-xs font-bold tracking-wide" style={{ color: '#5B6CFF' }}>
            公司内部资料 · 请勿外泄
          </div>
          <h1 className="text-center text-xl font-extrabold text-slate-900">印尼 TikTok Shop 运营指南</h1>
          <p className="mt-1 text-center text-sm font-semibold" style={{ color: '#8a90a8' }}>请输入你的访问令牌以进入手册</p>

          <form onSubmit={submit} className="mt-6 space-y-3">
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="输入访问令牌"
              autoFocus
              className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
            {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">{error}</div>}
            <button
              type="submit"
              disabled={submitting || !token.trim()}
              className="w-full rounded-xl py-2.5 text-sm font-bold text-white transition disabled:opacity-50"
              style={{ background: '#5B6CFF', boxShadow: '0 8px 22px rgba(91,108,255,0.35)' }}
            >
              {submitting ? '登录中…' : '进入手册'}
            </button>
          </form>
        </div>

        <p className="mt-3 text-center text-[11px] font-semibold text-slate-400">
          拿到培训令牌？直接用 <code className="text-slate-500">https://站点/#令牌</code> 免输直进
        </p>
      </div>
    </main>
  );
}