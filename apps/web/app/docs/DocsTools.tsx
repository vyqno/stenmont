"use client";

import { useEffect, useRef, useState } from "react";

export function DocsTools() {
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  async function copy() {
    try {
      const page = document.getElementById("docs-content");
      if (!page) throw new Error("Page unavailable");
      await navigator.clipboard.writeText(page.innerText);
      setNotice("Page copied.");
    } catch {
      setNotice("Copy unavailable. Select the page text, or open the plain-text reference.");
    }
  }
  const ask = (host: string) => `${host}${encodeURIComponent(`Read ${typeof location === "undefined" ? "" : location.origin}/llms-full.txt, then help me with Stenmont.`)}`;
  return <div className="docs-tools">
    <button type="button" onClick={copy}>Copy page</button>
    <div className="docs-open" ref={box}>
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>Open in…<span aria-hidden="true" className="docs-caret" /></button>
      {open && <div role="menu" className="docs-menu">
        <a role="menuitem" href="/llms-full.txt">Open the plain text<span aria-hidden="true">↗</span></a>
        <a role="menuitem" href={ask("https://chatgpt.com/?q=")} target="_blank" rel="noreferrer">Open in ChatGPT<span aria-hidden="true">↗</span></a>
        <a role="menuitem" href={ask("https://claude.ai/new?q=")} target="_blank" rel="noreferrer">Open in Claude<span aria-hidden="true">↗</span></a>
        <a role="menuitem" href="https://github.com/vyqno/stenmont" target="_blank" rel="noreferrer">Open in GitHub<span aria-hidden="true">↗</span></a>
      </div>}
    </div>
    <span role="status">{notice}</span>
  </div>;
}
