"use client";

import { useEffect, useRef } from "react";

const BAYER = [[0,32,8,40,2,34,10,42],[48,16,56,24,50,18,58,26],[12,44,4,36,14,46,6,38],[60,28,52,20,62,30,54,22],[3,35,11,43,1,33,9,41],[51,19,59,27,49,17,57,25],[15,47,7,39,13,45,5,37],[63,31,55,23,61,29,53,21]];

/** A dithered sphere. Its light follows the pointer, so the shading and the dot pattern shift as you move.
 *  With no pointer it drifts slowly by itself. Static when reduced motion is requested. Decorative only. */
export function HeroOrb() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const C = 7;
    let w = 0, h = 0, raf = 0, lastMove = -1e9;
    const m = { x: -0.45, y: -0.5, tx: -0.45, ty: -0.5 };
    const size = () => { const r = cv.getBoundingClientRect(); const dpr = Math.min(2, window.devicePixelRatio || 1); w = r.width; h = r.height; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    const move = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); m.tx = Math.max(-1.4, Math.min(1.4, ((e.clientX - r.left) / r.width - 0.5) * 2.4)); m.ty = Math.max(-1.4, Math.min(1.4, ((e.clientY - r.top) / r.height - 0.5) * 2.4)); lastMove = performance.now(); };
    const draw = (now: number) => {
      const t = now / 1000;
      if (!reduce && now - lastMove > 2500) { m.tx = Math.cos(t * 0.35) * 0.9; m.ty = Math.sin(t * 0.27) * 0.7 - 0.15; }
      m.x += (m.tx - m.x) * 0.07; m.y += (m.ty - m.y) * 0.07;
      ctx.clearRect(0, 0, w, h); ctx.fillStyle = "#548CFF";
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * (0.46 + (reduce ? 0 : Math.sin(t * 0.8) * 0.006));
      let lx = m.x, ly = m.y, lz = 0.62; const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll;
      const cols = Math.ceil(w / C), rows = Math.ceil(h / C);
      for (let gy = 0; gy < rows; gy++) for (let gx = 0; gx < cols; gx++) {
        const nx = ((gx + 0.5) * C - cx) / R, ny = ((gy + 0.5) * C - cy) / R, d2 = nx * nx + ny * ny;
        if (d2 > 1) continue;
        const nz = Math.sqrt(1 - d2);
        const lit = Math.max(0, nx * lx + ny * ly + nz * lz);
        const rim = Math.pow(1 - nz, 2.2) * 0.35;
        const v = Math.min(1, lit * 0.95 + rim * 0.5 + 0.04);
        if (v > (BAYER[gy & 7]![gx & 7]! + 0.5) / 64) ctx.fillRect(gx * C, gy * C, C - 1.5, C - 1.5);
      }
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    size(); draw(performance.now());
    if (!reduce) { window.addEventListener("pointermove", move, { passive: true }); raf = requestAnimationFrame(draw); }
    const ro = new ResizeObserver(() => { size(); if (reduce) draw(performance.now()); }); ro.observe(cv);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointermove", move); ro.disconnect(); };
  }, []);
  return <canvas ref={ref} className="v2-orb" aria-hidden="true" />;
}
