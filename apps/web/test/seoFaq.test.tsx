import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import FaqPage from "../app/docs/faq/page";
import { FAQ, faqJsonLd } from "../lib/faq";

it("publishes only the same factual questions and answers visible to the reader", () => {
  const html = renderToStaticMarkup(<FaqPage />);
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  expect(match).toBeTruthy();
  expect(JSON.parse(match![1]!)).toEqual(faqJsonLd());
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, "");
  for (const entry of FAQ) {
    expect(visible).toContain(entry.question);
    expect(visible).toContain(entry.answer);
  }
  expect(html).not.toMatch(/aggregateRating|offers|guaranteed|KYC/);
});
