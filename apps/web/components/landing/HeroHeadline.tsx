import { LOGOS } from "./logos";

/** The hero headline, set large with small living pictures between the words (after the reference): a strip of platform
 *  icons that scrolls by itself, a button that gets clicked, an amount that rolls to Paid, and an invoice that becomes a
 *  token. All CSS motion, all decorative; the h1 carries the real sentence for screen readers. */
const ICONS: readonly (readonly [string, string])[] = [
  ["Shopify", LOGOS.shopify], ["WooCommerce", LOGOS.woocommerce], ["Webflow", LOGOS.webflow], ["Wix", LOGOS.wix], ["Squarespace", LOGOS.squarespace], ["BigCommerce", LOGOS.bigcommerce],
];

function IconStrip() {
  const row = (k: string) => (
    <ul key={k} className="hl-row" aria-hidden="true">
      {ICONS.map(([n, d]) => <li key={n}><svg viewBox="0 0 24 24"><path d={d} fill="url(#hl-dither)" /></svg></li>)}
      <li><span className="hl-code">{"</>"}</span></li>
    </ul>
  );
  return <span className="hl-chip hl-strip" aria-hidden="true"><span className="hl-track">{row("a")}{row("b")}</span></span>;
}

export function HeroHeadline() {
  return (
    <h1 className="hl" aria-label="Connect your store in one click. Get paid in USDT. Tokenize what you're owed.">
      <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
        <defs>
          <pattern id="hl-dither" width="1.5" height="1.5" patternUnits="userSpaceOnUse">
            <rect x="0" y="0" width="0.8" height="0.8" fill="#548cff" /><rect x="0.75" y="0.75" width="0.75" height="0.75" fill="#548cff" />
          </pattern>
        </defs>
      </svg>
      <span className="hl-line" aria-hidden="true">Connect <IconStrip /></span>
      <span className="hl-line" aria-hidden="true">your store in <span className="hl-chip hl-click"><span className="hl-btn">One click</span><i className="hl-cursor" /><b className="hl-tick"><span>&#10003;</span> Connected</b></span></span>
      <span className="hl-line" aria-hidden="true"><span className="v2-blue">Get paid</span> in <span className="hl-chip hl-amt"><span className="hl-roll"><em>0.00</em><em>0.42</em><em>1.00</em><em className="hl-paid">Paid</em></span></span></span>
      <span className="hl-line" aria-hidden="true">Tokenize <span className="hl-chip hl-tok"><img className="hl-a" src="/art/dither-invoice.png" alt="" /><img className="hl-b" src="/art/dither-token.png" alt="" /></span></span>
      <span className="hl-line" aria-hidden="true"><span className="v2-blue">what you&rsquo;re owed.</span></span>
    </h1>
  );
}
