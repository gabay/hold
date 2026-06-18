"use client";

import React, { useState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { getDate, getDateString } from "@/lib/util";
import { Transaction } from "@prisma/client";
import { SearchAssetResult } from "@/lib/finance";

interface TransactionModalProps {
    isOpen: boolean;
    onClose: () => void;
    portfolioId: string;
    editingTransaction: Transaction | null;
    onSuccess: () => void;
}

export default function TransactionModal({
    isOpen,
    onClose,
    portfolioId,
    editingTransaction,
    onSuccess,
}: TransactionModalProps) {
    const [formSymbol, setFormSymbol] = useState(editingTransaction?.symbol || "");
    const [formType, setFormType] = useState(editingTransaction?.type || "BUY");
    const [formQuantity, setFormQuantity] = useState(editingTransaction?.quantity.toString() || "");
    const [formPrice, setFormPrice] = useState(editingTransaction?.pricePerShare.toString() || "");
    const [formCurrency, setFormCurrency] = useState(editingTransaction?.currency || "");
    const [formDate, setFormDate] = useState(
        getDateString(editingTransaction?.transactionDate || getDate()),
    );
    const [formSubmitting, setFormSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Autocomplete states
    const [suggestions, setSuggestions] = useState<SearchAssetResult[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [searching, setSearching] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(-1);
    const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const symbolInputRef = useRef<HTMLInputElement>(null);

    // Reset form data on open.
    const [prevIsOpen, setPrevIsOpen] = useState(false);
    if (isOpen !== prevIsOpen) {
        setPrevIsOpen(isOpen);
        if (isOpen) {
            setFormSymbol(editingTransaction?.symbol || "");
            setFormType(editingTransaction?.type || "BUY");
            setFormQuantity(editingTransaction?.quantity.toString() || "");
            setFormPrice(editingTransaction?.pricePerShare.toString() || "");
            setFormCurrency(editingTransaction?.currency || "");
            setFormDate(getDateString(editingTransaction?.transactionDate || getDate()));
        }
    }

    // Focus on mount
    useEffect(() => {
        if (isOpen) {
            symbolInputRef.current?.focus();
        }
    }, [isOpen]);

    // ESC key listener
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isOpen) {
                onClose();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    const handleSymbolChange = (value: string) => {
        setFormSymbol(value);
        setSelectedIndex(-1);

        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }

        if (value.trim().length < 2) {
            setSuggestions([]);
            setShowSuggestions(false);
            return;
        }

        setSuggestions([]);
        setShowSuggestions(true);
        setSearching(true);
        searchTimeoutRef.current = setTimeout(async () => {
            try {
                const res = await fetch(`/api/finance/search?q=${encodeURIComponent(value)}`);
                if (res.ok) {
                    const data = await res.json();
                    setSuggestions(data);
                }
            } catch (err) {
                console.error(err);
            } finally {
                setSearching(false);
            }
        }, 400);
    };

    const selectSuggestion = (symbol: string) => {
        setFormSymbol(symbol);
        setShowSuggestions(false);
        setSuggestions([]);
        setSelectedIndex(-1);
    };

    const handleSymbolKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (!showSuggestions) return;

        switch (e.key) {
            case "ArrowDown":
                e.preventDefault();
                setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
                break;
            case "ArrowUp":
                e.preventDefault();
                setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
                break;
            case "Enter":
                e.preventDefault();
                if (selectedIndex >= 0 && suggestions[selectedIndex]) {
                    selectSuggestion(suggestions[selectedIndex].symbol);
                }
                break;
            case "Escape":
                e.stopPropagation();
                setShowSuggestions(false);
                break;
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (formCurrency && !SUPPORTED_CURRENCIES[formCurrency]) {
            setError(
                `Unsupported currency "${formCurrency}". Please use a standard currency code.`,
            );
            return;
        }

        setFormSubmitting(true);
        setError(null);

        const url = editingTransaction
            ? `/api/portfolio/${portfolioId}/transactions/${editingTransaction.id}`
            : `/api/portfolio/${portfolioId}/transactions`;
        const method = editingTransaction ? "PUT" : "POST";

        try {
            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    symbol: formSymbol,
                    type: formType,
                    quantity: parseFloat(formQuantity),
                    pricePerShare: parseFloat(formPrice),
                    currency: formCurrency,
                    transactionDate: new Date(formDate).toISOString(),
                }),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(
                    errData.error ||
                        `Failed to ${editingTransaction ? "update" : "add"} transaction`,
                );
            }

            onSuccess();
            onClose();
        } catch (err: unknown) {
            setError((err as Error).message);
        } finally {
            setFormSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-md bg-slate-900 rounded-2xl p-6 shadow-2xl border border-slate-800 space-y-6"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center">
                    <h3 className="text-lg font-bold text-slate-100">
                        {editingTransaction ? "Edit Transaction" : "Log Transaction"}
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-white text-sm font-semibold"
                    >
                        Close
                    </button>
                </div>

                {error && (
                    <div className="rounded-xl border border-red-900 bg-red-955/40 p-3 text-xs text-red-300">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="relative">
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                                Ticker Symbol
                            </label>
                            <input
                                ref={symbolInputRef}
                                type="text"
                                required
                                placeholder="e.g. AAPL, VWCE.DE"
                                value={formSymbol}
                                onChange={(e) => handleSymbolChange(e.target.value)}
                                onKeyDown={handleSymbolKeyDown}
                                onBlur={() => setShowSuggestions(false)}
                                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-100"
                                autoComplete="off"
                            />

                            {showSuggestions && (
                                <div
                                    className="absolute left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-1 shadow-2xl"
                                    onMouseDown={(e) => e.preventDefault()}
                                >
                                    {searching && suggestions.length === 0 ? (
                                        <div className="flex items-center justify-center p-3 text-xs text-slate-500">
                                            <Loader2 className="h-4 w-4 animate-spin mr-2" />{" "}
                                            Searching...
                                        </div>
                                    ) : suggestions.length > 0 ? (
                                        <div className="divide-y divide-slate-900">
                                            {suggestions.map((item, index) => (
                                                <button
                                                    key={item.symbol}
                                                    type="button"
                                                    tabIndex={-1}
                                                    onMouseDown={() =>
                                                        selectSuggestion(item.symbol)
                                                    }
                                                    className={`flex w-full flex-col text-left px-3 py-2 text-xs transition-all rounded-lg ${
                                                        index === selectedIndex
                                                            ? "bg-slate-800"
                                                            : "hover:bg-slate-900"
                                                    }`}
                                                >
                                                    <div className="flex justify-between items-center w-full">
                                                        <span className="font-bold text-white">
                                                            {item.symbol}
                                                        </span>
                                                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold uppercase bg-slate-900 text-slate-400">
                                                            {item.type}
                                                        </span>
                                                    </div>
                                                    <span className="text-[11px] text-slate-400 truncate w-full mt-0.5">
                                                        {item.name}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    ) : !searching && formSymbol.trim().length >= 2 ? (
                                        <div className="p-3 text-center text-xs text-slate-500">
                                            No results found
                                        </div>
                                    ) : null}
                                </div>
                            )}
                        </div>
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                                Type
                            </label>
                            <select
                                value={formType}
                                onChange={(e) => setFormType(e.target.value)}
                                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-100"
                            >
                                <option value="BUY">BUY</option>
                                <option value="SELL">SELL</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                                Quantity
                            </label>
                            <input
                                type="number"
                                step="any"
                                required
                                placeholder="e.g. 5"
                                value={formQuantity}
                                onChange={(e) => setFormQuantity(e.target.value)}
                                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-100"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                                Price Per Share
                            </label>
                            <input
                                type="number"
                                step="any"
                                required
                                placeholder="e.g. 175.50"
                                value={formPrice}
                                onChange={(e) => setFormPrice(e.target.value)}
                                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-100"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                                Currency
                            </label>
                            <input
                                type="text"
                                placeholder="e.g. USD (optional)"
                                value={formCurrency}
                                onChange={(e) => {
                                    const currency = e.target.value.toUpperCase().trim();
                                    setFormCurrency(currency);
                                    setError(
                                        currency.length < 3 || SUPPORTED_CURRENCIES[currency]
                                            ? null
                                            : `Unsupported currency "${currency}".`,
                                    );
                                }}
                                onBlur={() =>
                                    setError(
                                        !formCurrency || SUPPORTED_CURRENCIES[formCurrency]
                                            ? null
                                            : `Unsupported currency "${formCurrency}".`,
                                    )
                                }
                                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-100"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                                Date
                            </label>
                            <input
                                type="date"
                                required
                                value={formDate}
                                onChange={(e) => setFormDate(e.target.value)}
                                className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-100"
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={formSubmitting}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 transition-all disabled:opacity-50"
                    >
                        {formSubmitting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                        ) : editingTransaction ? (
                            "Update Transaction"
                        ) : (
                            "Save Transaction"
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
}
