import { NextResponse } from 'next/server';
import { withTransaction } from '@/lib/server/db';
import { freezeLegacyExamRecords } from '@/lib/server/exams';
import { getCurrentUser, isAdmin } from '@/lib/auth';

type Qtype = 'truefalse' | 'choice' | 'multiple' | 'practical';

// 规范化多选答案：去重、升序、仅保留 0..3
function normMulti(answer: string): number[] {
  const set = new Set<number>();
  for (const part of String(answer).split(',')) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n >= 0 && n <= 3) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * 管理员编辑题目（题干/选项/答案/解析）。仅 super_admin/admin。
 * 按题型校验：判断 answer∈{true,false}；单选 answer 为单一下标；多选 answer 为 2~3 个下标；简述必须给参考答案(explanation)。
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const op = await getCurrentUser();
  if (!op || !isAdmin(op)) return NextResponse.json({ error: '无权限' }, { status: 403 });

  const { id } = await ctx.params;
  const body = (await req.json().catch(() => null)) as {
    qtype?: Qtype;
    question_text?: string;
    options?: string[] | null;
    answer?: string | null;
    explanation?: string | null;
  } | null;
  if (!body) return NextResponse.json({ error: '请求体无效' }, { status: 400 });

  const qtype = body.qtype as Qtype;
  if (!['truefalse', 'choice', 'multiple', 'practical'].includes(qtype)) {
    return NextResponse.json({ error: '题型无效' }, { status: 400 });
  }
  const questionText = String(body.question_text ?? '').trim();
  if (!questionText) return NextResponse.json({ error: '题干不能为空' }, { status: 400 });

  let options: string[] | null = null;
  let answer: string | null = null;

  if (qtype === 'truefalse') {
    if (body.answer !== 'true' && body.answer !== 'false') {
      return NextResponse.json({ error: '判断题答案必须是 true 或 false' }, { status: 400 });
    }
    answer = body.answer;
  } else if (qtype === 'choice' || qtype === 'multiple') {
    const opts = Array.isArray(body.options) ? body.options.map((o) => String(o ?? '').trim()) : [];
    if (opts.length !== 4 || opts.some((o) => !o)) {
      return NextResponse.json({ error: '选择题必须有 4 个非空选项' }, { status: 400 });
    }
    options = opts;
    if (qtype === 'choice') {
      const idx = Number(body.answer);
      if (!/^[0-3]$/.test(body.answer ?? '') || !Number.isInteger(idx) || idx < 0 || idx > 3) {
        return NextResponse.json({ error: '单选题答案必须是 0~3 的单个下标' }, { status: 400 });
      }
      answer = String(idx);
    } else {
      const idxs = normMulti(String(body.answer ?? ''));
      if (!/^[0-3](,[0-3]){1,3}$/.test(body.answer ?? '') || idxs.length < 2) {
        return NextResponse.json({ error: '多选题答案至少包含 2 个正确项（0~3，逗号分隔）' }, { status: 400 });
      }
      answer = idxs.join(',');
    }
  } else {
    // practical：无标准答案，但必须给参考答案
    const expl = String(body.explanation ?? '').trim();
    if (!expl) return NextResponse.json({ error: '简述题必须填写参考答案（解析）' }, { status: 400 });
  }

  try {
    const found = await withTransaction(async (db) => {
      await db.query('SELECT pg_advisory_xact_lock(7362841)');
      const existing = await db.query<{ exam_id: string }>('SELECT exam_id FROM questions WHERE id=$1 FOR UPDATE', [id]);
      if (!existing.rows[0]) return false;
      await freezeLegacyExamRecords(db, existing.rows[0].exam_id);
      await db.query('UPDATE questions SET qtype=$2,question_text=$3,options=$4,answer=$5,explanation=$6 WHERE id=$1', [id, qtype, questionText, options ? JSON.stringify(options) : null, answer, body.explanation?.trim() ?? null]);
      await db.query("INSERT INTO audit_logs(user_id,action,detail) VALUES($1,'question_edit',$2)", [op.id, JSON.stringify({ question_id: id })]);
      return true;
    });
    if (!found) return NextResponse.json({ error: '题目不存在' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[question-edit]', error);
    return NextResponse.json({ error: '保存题目失败，请重试' }, { status: 500 });
  }
}
