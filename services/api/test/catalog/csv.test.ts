import { describe, expect, it } from "vitest";
import { parseCsv } from "../../src/import/shopify/csv";
import { ImportError } from "../../src/import/shopify/types";

describe("parseCsv", () => {
  it("handles a BOM, CRLF, quoted commas, quotes and line breaks", () => {
    const text = '﻿Name, Note\r\n"Smith, Jo","said ""hi""\r\nthere"\r\nplain,x\r\n';
    const { header, rows } = parseCsv(text);
    expect(header).toEqual(["name", "note"]);
    expect(rows).toEqual([{ name: "Smith, Jo", note: 'said "hi"\r\nthere' }, { name: "plain", note: "x" }]);
  });
  it("accepts LF and bare CR line ends and a missing final newline", () => {
    expect(parseCsv("a,b\n1,2\n3,4").rows).toHaveLength(2);
    expect(parseCsv("a,b\r1,2\r3,4").rows).toHaveLength(2);
  });
  it("skips blank lines and pads short rows", () => {
    expect(parseCsv("a,b\n\n1\n\n").rows).toEqual([{ a: "1", b: "" }]);
  });
  it("keeps empty quoted values", () => {
    expect(parseCsv('a,b\n"",x').rows).toEqual([{ a: "", b: "x" }]);
  });
  it("stops past the row limit with a clear error", () => {
    const big = "a\n" + Array.from({ length: 11 }, (_, i) => String(i)).join("\n");
    expect(() => parseCsv(big, 10)).toThrowError(ImportError);
    expect(() => parseCsv(big, 11)).not.toThrow();
  });
  it("handles 50,000 rows quickly", () => {
    const text = "a,b\n" + Array.from({ length: 50_000 }, (_, i) => `${i},"x, ${i}"`).join("\n");
    const t0 = Date.now();
    expect(parseCsv(text).rows).toHaveLength(50_000);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
  it("rejects a file cut inside a quote", () => {
    expect(() => parseCsv('a\n"oops')).toThrowError(/cut off/);
  });
  it("rejects absurdly large input", () => {
    expect(() => parseCsv("a".repeat(25_000_001))).toThrowError(/too large/);
  });
});
