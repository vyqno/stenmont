"use client";

import { useEffect, useRef, useState } from "react";
import { LOGOS } from "./logos";

/** How Stenmont works, as five ideas that play on their own. The left column lists them and explains the current one;
 *  the right shows one dithered picture with the real moments typed in underneath. Everything has a fixed size, so nothing
 *  jumps when the step changes. A click takes over. */
const STEPS = [
  {
    title: "Bring your store", art: "store", alt: "A dithered shop front with a lit window",
    body: "Connect Shopify, WooCommerce or Webflow, or call the API from your own code. Your catalogue comes in, every order gets a Stenmont invoice, and the books export to CSV or QuickBooks.",
    typed: ["Store", "eth-stenmont-demo.myshopify.com"], ticks: ["Catalogue imported", "Signed webhook answered 200", "Books export: CSV and QuickBooks"],
  },
  {
    title: "Customers pay with one tap", art: "phone", alt: "A thumb on a phone screen",
    body: "The customer taps Pay and confirms with Face ID, a fingerprint or a PIN. No wallet, no seed phrase and no gas: the merchant's gas tank covers the network fee, and the payment lands in seconds.",
    typed: ["Confirm", "Passkey, Face ID or PIN"], ticks: ["Network fee paid by the merchant", "Customer's native token used: 0", "Invoice marked Paid, receipt sent"],
  },
  {
    title: "One person, one business", art: "person", alt: "An illustrated person with a verified badge",
    body: "World ID proves one real person runs each business. When a refund or an agent's limit is large, a person must approve it with World first, and a fresh sign-in is checked on our server.",
    typed: ["Refund", "250.00 USDT, over the 2.00 limit"], ticks: ["A person approves with World ID", "Fresh sign-in checked on our server", "Refund sent with the merchant's passkey"],
  },
  {
    title: "A name that carries the rules", art: "name", alt: "A closed brass padlock and key",
    body: "Each business gets an ENS name such as acme.stenmont.eth. It points to the payout address, hands out roles one record at a time, and can lock the payout so that even we cannot change it.",
    typed: ["Name", "acme.stenmont.eth"], ticks: ["Resolves to the payout address", "Finance can edit the profile only", "Payout locked for good"],
  },
  {
    title: "Get paid before the customer does", art: "invoice", alt: "A printed invoice with an approval stamp",
    body: "Sell an unpaid invoice as a claim token. Only allowlisted investors can hold it. When the customer pays, the same payment repays the investor and the claim freezes.",
    typed: ["Invoice", "INV-1042 · 4,800.00 USDT · 60 days"], ticks: ["Listed as claim token #1042", "Funded by an allowlisted investor", "Paid by the customer, investor repaid"],
  },
] as const;

const N = STEPS.length;
const HOLD = 9000;
const MARKS = [["Shopify", LOGOS.shopify], ["WooCommerce", LOGOS.woocommerce], ["Webflow", LOGOS.webflow]] as const;

export function PinnedStory() {
  const root = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(true);
  const [visible, setVisible] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [within, setWithin] = useState(0);
  const track = useRef<HTMLDivElement>(null);

  // Wide screens: the section pins and the scroll position picks the step. Narrow screens and reduced motion: it plays by itself.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 901px) and (prefers-reduced-motion: no-preference)");
    const sync = () => setPinned(mq.matches);
    sync(); mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!pinned) return;
    let raf = 0;
    const update = () => {
      const el = track.current; if (!el) return;
      const total = Math.max(1, el.offsetHeight - window.innerHeight);
      const p = Math.min(0.9999, Math.max(0, -el.getBoundingClientRect().top / total));
      setActive(Math.min(N - 1, Math.floor(p * N))); setWithin(p * N - Math.floor(p * N)); setAuto(false);
    };
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); };
    update(); window.addEventListener("scroll", on, { passive: true }); window.addEventListener("resize", on);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("scroll", on); window.removeEventListener("resize", on); };
  }, [pinned]);
  function pick(i: number) {
    if (pinned && track.current) {
      const top = track.current.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: top + ((i + 0.5) / N) * (track.current.offsetHeight - window.innerHeight), behavior: "smooth" });
    } else { setAuto(false); setActive(i); }
  }

  useEffect(() => {
    const el = root.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (pinned || !auto || !visible || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setTimeout(() => setActive((a) => (a + 1) % N), HOLD);
    return () => clearTimeout(id);
  }, [active, auto, visible, pinned]);

  const step = STEPS[active]!;

  return (
    <section id="how-it-works" ref={root} className="story" aria-label="How Stenmont works">
      <div ref={track} className="story-track" style={pinned ? { height: `${N * 85 + 25}vh` } : undefined}>
      <div className={pinned ? "story-sticky" : "story-flow"}>
      <div className="v2-wrap story-grid">
        <div className="story-left">
          <p className="v2-eyebrow">How it works</p>
          <h2 className="v2-h v2-title story-title">From a store <span className="v2-blue">to a funded invoice.</span></h2>
          <ol className="story-list">
            {STEPS.map((s, i) => (
              <li key={s.title} className={i === active ? "on" : ""}>
                <button type="button" onClick={() => pick(i)} aria-current={i === active ? "step" : undefined}>
                  <span className="n">0{i + 1}</span><span className="t">{s.title}</span>
                </button>
              </li>
            ))}
          </ol>
          <div className="story-explain" aria-live="polite">
            <p key={active}>{step.body}</p>
            <span className="story-clock" aria-hidden="true"><i key={pinned ? "p" : `${active}-${auto}`} style={pinned ? { animation: "none", transform: `scaleX(${within})`, transition: "transform .15s linear" } : auto && visible ? { animationDuration: `${HOLD}ms` } : { animation: "none", transform: "scaleX(0)" }} /></span>
          </div>
        </div>
        <div className="story-stage" aria-live="off">
          <div key={active} className="stage-in">
            <div className="stage-pic"><img src={`/art/dither-${step.art}.png`} alt={step.alt} /></div>
            <div className="stage-facts">
              <div className="vz-row" style={{ ["--d" as string]: "0.3s", ["--ch" as string]: step.typed[1].length }}><span className="k">{step.typed[0]}</span><span className="v">{step.typed[1]}</span></div>
              {step.ticks.map((t, i) => <div key={t} className="vz-ck" style={{ ["--d" as string]: `${1.6 + i * 0.8}s` }}><b aria-hidden="true">&#10003;</b><span>{t}</span></div>)}
            </div>
            {active === 0 && (
              <ul className="story-marks" aria-label="Works with">
                {MARKS.map(([name, d]) => <li key={name}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg><span>{name}</span></li>)}
              </ul>
            )}
          </div>
        </div>
      </div>
      </div>
      </div>
    </section>
  );
}
