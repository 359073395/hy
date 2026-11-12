import { NextRequest, NextResponse } from 'next/server';
import { hashToken, getCurrentUser } from '@/lib/auth';
import { setCustomToken } from '@/lib/server/bootstrap-utils';
import { validateNewPassphrase } from '@/lib/passphrase';

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: '未登录或会话已过期' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const newPass: string = typeof body?.newPass === 'string' ? body.newPass.trim() : '';
  const confirm: string = typeof body?.confirm === 'string' ? body.confirm : '';
  if (!newPass) return NextResponse.json({ error: '请输入新密令' }, { status: 400 });
  if (newPass !== confirm) return NextResponse.json({ error: '两次输入的密令不一致' }, { status: 400 });

  const rule = validateNewPassphrase(newPass, me.name ?? '');
  if (rule) return NextResponse.json({ error: rule }, { status: 400 });

  const ip = (req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? '').trim();
  const res = await setCustomToken(me.id, newPass, hashToken(newPass), ip);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  return NextResponse.json({ ok: true, message: '密令修改成功，原始密令仍可登录' });
}
