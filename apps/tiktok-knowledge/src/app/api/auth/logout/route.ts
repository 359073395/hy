import { NextRequest, NextResponse } from 'next/server';
import { destroySession, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  await destroySession(raw);
  const res = NextResponse.json({ ok: true });
  // 清 cookie 的属性必须与写入时一致（生产为 None+Secure），否则浏览器不会删除
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 });
  return res;
}