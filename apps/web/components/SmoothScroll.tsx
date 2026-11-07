"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

/** Lenis smooth scrolling for the whole site, as on ospyr.com. Off for reduced motion; dialogs and anything marked
 *  data-lenis-prevent keep native scrolling; same-page anchors glide; new routes start at the top. */
let lenis: Lenis | null = null;

export default function SmoothScroll() {
  const pathname = usePathname();
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    lenis = new Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      anchors: { offset: -72 },
      prevent: (node) => !!node.closest?.("[data-lenis-prevent], [role='dialog'], textarea, pre"),
    });
    let frame = 0;
    const raf = (time: number) => { lenis?.raf(time); frame = requestAnimationFrame(raf); };
    frame = requestAnimationFrame(raf);
    return () => { cancelAnimationFrame(frame); lenis?.destroy(); lenis = null; };
  }, []);
  useEffect(() => { if (!window.location.hash) lenis?.scrollTo(0, { immediate: true }); }, [pathname]);
  return null;
}
