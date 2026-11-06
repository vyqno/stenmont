# Staging visual acceptance

Reviewed the staging app at1440 and390 pixels. This records visual inspection, not completion of the held World or investor journeys.

- Initial coverage:35 page templates plus an additional retained v1 payment,72 captures. All document navigations returned200; no browser errors, unexpected sign-in redirects or document overflow.
- Native review caught broken mobile money digits/status words despite the clean overflow checks. The existing money, badge and invoice-row layout now keeps these values whole and permits the invoice label to shrink.
- Rechecked13 affected route representatives at both widths,26 captures. Actual dashboard amounts and statuses remained whole; the real v2 paid page showed0.098, and the retained v1 payment showed1.00. Tables keep intentional internal horizontal scrolling.
- A separate Settings Revoke button wrap was fixed without changing its behavior. Final live390/1440 screenshots showed one-line text and no page overflow. Key displays were masked in evidence.
- Catalogue/subscription amount labels now sayUSDT.
- The selected lowercase wordmark and supporting type system were retained. Reference folders and font binaries were not committed.

## Actual verification

Full release workspace suite1718 passed; web282, typecheck, lint and Cloudflare build passed. One pre-existing unused-import lint warning remains. Final web version9b8ab2c9-6d22-40cd-9ebc-fc2438a6d5ba passed40/40 staging probes. The local UI returned200 on port1406.

Read-only capture browsers blocked non-GET requests and clicked no action buttons. Empty investor/missing claim/unregistered OAuth states were recorded as such; they are not real funded certificate or OAuth consent evidence. Native desktop/mobile screenshots are retained locally for founder review.

Real payment and acknowledgement observations are recorded separately in [V2 staging acceptance](V2-STAGING-ACCEPTANCE.md). Real World, the dashboard financing lifecycle, form submissions and a formal accessibility audit are not claimed by this visual review.
