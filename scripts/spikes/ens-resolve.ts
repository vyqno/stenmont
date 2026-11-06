import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";
const pub = createPublicClient({ chain: sepolia, transport: http("https://sepolia.gateway.tenderly.co") });
const name = process.argv[2]!;
console.log("addr   :", await pub.getEnsAddress({ name }).catch((e) => `ERR ${e.shortMessage}`));
console.log("payout :", await pub.getEnsText({ name, key: "stenmont.payout" }).catch((e) => `ERR ${e.shortMessage}`));
console.log("profile:", await pub.getEnsText({ name, key: "stenmont.profile" }).catch((e) => `ERR ${e.shortMessage}`));
console.log("resolver:", await pub.getEnsResolver({ name }).catch((e) => `ERR ${e.shortMessage}`));
