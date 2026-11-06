"use client";

import { useState } from "react";

export function DocsTools() {
  const [notice, setNotice] = useState("");
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
  return <div className="docs-tools"><button type="button" onClick={copy}>Copy page <span aria-hidden="true">⧉</span></button><a href="/llms-full.txt">Open in agent <span aria-hidden="true">↗</span></a><span role="status">{notice}</span></div>;
}
