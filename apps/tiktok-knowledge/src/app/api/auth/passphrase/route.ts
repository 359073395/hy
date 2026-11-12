import { NextRequest, NextResponse } from 'next/server';
import { hashToken, getCurrentUser } from '@/lib/auth';
import { setCustomToken } from '@/lib/server/bootstrap-utils';

/** 常见弱口令黑名单 */
const COMMON_WEAK = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890',
  'password', 'qwerty', 'qwerty123', 'abc123', 'abc1234', 'abcdef',
  'abcabc', '111111', '000000', '888888', '123123', '123321',
  'a123456', 'a12345', 'iloveyou', 'admin123', 'passw0rd', '654321',
]);

/** 新密令校验规则：6-20 位、字母+数字组合、拒绝弱口令/纯数字/纯字母/与姓名接近 */
export function validateNewPassphrase(p: string, name: string): string | null {
  if (!p || p.length < 6 || p.length > 20) return '密令长度需为 6-20 位';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return '密令需同时包含字母和数字';
  // 经英文字母转小写后再判断，兼容大小写变体
  const low = p.toLowerCase();
  if (/^\d+$/.test(p) || /^[a-z]+$/i.test(p)) return '密令不能为纯数字或纯字母';
  if (COMMON_WEAK.has(low)) return '密令过于简单，请更换后再试';
  const uname = (name ?? '').trim().toLowerCase();
  if (uname && (low === uname || low.includes(uname))) return '密令不能过于接近姓名，请更换';
  return null;
}

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
