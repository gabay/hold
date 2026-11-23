export function localStorageGet(key: string): string | null {
    if (typeof localStorage !== "undefined") {
        return localStorage.getItem(key);
    }
    return null;
}

export function getDateString(date: string | Date = new Date()): string {
    const dateString = date instanceof Date ? date.toISOString() : date;
    return dateString.split("T")[0];
}

const LOCALE = import.meta.env?.VITE_LOCALE || "en-US";

export function formatCurrency(val: number, currency: string): string {
    try {
        return new Intl.NumberFormat(LOCALE, {
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
