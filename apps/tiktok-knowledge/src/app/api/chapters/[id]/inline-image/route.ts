import { NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getCurrentUser, isAdmin } from '@/lib/auth';
import { uploadMaterial, deleteObject } from '@/lib/storage';

const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB
// 允许的真实图片 MIME（防止网页改后缀伪装）
const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
]);

// 仅 super_admin / admin：正文内嵌图片（术语表词条等任意位置编辑时插入 img 用）。
// 图片存入持久化目录，返回经过登录鉴权的稳定 URL，随正文保存。
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: '未登录' }, { status: 401 });
    if (!isAdmin(user)) return NextResponse.json({ error: '无权限，仅管理员可编辑' }, { status: 403 });

    const { id } = await ctx.params;
    const client = getSupabaseClient();
    const { data: chapter, error: chErr } = await client
      .from('chapters')
      .select('id, module, is_public')
      .eq('id', id)
      .single();
    if (chErr || !chapter) return NextResponse.json({ error: '章节不存在' }, { status: 404 });

    // —— 文件解析与校验：任何异常都转成友好 4xx，绝不抛 500 ——
    let form: FormData;
    try {
      form = await req.formData();
    } catch (e) {
      console.error('[inline-image] formData 解析失败:', e);
      return NextResponse.json({ error: '无法读取上传的文件，请重新选择图片（请使用插图按钮选择图片）' }, { status: 400 });
    }

    const file = form.get('file');
    if (!file || !(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: '未检测到图片文件，请重新选择一张图片' }, { status: 400 });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: `图片过大（${(file.size / 1024 / 1024).toFixed(1)}MB），单张图片不能超过 20MB` },
        { status: 400 },
      );
    }
    // 同时校验 MIME 与扩展名，拒绝伪装文件
    const mimeOk = ALLOWED_IMAGE_TYPES.has(file.type);
    const extOk = /\.(png|jpe?g|gif|webp)$/i.test(file.name);
    if (!mimeOk || !extOk) {
      return NextResponse.json(
        { error: '仅支持 PNG / JPG / JPEG / GIF / WebP 图片文件，请确认上传的是真实图片' },
        { status: 400 },
      );
    }

    let buf: Buffer;
    try {
      buf = Buffer.from(await file.arrayBuffer());
    } catch (e) {
      console.error('[inline-image] 读取文件内容失败:', e);
      return NextResponse.json({ error: '图片读取失败，请重试或换一张图片' }, { status: 400 });
    }

    // 真实文件头（魔数）校验：防止「改后缀/改 Content-Type」的假图绕过
    const sigOk = (() => {
      const b = buf;
      if (b.length < 4) return false;
      // PNG: 89 50 4E 47
      if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true;
      // JPEG: FF D8 FF
      if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
      // GIF: GIF8
      if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return true;
      // WebP: RIFF....WEBP
      if (
        b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b.length >= 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
      )
        return true;
      return false;
    })();
    if (!sigOk) {
      return NextResponse.json(
        { error: '文件内容不是有效的图片（可能是网页/文本改了后缀），请上传真实的 PNG/JPG/GIF/WebP 图片' },
        { status: 400 },
      );
    }

    let stored: { url?: string; key?: string } | undefined;
    try {
      stored = await uploadMaterial(buf, file.name, file.type === 'image/jpg' ? 'image/jpeg' : file.type);
    } catch (e) {
      console.error('[inline-image] 对象存储上传失败:', e);
      return NextResponse.json(
        { error: `图片上传到存储失败：${(e as Error).message || '未知错误'}，请稍后重试` },
        { status: 502 },
      );
    }
    if (!stored?.url) {
      if (stored?.key) {
        try {
          await deleteObject(stored.key);
        } catch {
          /* 清理失败忽略 */
        }
      }
      console.error('[inline-image] 存储返回异常（无 url）:', stored);
      return NextResponse.json({ error: '图片存储返回异常，请稍后重试' }, { status: 502 });
    }
    return NextResponse.json({ url: stored.url, key: stored.key }, { status: 201 });
  } catch (e) {
    // 兜底：任何未预期错误都返回中文提示 + 记录堆栈，不裸抛 500
    console.error('[inline-image] 未预期错误:', e);
    return NextResponse.json({ error: `插图上传失败：${(e as Error).message || '服务器内部错误'}` }, { status: 500 });
  }
}
