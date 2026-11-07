import Link from "next/link";

/** Moving a Shopify catalogue in, and launching a hosted shop. Every claim here has run on the test network. */
const STEPS = [
  ["Connect or export", "Connect your Shopify store with one click, or open Products in Shopify and choose Export for a standard CSV file."],
  ["Upload it to Stenmont", "A preview shows what will be created, with warnings, before anything is saved."],
  ["Launch the shop", "Your catalogue gets a public store with a cart priced on the server and checkout in USDT."],
] as const;

export function Migrate() {
  return (
    <section id="migrate" className="mg">
      <div className="v2-wrap mg-grid">
        <div>
          <p className="v2-eyebrow v2-rv">Moving from Shopify</p>
          <h2 className="v2-h v2-title">Bring your catalogue. <span className="v2-blue">Launch your shop here.</span></h2>
          <p className="v2-lede v2-rv">Keep Shopify, or leave it. Import your products from Shopify's own export, check the preview, and have a store that takes USDT. Importing again updates your products and never creates duplicates.</p>
          <div className="mg-actions v2-rv">
            <Link href="/store/eth-stenmont" className="v3-btn v3-btn-blue">See a store made this way</Link>
            <Link href="/dashboard/import" className="v3-btn v3-btn-line">Import a catalogue</Link>
          </div>
        </div>
        <div className="mg-side">
          <ol className="mg-steps">{STEPS.map(([t, b], i) => <li key={t}><span className="n">0{i + 1}</span><div><h3>{t}</h3><p>{b}</p></div></li>)}</ol>
          <p className="mg-note"><b>What does not move:</b> themes and pages, discount codes, gift cards, payment, shipping and tax settings, and apps. One-click connect to Shopify works on the test network for stores in our Shopify organisation; a public Shopify listing is waiting on Shopify's review. Upload a CSV export or use an API token for any other store.</p>
        </div>
      </div>
    </section>
  );
}
