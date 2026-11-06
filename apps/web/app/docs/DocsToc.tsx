"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

type Item = { id: string; text: string; level: 2 | 3 };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";

/** "On this page": built from the page's own h2 and h3 headings, with the heading in view highlighted. */
export function DocsToc() {
  const path = usePathname();
  const [items, setItems] = useState<Item[]>([]);
  const [active, setActive] = useState("");
  useEffect(() => {
    const heads = Array.from(document.querySelectorAll<HTMLElement>("#docs-content h2, #docs-content h3"));
    const used = new Set<string>();
    const list = heads.map((h) => {
      let id = h.id || slug(h.textContent ?? "");
      while (used.has(id)) id += "-2";
      used.add(id); h.id = id; h.style.scrollMarginTop = "110px";
      return { id, text: h.textContent ?? "", level: h.tagName === "H2" ? 2 : 3 } as Item;
    });
    setItems(list); setActive(list[0]?.id ?? "");
    const io = new IntersectionObserver((entries) => {
      const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (seen) setActive(seen.target.id);
    }, { rootMargin: "-100px 0px -65% 0px" });
    heads.forEach((h) => io.observe(h));
    return () => io.disconnect();
  }, [path]);
  if (items.length < 2) return null;
  return <nav aria-label="On this page" className="docs-toc"><p>On this page</p><ul>{items.map((i) => <li key={i.id} data-level={i.level}><a href={`#${i.id}`} aria-current={active === i.id ? "location" : undefined}>{i.text}</a></li>)}</ul></nav>;
}
