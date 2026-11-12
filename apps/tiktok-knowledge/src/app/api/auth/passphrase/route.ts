import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hashToken, getCurrentUser } from '@/lib/auth';
import { setCustomToken, getAllUserTokens } from '@/lib/server/bootstrap-utils';

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

  const client = getSupabaseClient();
  const h = hashToken(newPass);

  // 全站唯一：与任何人（含本人）的原始密令冲突即拒绝；与本人当前自定义相同视为幂等覆盖
  const { data: hashRows, error: dupErr } = await client
    .from('users')
    .select('id, token_hash, custom_token_hash');
  if (dupErr) return NextResponse.json({ error: '服务异常' }, { status: 500 });
  const dup = (hashRows ?? []).filter((u) => u.token_hash === h || u.custom_token_hash === h);
  for (const d of dup) {
    if (d.id !== me.id) return NextResponse.json({ error: '该密令已被他人占用，请更换' }, { status: 409 });
    // 本人命中：若命中的是本人原始密令（非自定义）则拒绝
    if (d.custom_token_hash !== h) return NextResponse.json({ error: '新密令不能与您的原始密令相同，请更换' }, { status: 409 });
  }
  // 走到这里说明命中的都是本人且是本人自定义密令本身 → 幂等，继续

  // 读取本人原始密令明文（用于 user_tokens 持久化；也额外确认数据完整）
  const tokens = await getAllUserTokens();
  const originalToken = tokens.get(me.id)?.token ?? '';
  if (!originalToken) return NextResponse.json({ error: '未找到您的原始密令记录，请联系管理员处理' }, { status: 500 });

  const res = await setCustomToken(me.id, newPass, h, originalToken);
  if (!res.ok) return NextResponse.json({ error: `保存失败：${res.error ?? '未知错误'}` }, { status: 500 });

  // 同步写入登录认证所读取的数据库（登录接口经由 supabase 校验自定义密令哈希）
  const sync = await client.from('users').update({ custom_token_hash: h }).eq('id', me.id);
  if (sync.error) return NextResponse.json({ error: `认证数据同步失败：${sync.error.message}` }, { status: 500 });

  // 审计日志：谁、何时、IP
  const ip = (req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? '').trim();
  await client.from('audit_logs').insert({
    user_id: me.id,
    action: 'passphrase_change',
    detail: { name: me.name, role: me.role, tier: me.tier, ip },
  });

  return NextResponse.json({ ok: true, message: '密令修改成功，原始密令仍可登录' });
}