import { NextRequest, NextResponse } from 'next/server';

/** Cookie-authenticated writes are accepted only from this website. */
export function proxy(request: NextRequest) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return NextResponse.next();
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: '跨站请求已拒绝' }, { status: 403 });
  }
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      const host = request.headers.get('host') || request.nextUrl.host;
      const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
      const protocol = forwardedProtocol === 'https' ? 'https:' : request.nextUrl.protocol;
      const expected = new URL(process.env.SITE_URL || `${protocol}//${host}`).origin;
      if (new URL(origin).origin !== expected) return NextResponse.json({ error: '请求来源无效' }, { status: 403 });
    } catch {
      return NextResponse.json({ error: '请求来源无效' }, { status: 403 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
