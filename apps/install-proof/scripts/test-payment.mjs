// No API key is needed here: exercise the deployed server's server-priced order.
const origin = "https://install-proof-staging.stenmont.com";
try {
  const order = await fetch(`${origin}/buy/test`, { method: "POST", redirect: "manual" });
  const path = order.headers.get("location");
  if (order.status !== 303 || !/^\/orders\/[0-9a-f]+\/pay$/.test(path ?? "")) throw new Error();
  const checkout = await fetch(`${origin}${path.replace(/\/pay$/, "/checkout")}`, { method: "POST", redirect: "manual" });
  const payUrl = new URL(checkout.headers.get("location") ?? "");
  if (checkout.status !== 303 || payUrl.origin !== "https://app-staging.stenmont.com" || !payUrl.pathname.startsWith("/pay/")) throw new Error();
  console.log(`Open this hosted test payment URL using a supported, already-funded test payer: ${payUrl.href}`);
  console.log("No wallet is funded by this script. If the funded payer cannot use the hosted flow, stop and report the missing payment path; a separately authorized relay receipt test must be labelled as such.");
  console.log(`After payment, check the signed-webhook order status here: ${origin}${path.replace(/\/pay$/, "")}`);
} catch {
  console.error("Could not create the test payment. Check isolated staging deployment and server secret settings.");
  process.exitCode = 1;
}
