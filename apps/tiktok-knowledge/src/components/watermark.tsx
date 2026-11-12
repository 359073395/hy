'use client';

import { useEffect, useRef } from 'react';

/**
 * 全屏半透明姓名水印：canvas 绘制「姓名 · 日期」，平铺满屏并旋转，
 * 悬浮于内容之上但不阻挡交互（pointer-events:none），用于防截图外泄。
 * 所有角色（含管理员）登录后均需显示。
 */
export default function Watermark({ name }: { name: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const dateStr = new Date().toLocaleDateString('zh-CN');
      const text = `${name} · ${dateStr}`;
      ctx.font = '16px "PingFang SC","Microsoft YaHei",sans-serif';
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      ctx.textAlign = 'center';

      const stepX = 220;
      const stepY = 150;
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate((-20 * Math.PI) / 180);
      for (let y = -h; y < h * 1.5; y += stepY) {
        for (let x = -w; x < w * 1.5; x += stepX) {
          ctx.fillText(text, x, y);
        }
      }
      ctx.restore();
    };

    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, [name]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[2000]"
      style={{ opacity: 1 }}
    />
  );
}