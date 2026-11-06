export const FAQ = [
  { question: "Is this the production payment service?", answer: "No. This build uses Whitechain Sepolia and test USDT. Test tokens have no monetary value." },
  { question: "Who supplies the USDT for a payment?", answer: "The payer brings their own USDT. Stenmont does not fund customer wallets or sell tokens." },
  { question: "Can an agent send a refund without the merchant?", answer: "No. Refund tools prepare a draft. The merchant confirms with a passkey, and large refunds also require the configured human approval." },
  { question: "Does a signed Books bundle prove every business transaction is included?", answer: "No. It verifies the recorded ledger lines and service signature. It cannot prove that offchain income is complete, and an onchain anchor is a separate step." },
] as const;
export const faqJsonLd = () => ({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map(f => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })) });
