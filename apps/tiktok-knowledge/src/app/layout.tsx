import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'TikTok Shop 运营指南 · 内部培训手册',
    template: '%s · TikTok Shop 运营指南',
  },
  description:
    '公司内部培训手册在线平台：TikTok Shop 运营指南，包含开店、商品、营销、达人、内容、广告、数据分析与违规处理等模块。',
  authors: [{ name: '公司培训部' }],
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`antialiased`}>
        {children}
      </body>
    </html>
  );
}
