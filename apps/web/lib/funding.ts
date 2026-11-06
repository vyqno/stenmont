import { isTestEnvironment } from "./pay";

/**
 * Where USDT on Whitechain comes from. Only what Whitechain's own tools do: we do not sell USDT, take cards or run an on-ramp.
 * (Customers pay with USDT they already hold; this is help for the ones who do not have it on Whitechain yet.)
 */
export const FUNDING = {
  bridge: { mainnet: "https://bridge.whitechain.io", testnet: "https://bridge.testnet.whitechain.io" },
  title: "Where do I get USDT on Whitechain?",
  steps: [
    "From the WhiteBIT exchange: hold or buy USDT there, then withdraw it and choose the Whitechain network.",
    "From another network: Whitechain's Portal bridge moves USDT over from the networks it supports, such as Ethereum and Tron.",
  ],
  disclaimer: "We don't sell USDT and we don't take cards. Stenmont only sends the payment you approve.",
  testNote: "This is a test version: test funds are added for you automatically, and they have no value.",
} as const;

export function fundingFor(hostname: string) {
  const test = isTestEnvironment(hostname);
  return { ...FUNDING, bridgeUrl: test ? FUNDING.bridge.testnet : FUNDING.bridge.mainnet, testNote: test ? FUNDING.testNote : null };
}
