import { defineChain, type Address } from "viem";

export const whitechainSepolia = defineChain({
  id: 1874,
  name: "Whitechain Testnet",
  nativeCurrency: { name: "WBT", symbol: "WBT", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.whitechain.io"] } },
  blockExplorers: {
    default: { name: "Whitechain Explorer", url: "https://explorer.testnet.whitechain.io" },
  },
  testnet: true,
});

export const USDT_ADDRESS: Address = "0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7";
export const USDT_DECIMALS = 6;
