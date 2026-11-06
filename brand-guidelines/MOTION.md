# Motion

Use motion to explain a state change, never to imply financial completion. No glow, bouncing money, spinning coins or animated wordmark reconstruction.

| Use | Duration | Rule |
|---|---|---|
| Hover / focus | 100 ms | Colour or border only |
| Disclosure / menu | 160 ms | Opacity; preserve focus order |
| Panel change | 200 ms | Opacity and at most 8 px translation |
| Pending indicator | Continuous only while pending | Named state; no invented progress |

Use ease-out for entry and ease-in for exit. Respect prefers-reduced-motion: remove translation and decorative animation; present state changes immediately. Announce meaningful updates once, without reading every animation frame.

Financial status changes come from verified application data. A checkmark animation must not precede confirmation. Demo recordings run at real speed and stay below four minutes; waiting is edited out by cutting scenes, never by accelerating playback.
