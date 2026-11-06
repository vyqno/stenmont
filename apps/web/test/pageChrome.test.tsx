import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState, PageHeader, PageNotice } from "../components/ui";

describe("page header and empty state", () => {
  it("renders the title as the only h1, with description and action", () => {
    const html = renderToStaticMarkup(<PageHeader title="Public profile" description="How people find you." action={<a href="/x">Go</a>} />);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("Public profile");
    expect(html).toContain("How people find you.");
    expect(html).toContain('href="/x"');
  });
  it("omits the description when there is none", () => {
    expect(renderToStaticMarkup(<PageHeader title="Books" />)).not.toContain("<p");
  });
  it("empty state names what is absent and offers the next step", () => {
    const html = renderToStaticMarkup(<EmptyState title="No products yet" description="Add one to start." action={<a href="/add">Add</a>} />);
    expect(html).toContain("No products yet");
    expect(html).toContain('href="/add"');
  });
  it("announces errors as alerts and loading as busy status", () => {
    expect(renderToStaticMarkup(<PageNotice kind="error">Nope</PageNotice>)).toContain('role="alert"');
    expect(renderToStaticMarkup(<PageNotice kind="loading">Loading</PageNotice>)).toContain('aria-busy="true"');
  });
});
