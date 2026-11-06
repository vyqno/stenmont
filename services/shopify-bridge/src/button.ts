/** The storefront button: one script tag in a Shopify theme adds "Pay with USDT" under the cart's checkout button.
 *  The script is served by the bridge so the shop owner pastes one line and never edits the code. It sends only variant
 *  ids and quantities; the price is read from Shopify on the server. Text is set with textContent, never innerHTML. */
export const BUTTON_SCRIPT = String.raw`(function () {
  if (window.__stenmontButton) return;
  window.__stenmontButton = true;
  var me = document.currentScript;
  var bridge = me && me.src ? new URL(me.src).origin : "";
  if (!bridge) return;
  var LABEL = "Pay with USDT";

  function note(text, kind) {
    var n = document.getElementById("stenmont-note");
    if (!n) { n = document.createElement("p"); n.id = "stenmont-note"; n.setAttribute("role", "status"); n.style.cssText = "margin:8px 0;font:14px/1.4 system-ui,sans-serif"; }
    n.textContent = text; n.style.color = kind === "error" ? "#b42318" : "#1a1a1a";
    return n;
  }

  async function pay(btn, host) {
    btn.disabled = true; btn.textContent = "One moment…";
    try {
      var cart = await (await fetch("/cart.js", { headers: { accept: "application/json" } })).json();
      var lines = (cart.items || []).map(function (i) { return { variantId: String(i.variant_id), quantity: i.quantity }; });
      if (!lines.length) throw new Error("Your cart is empty.");
      var res = await fetch(bridge + "/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cartLines: lines }) });
      var body = await res.json().catch(function () { return {}; });
      if (!res.ok || !body.payUrl) throw new Error((body.error && body.error.message) || "Could not start the payment.");
      var u = new URL(body.payUrl);
      if (u.protocol !== "https:") throw new Error("Could not start the payment.");
      location.assign(u.toString());
    } catch (e) {
      btn.disabled = false; btn.textContent = LABEL;
      host.appendChild(note(e instanceof Error ? e.message : "Could not start the payment.", "error"));
    }
  }

  function mount() {
    if (document.getElementById("stenmont-pay")) return;
    var form = document.querySelector('form[action="/cart"]') || document.querySelector("form.cart") || document.querySelector("cart-items");
    if (!form) return;
    var host = document.createElement("div"); host.id = "stenmont-pay"; host.style.cssText = "margin:12px 0";
    var btn = document.createElement("button");
    btn.type = "button"; btn.textContent = LABEL;
    btn.style.cssText = "width:100%;padding:14px 18px;border:1px solid #1a1a1a;border-radius:8px;background:#fff;color:#1a1a1a;font:600 15px system-ui,sans-serif;cursor:pointer";
    btn.addEventListener("click", function () { pay(btn, host); });
    host.appendChild(btn);
    form.parentNode.insertBefore(host, form.nextSibling);
  }

  function returned() {
    var q = new URLSearchParams(location.search);
    if (q.get("stenmont") !== "paid") return;
    fetch("/cart/clear.js", { method: "POST" }).catch(function () {});
    var banner = note("Payment received. Thank you, your order is confirmed.", "ok");
    banner.style.cssText += ";padding:12px 16px;border:1px solid #1a1a1a;border-radius:8px";
    var main = document.querySelector("main") || document.body;
    main.insertBefore(banner, main.firstChild);
  }

  function start() { returned(); mount(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();`;
