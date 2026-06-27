"use client";

import CurrencySearchBox from "@/components/CurrencySearchBox";
import PortfolioSelect from "@/components/PortfolioSelect";
import TransactionModal from "@/components/TransactionModal";
import Chart from "@/components/Chart";
import HoldingsTable from "@/components/HoldingsTable";
import TransactionsTable from "@/components/TransactionsTable";
import {
    DollarSign,
    Download,
    Eye,
    EyeOff,
    HandCoins,
    Loader2,
    LogOut,
    Plus,
    Trash,
    Percent,
    Upload,
    Wallet,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChartDataPoint, PortfolioData, PortfolioSummary } from "@/lib/portfolio";
import { Transaction } from "@prisma/client";
import SummaryCard from "@/components/SummaryCard";
import { User } from "next-auth";
import { formatCurrency, localStorageGet } from "./util";

interface DashboardProps {
    user: User;
}

type PortfolioRef = { id: string; name: string };

export default function Dashboard({ user }: DashboardProps) {
    // State

    const [portfolios, setPortfolios] = useState<PortfolioRef[]>([]);
    const [portfolioId, setPortfolioId] = useState<string | null>(
        localStorageGet("hold_portfolioId") || null,
    );
    const [summary, setSummary] = useState<PortfolioSummary | null>(null);
    const [history, setHistory] = useState<ChartDataPoint[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [displayCurrency, setDisplayCurrency] = useState(
        () => localStorageGet("hold_displayCurrency") || "USD",
    );
    const [timeRange, setTimeRange] = useState(() => localStorageGet("hold_timeRange") || "30");
    const [loading, setLoading] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [showTransactionModal, setShowTransactionModal] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
    const [privacyMode, setPrivacyMode] = useState(
        () => localStorageGet("hold_privacyMode") === "true",
    );
    const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);

    const selectPortfolioId = (id: string) => {
        setPortfolioId(id);
        localStorage.setItem("hold_portfolioId", id);
    };
    const privacyModeText = "••••••";
    const hideInPrivacyMode = (value: string | number): string => {
        return privacyMode ? privacyModeText : value.toString();
    };
    const formatOrHideCurrency = (value: number) => {
        return privacyMode ? privacyModeText : formatCurrency(value, displayCurrency);
    };

    // Data fetching

    const fetchPortfolioData = useCallback(() => {
        if (portfolioId) {
            setLoading(true);
            setErrorMessage(null);

            const url = `/api/portfolio/${portfolioId}/data?currency=${displayCurrency}&days=${timeRange}`;
            fetch(url, { cache: "no-store" })
                .then(async (res) => {
                    if (!res.ok) throw new Error("Failed to fetch portfolio data");
                    const pd: PortfolioData = await res.json();
                    setSummary(pd.summary);
                    setHistory(pd.history);
                    setTransactions(pd.transactions);
                })
                .catch((err) => {
                    setErrorMessage(err.message);
                })
                .finally(() => {
                    setLoading(false);
                });
        }
    }, [portfolioId, displayCurrency, timeRange]);

    // Load the portfolio list once, then open the saved one (or the first).
    useEffect(() => {
        fetch("/api/portfolio")
            .then(async (res) => {
                if (!res.ok) throw new Error("Failed to load portfolio");
                const data: PortfolioRef[] = await res.json();
                if (!data?.length) throw new Error("No portfolio initialized");
                setPortfolios(data);
                selectPortfolioId(localStorage.getItem("hold_portfolioId") || data[0].id);
            })
            .catch((err) => {
                console.error(err);
                setErrorMessage(err.message);
            });
    }, []);

    // Refetch data whenever the selected portfolio (or its query params) change.
    useEffect(() => {
        const timeout = setTimeout(fetchPortfolioData, 50);
        return () => clearTimeout(timeout);
    }, [fetchPortfolioData]);

    const handleAddPortfolio = async (name: string) => {
        const res = await fetch("/api/portfolio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
        if (!res.ok) return setErrorMessage("Failed to create portfolio");
        const created: PortfolioRef = await res.json();
        setPortfolios((prev) => [created, ...prev]);
        selectPortfolioId(created.id);
    };

    const handleRenamePortfolio = async (name: string) => {
        if (!portfolioId) return;
        const res = await fetch(`/api/portfolio/${portfolioId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
        if (!res.ok) return setErrorMessage("Failed to rename portfolio");
        setPortfolios((prev) => prev.map((p) => (p.id === portfolioId ? { ...p, name } : p)));
        selectPortfolioId(portfolioId);
    };

    // Handlers

    const handleDeleteTransaction = async (txId: string) => {
        const confirmDelete = window.confirm("Are you sure you want to delete this transaction?");
        if (!confirmDelete) return;

        setErrorMessage(null);
        try {
            const res = await fetch(`/api/portfolio/${portfolioId!}/transactions/${txId}`, {
                method: "DELETE",
            });
            if (!res.ok) throw new Error("Failed to delete transaction");

            fetchPortfolioData();
        } catch (err: unknown) {
            setErrorMessage((err as Error).message);
        }
    };

    const handleExportCSV = () => {
        if (!portfolioId) return;
        window.open(`/api/portfolio/${portfolioId}/export`, "_blank");
    };

    const handleImportCSV = async (file: File | undefined) => {
        if (!file || !portfolioId) return;

        setErrorMessage(null);

        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch(`/api/portfolio/${portfolioId}/import`, {
                method: "POST",
                body: formData,
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Failed to import CSV");
            }

            const result = await res.json();
            setSuccessMessage(`Successfully imported ${result.count} transactions!`);
            setTimeout(() => {
                setSuccessMessage(null);
            }, 3000);
            fetchPortfolioData();
        } catch (err: unknown) {
            setErrorMessage((err as Error).message);
        }
    };

    const handleClearTransactions = async () => {
        if (!portfolioId) return;
        const confirmClear = window.confirm(
            "Are you sure you want to clear all transactions? This action is permanent and cannot be undone.",
        );
        if (!confirmClear) return;

        setErrorMessage(null);
        try {
            const res = await fetch(`/api/portfolio/${portfolioId}/transactions`, {
                method: "DELETE",
            });
            if (!res.ok) throw new Error("Failed to clear transactions");

            setSuccessMessage("All transactions cleared successfully!");
            setTimeout(() => {
                setSuccessMessage(null);
            }, 3000);
            fetchPortfolioData();
        } catch (err: unknown) {
            setErrorMessage((err as Error).message);
        }
    };

    // UI

    const selectedAsset = summary?.assets.find((a) => a.symbol === selectedSymbol);

    return (
        <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
            <Header
                user={user}
                portfolios={portfolios}
                portfolioId={portfolioId}
                onSelectPortfolio={selectPortfolioId}
                onAddPortfolio={handleAddPortfolio}
                onRenamePortfolio={handleRenamePortfolio}
                displayCurrency={displayCurrency}
                onDisplayCurrencyChange={(val) => {
                    setDisplayCurrency(val);
                    localStorage.setItem("hold_displayCurrency", val);
                }}
                privacyMode={privacyMode}
                onTogglePrivacy={() => {
                    const newPrivacyMode = !privacyMode;
                    setPrivacyMode(newPrivacyMode);
                    localStorage.setItem("hold_privacyMode", String(newPrivacyMode));
                }}
            />

            <main className="grow mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
                {errorMessage && (
                    <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
                        {errorMessage}
                    </div>
                )}

                {successMessage && (
                    <div className="rounded-xl border border-emerald-900 bg-emerald-950/40 p-4 text-sm text-emerald-300">
                        {successMessage}
                    </div>
                )}

                <SummaryCards
                    loading={loading}
                    summary={summary}
                    formatOrHideCurrency={formatOrHideCurrency}
                />

                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    <Chart
                        data={selectedAsset?.history ?? history}
                        title={selectedSymbol ?? undefined}
                        loading={loading}
                        privacyMode={privacyMode}
                        timeRange={timeRange}
                        onTimeRangeChange={(range) => {
                            setTimeRange(range);
                            localStorage.setItem("portfolio_timeRange", range);
                        }}
                        formatOrHideCurrency={formatOrHideCurrency}
                    />

                    <QuickActionsPanel
                        onAddTransaction={() => {
                            setEditingTransaction(null);
                            setShowTransactionModal(true);
                        }}
                        onExportCSV={handleExportCSV}
                        onImportCSV={handleImportCSV}
                        onClearTransactions={handleClearTransactions}
                    />
                </div>

                <HoldingsTable
                    summary={summary}
                    loading={loading}
                    displayCurrency={displayCurrency}
                    hideInPrivacyMode={hideInPrivacyMode}
                    selectedSymbol={selectedSymbol}
                    onSelectSymbol={(symbol) =>
                        setSelectedSymbol((prev) => (prev === symbol ? null : symbol))
                    }
                />

                <TransactionsTable
                    transactions={transactions}
                    loading={loading}
                    hideInPrivacyMode={hideInPrivacyMode}
                    onEdit={(tx: Transaction) => {
                        setEditingTransaction(tx);
                        setShowTransactionModal(true);
                    }}
                    onDelete={handleDeleteTransaction}
                />

                <TransactionModal
                    isOpen={showTransactionModal}
                    onClose={() => {
                        setShowTransactionModal(false);
                        setEditingTransaction(null);
                    }}
                    portfolioId={portfolioId || ""}
                    editingTransaction={editingTransaction}
                    onSuccess={fetchPortfolioData}
                />
            </main>
        </div>
    );
}

interface HeaderProps {
    user: User;
    portfolios: PortfolioRef[];
    portfolioId: string | null;
    onSelectPortfolio: (id: string) => void;
    onAddPortfolio: (name: string) => void;
    onRenamePortfolio: (name: string) => void;
    displayCurrency: string;
    onDisplayCurrencyChange: (currency: string) => void;
    privacyMode: boolean;
    onTogglePrivacy: () => void;
}

function Header({
    user,
    portfolios,
    portfolioId,
    onSelectPortfolio,
    onAddPortfolio,
    onRenamePortfolio,
    displayCurrency,
    onDisplayCurrencyChange,
    privacyMode,
    onTogglePrivacy,
}: HeaderProps) {
    return (
        <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
                <div className="flex h-16 items-center justify-between">
                    <div className="flex items-center gap-2">
                        <picture>
                            <img
                                src="/icon.png"
                                alt="Hold Logo"
                                className="h-7 w-7 rounded-lg shadow-md border border-slate-800"
                            />
                        </picture>
                        <span className="text-xl font-bold bg-linear-to-r from-sky-400 to-blue-500 bg-clip-text text-transparent">
                            Hold
                        </span>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="ml-2">
                            <PortfolioSelect
                                portfolios={portfolios}
                                portfolioId={portfolioId}
                                onSelect={onSelectPortfolio}
                                onCreate={onAddPortfolio}
                                onRename={onRenamePortfolio}
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <CurrencySearchBox
                                value={displayCurrency}
                                onChange={onDisplayCurrencyChange}
                            />
                        </div>

                        <div className="h-6 w-px bg-slate-800"></div>

                        <div className="flex items-center gap-3">
                            <button
                                onClick={onTogglePrivacy}
                                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-all"
                                title={privacyMode ? "Show Balances" : "Hide Balances"}
                            >
                                {privacyMode ? (
                                    <EyeOff className="h-5 w-5" />
                                ) : (
                                    <Eye className="h-5 w-5" />
                                )}
                            </button>
                            <div className="text-right hidden sm:block">
                                <p className="text-sm font-semibold text-slate-200">{user.name}</p>
                                <p className="text-xs text-slate-400">{user.email}</p>
                            </div>
                            <button
                                onClick={() => signOut()}
                                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-all"
                                title="Logout"
                            >
                                <LogOut className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </header>
    );
}

interface SummaryCardsProps {
    loading: boolean;
    summary: PortfolioSummary | null;
    formatOrHideCurrency: (value: number) => string;
}

function SummaryCards({ loading, summary, formatOrHideCurrency }: SummaryCardsProps) {
    const hasProfit = (summary?.totalProfit || 0) >= 0;
    const TotalProfitColor = hasProfit ? "text-emerald-400" : "text-rose-400";
    const totalProfitIconColor = hasProfit
        ? "bg-emerald-950/40 text-emerald-400 border border-emerald-900/30"
        : "bg-rose-950/40 text-rose-400 border border-rose-900/30";
    return (
        <>
            {loading ? (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-4">
                    {[...Array(4)].map((_, i) => (
                        <div
                            key={i}
                            className="h-32 animate-pulse rounded-2xl bg-slate-900 border border-slate-800"
                        ></div>
                    ))}
                </div>
            ) : (
                summary && (
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-4">
                        <SummaryCard
                            title="Invested Capital (Cost)"
                            content=<p className="text-3xl font-bold tracking-tight text-white">
                                {formatOrHideCurrency(summary.totalCost)}
                            </p>
                            icon=<div className="rounded-xl p-3 bg-indigo-950/40 text-indigo-400 border border-indigo-900/30">
                                <Wallet className="h-6 w-6" />
                            </div>
                        />

                        <SummaryCard
                            title="Current Valuation"
                            content=<p className="text-3xl font-bold tracking-tight text-white">
                                {formatOrHideCurrency(summary.totalValue)}
                            </p>
                            icon=<div className="rounded-xl p-3 bg-sky-950/40 text-sky-400 border border-sky-900/30">
                                <DollarSign className="h-6 w-6" />
                            </div>
                        />

                        <SummaryCard
                            title="Realized Profit"
                            content=<p className="text-3xl font-bold tracking-tight text-white">
                                {formatOrHideCurrency(summary.totalRealized)}
                            </p>
                            icon=<div className="rounded-xl p-3 bg-teal-950/40 text-teal-400 border border-teal-900/30">
                                <HandCoins className="h-6 w-6" />
                            </div>
                        />

                        <SummaryCard
                            title="Total Profit / Loss"
                            content=<>
                                <p
                                    className={`text-3xl font-bold tracking-tight ${TotalProfitColor}`}
                                >
                                    {formatOrHideCurrency(summary.totalProfit)}
                                </p>
                                <span
                                    className={`text-sm font-semibold flex items-center gap-0.5 ${TotalProfitColor}`}
                                >
                                    {summary.totalProfitPercentage.toFixed(2)}%
                                </span>
                            </>
                            icon={
                                <div className={`rounded-xl p-3 ${totalProfitIconColor}`}>
                                    <Percent className="h-6 w-6" />
                                </div>
                            }
                        />
                    </div>
                )
            )}
        </>
    );
}

interface QuickActionsPanelProps {
    onAddTransaction: () => void;
    onExportCSV: () => void;
    onImportCSV: (file: File | undefined) => void;
    onClearTransactions: () => void;
}

function QuickActionsPanel({
    onAddTransaction,
    onExportCSV,
    onImportCSV,
    onClearTransactions,
}: QuickActionsPanelProps) {
    const [isImporting, setIsImporting] = useState(false);
    const [isClearing, setIsClearing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    return (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-md flex flex-col space-y-6">
            <h3 className="text-lg font-bold text-slate-100">Manage Activities</h3>

            <div className="flex flex-col gap-3">
                <button
                    type="button"
                    onClick={onAddTransaction}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 transition-all shadow-md shadow-sky-900/20"
                >
                    <Plus className="h-4 w-4" /> Add Transaction
                </button>

                <button
                    onClick={onExportCSV}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800 hover:text-white transition-all"
                >
                    <Download className="h-4 w-4" /> Export Transactions
                </button>

                <label className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800 hover:text-white transition-all cursor-pointer">
                    {isImporting ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> Importing...
                        </>
                    ) : (
                        <>
                            <Upload className="h-4 w-4" /> Import Transactions
                        </>
                    )}
                    <input
                        type="file"
                        accept=".csv"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={async (e) => {
                            setIsImporting(true);
                            await onImportCSV(e?.target?.files?.[0]);
                            setIsImporting(false);
                            if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                        disabled={isImporting}
                    />
                </label>

                <button
                    type="button"
                    onClick={async () => {
                        setIsClearing(true);
                        await onClearTransactions();
                        setIsClearing(false);
                    }}
                    disabled={isClearing}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-900 bg-rose-950/25 px-4 py-3 text-sm font-semibold text-rose-400 hover:bg-rose-950/50 transition-all disabled:opacity-50"
                >
                    {isClearing ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" /> Clearing...
                        </>
                    ) : (
                        <>
                            <Trash className="h-4 w-4" /> Clear All Transactions
                        </>
                    )}
                </button>
            </div>

            <div className="rounded-xl bg-slate-950 p-4 border border-slate-900">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    CSV fields
                </h4>
                <ul className="text-xs text-slate-400 leading-normal">
                    <li>
                        • <code className="font-bold">symbol</code>
                    </li>
                    <li>
                        • <code className="font-bold">type</code> (BUY/SELL)
                    </li>
                    <li>
                        • <code className="font-bold">quantity</code>
                    </li>
                    <li>
                        • <code className="font-bold">pricePerShare</code>
                    </li>
                    <li>
                        • <code className="font-bold italic">currency</code> (optional)
                    </li>
                    <li>
                        • <code className="font-bold italic">transactionDate</code> (optional)
                    </li>
                </ul>
            </div>
        </div>
    );
}
