"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Code blocks like a docs site should have them: a Copy button on every block, and long blocks folded behind "Show all".
 *  Buttons are added inside each <pre> so React can still remove the block cleanly on navigation. */
const FOLD_AFTER = 16;

export function DocsCode() {
  const path = usePathname();
  useEffect(() => {
    const blocks = Array.from(document.querySelectorAll<HTMLPreElement>("#docs-content pre"));
    const cleanups: Array<() => void> = [];
    for (const pre of blocks) {
      if (pre.dataset.enhanced) continue;
      pre.dataset.enhanced = "1"; pre.classList.add("codeblock");
      const copy = document.createElement("button");
      copy.type = "button"; copy.className = "code-copy"; copy.textContent = "Copy"; copy.setAttribute("aria-label", "Copy this code");
      const onCopy = async () => { try { await navigator.clipboard.writeText(pre.querySelector("code")?.textContent ?? ""); copy.textContent = "Copied"; setTimeout(() => (copy.textContent = "Copy"), 1600); } catch { copy.textContent = "Select and copy"; } };
      copy.addEventListener("click", onCopy); pre.appendChild(copy);
      cleanups.push(() => { copy.removeEventListener("click", onCopy); copy.remove(); });
      const lines = (pre.querySelector("code")?.textContent ?? "").split("\n").length;
      if (lines > FOLD_AFTER) {
        pre.classList.add("is-folded");
        const more = document.createElement("button");
        more.type = "button"; more.className = "code-more"; more.textContent = "Show all code";
        const toggle = () => { const folded = pre.classList.toggle("is-folded"); more.textContent = folded ? "Show all code" : "Show less"; };
        more.addEventListener("click", toggle); pre.appendChild(more);
        cleanups.push(() => { more.removeEventListener("click", toggle); more.remove(); });
      }
    }
    return () => { cleanups.forEach((c) => c()); blocks.forEach((p) => { delete p.dataset.enhanced; p.classList.remove("codeblock", "is-folded"); }); };
  }, [path]);
  return null;
}
