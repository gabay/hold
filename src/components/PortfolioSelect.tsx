"use client";

import React, { useState, useEffect, useRef } from "react";
import { ChevronDown, Check, Pencil, Plus, X } from "lucide-react";

interface PortfolioRef {
    id: string;
    name: string;
}

interface PortfolioSelectProps {
    portfolios: PortfolioRef[];
    portfolioId: string | null;
    onSelect: (_id: string) => void;
    onCreate: (_name: string) => void;
    onRename: (_name: string) => void;
}

export default function PortfolioSelect({
    portfolios,
    portfolioId,
    onSelect,
    onCreate,
    onRename,
}: PortfolioSelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [mode, setMode] = useState<"list" | "create" | "rename">("list");
    const [name, setName] = useState("");
    const containerRef = useRef<HTMLDivElement>(null);

    const current = portfolios.find((p) => p.id === portfolioId);

    const reset = () => {
        setIsOpen(false);
        setMode("list");
        setName("");
    };

    // Close dropdown on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                reset();
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const submit = () => {
        const trimmed = name.trim();
        if (!trimmed) return;
        if (mode === "create") onCreate(trimmed);
        else if (mode === "rename" && trimmed !== current?.name) onRename(trimmed);
        reset();
    };

    return (
        <div className="relative inline-block text-left" ref={containerRef}>
            <button
                type="button"
                onClick={() => (isOpen ? reset() : setIsOpen(true))}
                className="inline-flex w-full justify-between items-center gap-x-1.5 rounded-lg border border-slate-800 bg-slate-950 text-slate-100 px-3 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500 shadow-sm"
                aria-expanded={isOpen}
                aria-haspopup="true"
            >
                <span className="truncate max-w-40">{current?.name ?? "Portfolio"}</span>
                <ChevronDown className="-mr-1 h-4 w-4 text-slate-400" aria-hidden="true" />
            </button>

            {isOpen && (
                <div className="absolute right-0 z-50 mt-2 w-60 origin-top-right rounded-lg bg-slate-950 shadow-xl ring-1 ring-black ring-opacity-5 focus:outline-none flex flex-col">
                    {mode === "list" ? (
                        <>
                            <div className="overflow-y-auto py-1 max-h-64">
                                {portfolios.map((p) => (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => {
                                            onSelect(p.id);
                                            reset();
                                        }}
                                        className={`w-full text-left px-4 py-2 text-sm flex justify-between items-center hover:bg-slate-900 transition-colors ${
                                            p.id === portfolioId
                                                ? "bg-slate-900 text-sky-400 font-semibold"
                                                : "text-slate-300"
                                        }`}
                                    >
                                        <span className="truncate">{p.name}</span>
                                        {p.id === portfolioId && (
                                            <Check className="h-4 w-4 shrink-0 ml-2" />
                                        )}
                                    </button>
                                ))}
                            </div>
                            <div className="border-t border-slate-900 py-1">
                                <button
                                    type="button"
                                    disabled={!current}
                                    onClick={() => {
                                        setName(current?.name ?? "");
                                        setMode("rename");
                                    }}
                                    className="w-full text-left px-4 py-2 text-sm flex items-center gap-2 text-slate-300 hover:bg-slate-900 transition-colors disabled:opacity-40"
                                >
                                    <Pencil className="h-4 w-4" />
                                    Rename portfolio
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setName("");
                                        setMode("create");
                                    }}
                                    className="w-full text-left px-4 py-2 text-sm flex items-center gap-2 text-slate-300 hover:bg-slate-900 transition-colors"
                                >
                                    <Plus className="h-4 w-4" />
                                    New portfolio
                                </button>
                            </div>
                        </>
                    ) : (
                        <div className="p-3 flex flex-col gap-2">
                            <span className="text-xs font-medium text-slate-400">
                                {mode === "create" ? "New portfolio name" : "Rename portfolio"}
                            </span>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") submit();
                                    if (e.key === "Escape") reset();
                                }}
                                placeholder="Portfolio name"
                                className="w-full px-3 py-1.5 text-sm bg-slate-900 border border-slate-800 rounded-md text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                                autoFocus
                            />
                            <div className="flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setMode("list")}
                                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-900 hover:text-white transition-colors"
                                    title="Cancel"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={submit}
                                    disabled={!name.trim()}
                                    className="rounded-md p-1.5 text-sky-400 hover:bg-slate-900 transition-colors disabled:opacity-40"
                                    title="Save"
                                >
                                    <Check className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
