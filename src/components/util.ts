// Utility functions shared by all components

export function localStorageGet(key: string): string | null {
    if (typeof localStorage !== "undefined") {
        return localStorage.getItem(key);
    }
    return null;
}

export function formatCurrency(val: number, currency: string): string {
    try {
        return new Intl.NumberFormat("en-US", {
            style: "currency",
            currency: currency,
            maximumFractionDigits: 2,
            maximumSignificantDigits: 6,
            roundingPriority: "lessPrecision",
        }).format(val);
    } catch (e) {
        console.error(`Error in formatCurrency(${val}, ${currency}):`, e);
        return `${currency} ${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
}
