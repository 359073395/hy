/**
 * 品牌 LOGO（TikTok 官方音符 App 图标风格，方形圆角）。
 * - BrandMark：页头/侧栏用黑底白音符小图标。
 * - BrandLogo：登录页主 LOGO，黑底白音符 + 文字「TikTok Shop 运营指南」。
 */
export function BrandMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <img
      src="/tiktok-note-black.png"
      alt="TikTok Shop"
      draggable={false}
      className={`object-contain rounded-lg ${className}`}
    />
  );
}

export function BrandLogo({ className = 'h-20' }: { className?: string }) {
  return (
    <div className="flex items-center gap-3">
      <img
        src="/tiktok-note-black.png"
        alt="TikTok Shop"
        draggable={false}
        className={`object-contain rounded-2xl shadow-sm ${className} w-auto`}
      />
    </div>
  );
}
