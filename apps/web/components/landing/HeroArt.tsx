"use client";

import { useEffect, useRef } from "react";

/** The hero picture: a dithered shop in cornflower dots on the page's own white. It sweeps in on load and drifts a few
 *  pixels toward the pointer. Static for reduced motion. Decorative. */
export function HeroArt() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    const move = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const x = (e.clientX / window.innerWidth - 0.5) * 2, y = (e.clientY / window.innerHeight - 0.5) * 2;
        el.style.setProperty("--mx", `${(x * -14).toFixed(1)}px`); el.style.setProperty("--my", `${(y * -9).toFixed(1)}px`);
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => { cancelAnimationFrame(raf); window.removeEventListener("pointermove", move); };
  }, []);
  return <div ref={ref} className="hero-art" aria-hidden="true"><img src="/art/dither-store.png" alt="" width="1600" height="1200" /></div>;
}
