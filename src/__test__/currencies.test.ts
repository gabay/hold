import { describe, it, expect } from "vitest";
import { CURRENCIES } from "../lib/currencies";

describe("currencies", () => {
    it("should export SUPPORTED_CURRENCIES", () => {
        expect(CURRENCIES).toBeDefined();
        expect(CURRENCIES.USD).toStrictEqual({ symbol: "$", name: "United States Dollar" });
        expect(CURRENCIES.EUR).toStrictEqual({ symbol: "€", name: "Euro" });
    });
    it("should allow looking up currencies", () => {
        expect(CURRENCIES["USD"]).toBeDefined();
        expect(CURRENCIES["FOO"]).toBeUndefined();
    });
});
