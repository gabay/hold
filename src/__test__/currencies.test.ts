import { describe, it, expect } from "vitest";
import { SUPPORTED_CURRENCIES } from "../lib/currencies";

describe("currencies", () => {
    it("should export SUPPORTED_CURRENCIES", () => {
        expect(SUPPORTED_CURRENCIES).toBeDefined();
        expect(SUPPORTED_CURRENCIES.USD).toBe("United States Dollar");
        expect(SUPPORTED_CURRENCIES.EUR).toBe("Euro");
    });
    it("should allow looking up currencies", () => {
        expect(SUPPORTED_CURRENCIES["USD"]).toBeDefined();
        expect(SUPPORTED_CURRENCIES["FOO"]).toBeUndefined();
    });
});
