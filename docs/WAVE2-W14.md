# W14: metadata and discovery

## Implementation plan

- [x] Inventory existing routes and read installed Next metadata conventions.
- [x] Test staging indexing refusal, public-only sitemaps, private metadata and safe JSON-LD serialization before implementation.
- [ ] Apply explicit metadata to every route without serializing customer parameters.
- [ ] Add public/docs sitemaps, robots and a visible FAQ using the same structured data.
- [ ] Keep agent references current and validate metadata wiring/typechecks.
- [ ] Lead staging response and visual acceptance; design lane owns screenshots.

## Recorded checks

- 18:07 IST: SEO tests first failed because the metadata helper did not exist; then four tests passed. No live or browser check. Offline frozen install passed with lifecycle scripts disabled.

## Policy

Staging is non-indexable regardless of the index flag. Public indexing requires BOTH an approved public origin and explicit STENMONT_INDEX_PUBLIC_SITE=yes. STENMONT_PUBLIC_ORIGIN defaults to app-staging.stenmont.com; arbitrary origins are refused. These are nonsecret future configuration names, not a production deployment instruction. Private, authentication and dynamic merchant records have no canonical or social URL, use no-referrer and stay outside sitemaps. Social previews contain the existing text-only wordmark, never invoice/customer data. Font entitlement remains unresolved; no claim that fallback rendering is licensed brand artwork.

## Sources checked

Installed Next documentation in node_modules/next/dist/docs/01-app/03-api-reference: generate-metadata, metadata/sitemap, metadata/robots and metadata/opengraph-image. Current primary pages were also fetched using agent-reach's Jina web reader:

- https://nextjs.org/docs/app/api-reference/functions/generate-metadata
- https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap

No third-party reference assets, font files, secrets or new dependencies are included.
