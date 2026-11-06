// Default is a no-network rehearsal. --discover reads ENS/card; --call additionally calls list_catalogue only.
import { createPublicClient, fallback, http } from "viem";
import { sepolia } from "viem/chains";
import { callSkill, discoverAgent } from "@stenmont/agent";
const args = process.argv.slice(2);
const name = args.find(v => !v.startsWith("--"));
if (!name || args.some(v => v.startsWith("--") && !["--discover", "--call"].includes(v))) throw new Error("Usage: a2a-demo.ts label.stenmont.eth [--discover] [--call]");
if (!args.includes("--discover")) {
  console.log("Dry run: would read stenmont.a2a, validate its A2A 1.0 card and optionally call list_catalogue. No payment or invoice creation.");
} else {
  const rpc = process.env.SEPOLIA_RPC;
  const client = createPublicClient({ chain: sepolia, transport: fallback([...(rpc ? [http(rpc)] : []), http("https://ethereum-sepolia-rpc.publicnode.com")]) });
  const options = { read: (business: string, key: string) => client.getEnsText({ name: business, key }) };
  const agent = await discoverAgent(name, options);
  console.log("Discovered:", agent.name, "protocol 1.0; skills:", agent.card.skills.map(s => s.id).join(", "));
  if (args.includes("--call")) {
    const token = process.env.STENMONT_A2A_TOKEN;
    if (!token) throw new Error("STENMONT_A2A_TOKEN is required for --call; never pass it as a command-line argument");
    await callSkill(agent, "list_catalogue", {}, token, options);
    console.log("Catalogue task returned. No funds moved and no invoice created.");
  }
}
