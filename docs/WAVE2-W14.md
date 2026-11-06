# W14: metadata and discovery

## Implementation plan

- [x] Inventory existing routes and read installed Next metadata conventions.
- [x] Test staging indexing refusal, public-only sitemaps, private metadata and safe JSON-LD serialization before implementation.
- [x] Apply explicit metadata to every route without serializing customer parameters.
- [x] Add public/docs sitemaps, robots and a visible FAQ using the same structured data.
- [x] Keep agent references current and validate metadata wiring/typechecks.
- [ ] Lead staging response and visual acceptance; design lane owns screenshots.

## Recorded checks

- 18:07 IST: SEO tests first failed because the metadata helper did not exist; then four tests passed. No live or browser check. Offline frozen install passed with lifecycle scripts disabled.

## Policy

Staging is non-indexable regardless of the index flag. Public indexing requires BOTH an approved public origin and explicit STENMONT_INDEX_PUBLIC_SITE=yes. STENMONT_PUBLIC_ORIGIN defaults to app-staging.stenmont.com; arbitrary origins are refused. These are nonsecret future configuration names, not a production deployment instruction. Private, authentication and dynamic merchant records have no canonical or social URL, use no-referrer and stay outside sitemaps. Social previews use the shared text-only lowercase wordmark, never invoice/customer data. The owner confirmed moderate size, Regular400, not bold. W6b supplies a new1200×630 raster rendered from the actually loaded All Round Gothic Book font; merge that asset replacement before deploying this metadata. This lane viewed the replacement PNG and read W6b's CDP proof of eight glyphs from AllRoundGothic-Book. Font licence entitlement is separate from successful loading; no font binary is committed.

## Sources checked

Installed Next documentation in node_modules/next/dist/docs/01-app/03-api-reference: generate-metadata, metadata/sitemap, metadata/robots and metadata/opengraph-image. Current primary pages were also fetched using agent-reach's Jina web reader:

- https://nextjs.org/docs/app/api-reference/functions/generate-metadata
- https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap

No third-party reference assets, font files, secrets or new dependencies are included.

- 18:10 IST: All 35 pages (34 existing plus FAQ) have explicit distinct metadata. Eight focused tests pass across four files; web typegen/TypeScript passed before final discovery routes. No browser run by this lane.

- 18:13 IST: Removed unapproved fallback social artwork after the explicit Medium-wordmark correction. New assertions failed on old image references, then all 32 targeted tests passed; final web typecheck passed.

- 18:15 IST: Generated both llms files from the route inventory/current API event list and kept all seven MCP tool names covered. Final targeted command: 32 tests across seven files passed; changed-file ESLint and web typecheck passed. Next build passed under the shared build lock. A real local Next server returned correct heads for 35/35 pages and 200 for robots, both sitemaps and both llms files; server stopped. Private evidence remains outside Git.

## Acceptance boundaries

No deployment, browser screenshot, screen-reader session, 200% zoom audit, Lighthouse/Web Vitals score, search-engine submission, provider call, external account or payment ran in this lane. The 35-page check fetched actual server HTML, including dummy dynamic parameters; it is metadata evidence, not visual or transaction acceptance. W6b owns the visual review. Public marketing/docs routes prerender in the local build; metadata adds no client component or external data request.

Social image references require W6b's actual-font raster replacement in the same release. The old bold fallback must never be deployed with these references. Root layout deliberately omits the home canonical/og:url so private children do not inherit them.

## Exact final commands

- `pnpm install --offline --frozen-lockfile --ignore-scripts --config.strictDepBuilds=false`: passed, no dependency changes.
- `pnpm --filter @stenmont/web llms`: generated both references, passed; Node emitted the existing package module-type warning for TypeScript imports.
- `pnpm --filter @stenmont/web test test/seo.test.ts test/seoRoutes.test.ts test/seoFaq.test.tsx test/seoDiscovery.test.tsx test/seoAgentDocs.test.ts test/docs.test.tsx test/agentAccess.test.tsx --maxWorkers=1`: 32 passed. Existing Vite configuration warnings remain.
- `pnpm --filter @stenmont/web typecheck`: passed.
- Changed TypeScript/TSX files through `pnpm --filter @stenmont/web exec eslint …`: passed.
- `pnpm --filter @stenmont/web build`: passed under the shared lock; no external data requests added.
- `pnpm --filter @stenmont/web start --port 3007` plus an HTTP head parser over every route: 35/35 passed and five discovery/text resources returned 200. Server stopped afterward. No browser was launched.

The full workspace suite was not repeated; the lead owns the final integrated run.

- 18:18 IST: Owner confirmed moderate-size Regular400 wordmark. Viewed W6b's actual-font1200×630 replacement and its CDP glyph evidence, then restored OG/Twitter/logo references. Final32 targeted tests and typecheck passed again; build/35-page HTTP run predate this small reference restoration. Lead must merge the matching W6b asset before final release.
