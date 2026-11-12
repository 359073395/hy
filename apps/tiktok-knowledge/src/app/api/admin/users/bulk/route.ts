import { NextResponse } from 'next/server';
import { getCurrentUser, isAdmin, isSuperAdmin } from '@/lib/auth';
import { withTransaction } from '@/lib/server/db';
import { insertMember, memberInputSchema } from '@/lib/server/members';

/** Import legacy member tokens without replacing existing accounts. */
export async function POST(req: Request) {
  const op = await getCurrentUser();
  if (!op || !isAdmin(op)) return NextResponse.json({ error: '无权限' }, { status: 403 });

  const parsed = memberInputSchema.array().min(1).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: '请提供有效的成员资料数组' }, { status: 400 });
  const members = parsed.data;
  if (members.some((member) => member.role !== 'employee') && !isSuperAdmin(op)) {
    return NextResponse.json({ error: '仅超管可导入管理员' }, { status: 403 });
  }

  try {
    const result = await withTransaction(async (db) => {
      const users = [];
      for (const member of members) {
        const { user, token } = await insertMember(db, member);
        users.push(user
          ? { ...user, token, skipped: false }
          : { id: '', name: member.name || '未命名成员', role: member.role, tier: member.tier, status: 'skipped(已存在)', created_at: '', token, skipped: true });
      }
      const count = users.filter((user) => !user.skipped).length;
      const skipped = users.length - count;
      await db.query("INSERT INTO audit_logs(user_id,action,detail) VALUES($1,'members_imported',$2)", [op.id, JSON.stringify({ count, skipped })]);
      return { count, skipped, users };
    });
    return NextResponse.json(result, { status: 201 });
  } catch {
    return NextResponse.json({ error: '导入成员失败，请稍后重试' }, { status: 500 });
  }
}
