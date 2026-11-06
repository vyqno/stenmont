"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Quiet scroll motion, after the ospyr site: headings rise word by word, content blocks lift in as they enter.
 *  Only static, server-rendered headings marked `.v2-h` are split. Respects prefers-reduced-motion. Renders nothing. */
const SPLIT = ".v2-h";
const BLOCKS = ".v2-rv";
const GROUPS = ".v2-group";

function splitWords(el: HTMLElement) {
  let i = 0;
  const walk = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent ?? "";
        if (!text.trim()) continue;
        const frag = document.createDocumentFragment();
        for (const part of text.split(/(\s+)/)) {
          if (!part) continue;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(" ")); continue; }
          const w = document.createElement("span"); w.className = "w";
          const wi = document.createElement("span"); wi.className = "wi";
          wi.style.setProperty("--i", String(i++)); wi.textContent = part;
          w.appendChild(wi); frag.appendChild(w);
        }
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE && !(child as Element).classList.contains("w")) {
        walk(child);
      }
    }
  };
  walk(el);
  el.dataset.split = "1";
}

export default function Motion() {
  const pathname = usePathname();
  useEffect(() => {
    const root = document.documentElement;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { root.classList.remove("m"); return; }
    root.classList.add("m");
    document.querySelectorAll<HTMLElement>(GROUPS).forEach((g) => {
      Array.from(g.children).forEach((c, idx) => (c as HTMLElement).style.setProperty("--d", `${Math.min(idx, 6) * 90}ms`));
    });
    const targets: HTMLElement[] = [];
    document.querySelectorAll<HTMLElement>(SPLIT).forEach((el) => { if (!el.dataset.split) splitWords(el); targets.push(el); });
    document.querySelectorAll<HTMLElement>(BLOCKS).forEach((el) => targets.push(el));
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    targets.forEach((t) => (t.classList.contains("in") ? null : io.observe(t)));
    return () => io.disconnect();
  }, [pathname]);
  return null;
}
