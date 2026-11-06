import { describe, expect, it } from "vitest";
import { signInMethods } from "../lib/signInMethods";

describe("signInMethods", () => {
  it("is off unless the flag is exactly 1", () => {
    expect(signInMethods({})).toEqual({ email: false, google: false });
    expect(signInMethods({ email: "true", google: "0" })).toEqual({ email: false, google: false });
  });
  it("turns each method on separately", () => {
    expect(signInMethods({ email: "1" })).toEqual({ email: true, google: false });
    expect(signInMethods({ google: "1" })).toEqual({ email: false, google: true });
  });
});
