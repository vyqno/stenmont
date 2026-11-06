import { SAMPLES, type SampleName } from "../../lib/docSamples";

/** A code sample from lib/docSamples.ts: the same text the tests run and /llms-full.txt carries. */
export function Code({ name }: { name: SampleName }) {
  return (
    <pre className="my-4 overflow-x-auto rounded-lg border border-line bg-surface p-4 text-sm leading-relaxed" tabIndex={0}>
      <code data-sample={name}>{SAMPLES[name].code}</code>
    </pre>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="my-4 rounded-lg border border-line bg-surface p-4 text-sm text-muted">{children}</p>;
}
