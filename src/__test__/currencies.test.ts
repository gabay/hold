import { SUPPORTED_CURRENCIES } from "../lib/currencies";

describe("currencies", () => {
    it("should export SUPPORTED_CURRENCIES", () => {
        expect(SUPPORTED_CURRENCIES).toBeDefined();
        expect(SUPPORTED_CURRENCIES.USD).toBe("United States Dollar");
        expect(SUPPORTED_CURRENCIES.EUR).toBe("Euro");
        expect(SUPPORTED_CURRENCIES.ILS).toBe("Israeli New Sheqel");
    });
});
