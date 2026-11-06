import type { ReactNode } from "react";

/** Only web addresses: anything else (javascript:, data:, protocol-relative) is refused rather than rendered. */
const safe = (u: string) => /^https?:\/\/[^\s/]/i.test(u);

/**
 * "Pay" button for a checkout session. Create the session on your server (`stenmont.checkout.sessions.create`) and pass
 * its `url`. It is a plain link, so it works without JavaScript and in any framework.
 */
export function PayButton({ sessionUrl, children = "Pay", className }: { sessionUrl: string; children?: ReactNode; className?: string }) {
  if (!safe(sessionUrl)) {
    return (
      <button type="button" disabled className={className}>
        {children}
      </button>
    );
  }
  return (
    <a href={sessionUrl} className={className} role="button">
      {children}
    </a>
  );
}
