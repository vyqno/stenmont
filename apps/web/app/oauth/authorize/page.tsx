import Consent from "./Consent";

export const metadata = { title: "Connect an app · Stenmont" };

export default function Page() {
  return (
    <main className="auth-sheet consent-sheet">
      <Consent />
    </main>
  );
}
