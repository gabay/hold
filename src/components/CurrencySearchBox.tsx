"use client";

import React, { useState, useEffect, useRef } from "react";
import { Search, ChevronDown } from "lucide-react";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";

interface CurrencySearchBoxProps {
    value: string;
    onChange: (currency: string) => void;
}

export default function CurrencySearchBox({ value, onChange }: CurrencySearchBoxProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);

    // Close dropdown on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setSearch("");
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    const handleToggle = () => {
        setIsOpen((prev) => {
            const next = !prev;
            if (!next) setSearch("");
            return next;
        });
    };

    const filteredCurrencies = Object.entries(SUPPORTED_CURRENCIES).filter(
        ([code, name]) =>
            code.toLowerCase().includes(search.toLowerCase()) ||
            name.toLowerCase().includes(search.toLowerCase()),
    );

    return (
        <div className="relative inline-block text-left" ref={containerRef}>
            <div>
                <button
                    type="button"
                    onClick={handleToggle}
                    className="inline-flex w-full justify-between items-center gap-x-1.5 rounded-lg border border-slate-800 bg-slate-950 text-slate-100 px-3 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500 shadow-sm"
                    aria-expanded={isOpen}
                    aria-haspopup="true"
                >
                    <span>
                        {value} (
                        {SUPPORTED_CURRENCIES[value]
                            ? value === "USD"
                                ? "$"
                                : value === "EUR"
                                  ? "€"
                                  : value === "ILS"
                                    ? "₪"
                                    : value === "GBP"
                                      ? "£"
                                      : value
                            : value}
                        )
                    </span>
                    <ChevronDown className="-mr-1 h-4 w-4 text-slate-400" aria-hidden="true" />
                </button>
            </div>

            {isOpen && (
                <div className="absolute right-0 z-50 mt-2 w-72 origin-top-right rounded-lg bg-slate-950 shadow-xl ring-1 ring-black ring-opacity-5 focus:outline-none max-h-96 flex flex-col">
                    <div className="p-2 border-b border-slate-900 sticky top-0 bg-slate-950">
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
                            <input
                                type="text"
                                placeholder="Search currency..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full pl-9 pr-3 py-1.5 text-sm bg-slate-900 border border-slate-800 rounded-md text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                autoFocus
                            />
                        </div>
                    </div>
                    <div className="overflow-y-auto flex-1 py-1 max-h-64">
                        {filteredCurrencies.length === 0 ? (
                            <div className="px-4 py-2 text-sm text-slate-500">
                                No currency found
                            </div>
                        ) : (
                            filteredCurrencies.map(([code, name]) => (
                                <button
                                    key={code}
                                    type="button"
                                    onClick={() => {
                                        onChange(code);
                                        setIsOpen(false);
                                        setSearch("");
                                    }}
                                    className={`w-full text-left px-4 py-2 text-sm flex justify-between items-center hover:bg-slate-900 transition-colors ${
                                        value === code
                                            ? "bg-slate-900 text-sky-400 font-semibold"
                                            : "text-slate-300"
                                    }`}
                                >
                                    <span className="truncate">{name}</span>
                                    <span className="text-xs text-slate-500 font-mono ml-2 shrink-0">
                                        {code}
                                    </span>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
