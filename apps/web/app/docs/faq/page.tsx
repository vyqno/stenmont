import { FAQ, faqJsonLd } from "../../../lib/faq";
import { pageMetadata, safeJsonLd } from "../../../lib/seo";

export const metadata = pageMetadata("/docs/faq");
export default function FaqPage() {
  return <>
    <h1>Frequently asked questions</h1>
    <p>Current limits and responsibilities on the test network.</p>
    {FAQ.map(f => <section key={f.question}><h2>{f.question}</h2><p>{f.answer}</p></section>)}
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(faqJsonLd()) }} />
  </>;
}
