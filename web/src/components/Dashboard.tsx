import { useCallback, useEffect, useState } from "react";
import {
    DollarSign,
    Eye,
    EyeOff,
    HandCoins,
    Loader2,
    LogOut,
    Percent,
    Plus,
    Wallet,
    X,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import Chart from "@/components/Chart";
import ConfirmModal from "@/components/ConfirmModal";
import CurrencySearchBox from "@/components/CurrencySearchBox";
import HoldingsTable from "@/components/HoldingsTable";
import ManageTransactionsPanel from "@/components/ManageTransactionsPanel";
import Modal from "@/components/Modal";
import PortfolioSelect from "@/components/PortfolioSelect";
import SummaryCard from "@/components/SummaryCard";
import TransactionPanel from "@/components/TransactionPanel";
import TransactionsTable from "@/components/TransactionsTable";
import { formatCurrency, localStorageGet } from "@/lib/util";
import { ChartDataPoint, PortfolioData, PortfolioRef, PortfolioSummary, Transaction, User } from "@/types";

interface DashboardProps {
    user: User;
}

type ConfirmState =
    | { type: "deleteTransaction"; txId: string }
    | { type: "clearTransactions" }
    | { type: "clearCache" }
    | { type: "deletePortfolio" }
    | null;

export default function Dashboard({ user }: DashboardProps) {
    const { logout } = useAuth();

    const [portfolios, setPortfolios] = useState<PortfolioRef[]>([]);
    const [portfolioId, setPortfolioId] = useState<string | null>(null);
    const [summary, setSummary] = useState<PortfolioSummary | null>(null);
    const [history, setHistory] = useState<ChartDataPoint[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [displayCurrency, setDisplayCurrency] = useState(
        () => localStorageGet("hold_displayCurrency") || "USD",
    );
    const [timeRange, setTimeRange] = useState(() => localStorageGet("hold_timeRange") || "30");
    const [isFetching, setIsFetching] = useState(true);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [showTransactionModal, setShowTransactionModal] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
    const [privacyMode, setPrivacyMode] = useState(
        () => localStorageGet("hold_privacyMode") === "true",
    );
    const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
    const [showManageModal, setShowManageModal] = useState(false);
    const [confirmState, setConfirmState] = useState<ConfirmState>(null);
    const [confirmLoading, setConfirmLoading] = useState(false);

    const selectPortfolioId = useCallback((id: string) => {
        setPortfolioId((prev) => {
            if (prev !== id) {
                setSelectedSymbol(null);
            }
            return id;
        });
        localStorage.setItem("hold_portfolioId", id);
    }, []);

    const showSuccess = useCallback((msg: string) => {
        setSuccessMessage(msg);
        setTimeout(() => {
            setSuccessMessage((curr) => (curr === msg ? null : curr));
        }, 3000);
    }, []);

    const privacyModeText = "••••••";
    const hideInPrivacyMode = (value: string | number): string => {
        return privacyMode ? privacyModeText : value.toString();
    };
    const formatOrHideCurrency = (value: number) => {
        return privacyMode ? privacyModeText : formatCurrency(value, displayCurrency);
    };

    const fetchPortfolioData = useCallback(() => {
        if (!portfolioId) return;
        setIsFetching(true);
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
                setErrorMessage((err as Error).message);
            })
            .finally(() => {
                setIsFetching(false);
            });
    }, [portfolioId, displayCurrency, timeRange]);

    // Load the portfolio list once, validate saved portfolioId against fetched list.
    useEffect(() => {
        fetch("/api/portfolio")
            .then(async (res) => {
                if (!res.ok) throw new Error("Failed to load portfolio");
                const data: PortfolioRef[] = await res.json();
                if (!data?.length) throw new Error("No portfolio initialized");
                setPortfolios(data);
                const savedId = localStorageGet("hold_portfolioId");
                const validId =
                    savedId && data.some((p) => p.id === savedId) ? savedId : data[0].id;
                selectPortfolioId(validId);
            })
            .catch((err) => {
                console.error(err);
                setErrorMessage((err as Error).message);
                setIsFetching(false);
            });
    }, [selectPortfolioId]);

    // Refetch data whenever the selected portfolio (or its query params) change.
    useEffect(() => {
        if (!portfolioId) return;
        const timeout = setTimeout(fetchPortfolioData, 50);
        return () => clearTimeout(timeout);
    }, [portfolioId, fetchPortfolioData]);

    const handleAddPortfolio = async (name: string) => {
        const res = await fetch("/api/portfolio", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
        });
        if (!res.ok) return setErrorMessage("Failed to create portfolio");
        const created: PortfolioRef = await res.json();
        setPortfolios((prev) => [...prev, created]);
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
            showSuccess(`Successfully imported ${result.count} transactions!`);
            fetchPortfolioData();
        } catch (err: unknown) {
            setErrorMessage((err as Error).message);
        }
    };

    const executeConfirmedAction = async () => {
        if (!confirmState) return;
        setConfirmLoading(true);
        setErrorMessage(null);

        try {
            switch (confirmState.type) {
                case "deleteTransaction": {
                    const res = await fetch(
                        `/api/portfolio/${portfolioId!}/transactions/${confirmState.txId}`,
                        { method: "DELETE" },
                    );
                    if (!res.ok) throw new Error("Failed to delete transaction");
                    fetchPortfolioData();
                    break;
                }
                case "clearTransactions": {
                    if (!portfolioId) return;
                    const res = await fetch(`/api/portfolio/${portfolioId}/transactions`, {
                        method: "DELETE",
                    });
                    if (!res.ok) throw new Error("Failed to clear transactions");
                    setShowManageModal(false);
                    setSelectedSymbol(null);
                    showSuccess("All transactions cleared successfully!");
                    fetchPortfolioData();
                    break;
                }
                case "clearCache": {
                    const res = await fetch("/api/cache", { method: "DELETE" });
                    if (!res.ok) throw new Error("Failed to clear cache");
                    setShowManageModal(false);
                    showSuccess("Cache cleared successfully!");
                    fetchPortfolioData();
                    break;
                }
                case "deletePortfolio": {
                    if (!portfolioId) return;
                    const res = await fetch(`/api/portfolio/${portfolioId}`, {
                        method: "DELETE",
                    });
                    if (!res.ok) throw new Error("Failed to delete portfolio");
                    const remaining = portfolios.filter((p) => p.id !== portfolioId);
                    setPortfolios(remaining);
                    if (remaining.length > 0) {
                        selectPortfolioId(remaining[0].id);
                    }
                    showSuccess("Portfolio deleted successfully!");
                    break;
                }
            }
        } catch (err: unknown) {
            setErrorMessage((err as Error).message);
        } finally {
            setConfirmLoading(false);
            setConfirmState(null);
        }
    };

    const confirmDialogProps = (() => {
        if (!confirmState) return null;
        switch (confirmState.type) {
            case "deleteTransaction":
                return {
                    title: "Delete Transaction",
                    message: "Are you sure you want to delete this transaction?",
                    confirmLabel: "Delete",
                };
            case "clearTransactions":
                return {
                    title: "Clear All Transactions",
                    message:
                        "Are you sure you want to clear all transactions? This action is permanent and cannot be undone.",
                    confirmLabel: "Clear All",
                };
            case "clearCache":
                return {
                    title: "Clear Cache",
                    message:
                        "Are you sure you want to clear the stock data and exchange rate caches? This action is permanent and cannot be undone.",
                    confirmLabel: "Clear Cache",
                };
            case "deletePortfolio": {
                const name = portfolios.find((p) => p.id === portfolioId)?.name ?? "this portfolio";
                return {
                    title: "Delete Portfolio",
                    message: `Are you sure you want to delete "${name}" and all of its transactions? This action cannot be undone.`,
                    confirmLabel: "Delete Portfolio",
                };
            }
        }
    })();

    const initialLoading = summary === null && isFetching;
    const refreshing = summary !== null && isFetching;
    const selectedAsset = summary?.assets.find((a) => a.symbol === selectedSymbol);

    return (
        <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
            <Header
                user={user}
                portfolios={portfolios}
                portfolioId={portfolioId}
                refreshing={refreshing}
                onSelectPortfolio={selectPortfolioId}
                onAddPortfolio={handleAddPortfolio}
                onRenamePortfolio={handleRenamePortfolio}
                onDeletePortfolio={() => setConfirmState({ type: "deletePortfolio" })}
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
                onManageTransactions={() => setShowManageModal(true)}
                onLogout={() => {
                    localStorage.removeItem("hold_portfolioId");
                    logout();
                }}
            />

            <main className="grow mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
                {errorMessage && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
                        <span>{errorMessage}</span>
                        <button
                            type="button"
                            onClick={() => setErrorMessage(null)}
                            aria-label="Dismiss error"
                            className="rounded-lg p-1 text-red-400 hover:bg-red-900/40 hover:text-red-200 transition-colors"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                )}

                {successMessage && (
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-900 bg-emerald-950/40 p-4 text-sm text-emerald-300">
                        <span>{successMessage}</span>
                        <button
                            type="button"
                            onClick={() => setSuccessMessage(null)}
                            aria-label="Dismiss message"
                            className="rounded-lg p-1 text-emerald-400 hover:bg-emerald-900/40 hover:text-emerald-200 transition-colors"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                )}

                <SummaryCards
                    loading={initialLoading}
                    summary={summary}
                    formatOrHideCurrency={formatOrHideCurrency}
                />

                <div className="grid grid-cols-1">
                    <Chart
                        data={selectedAsset?.history ?? history}
                        title={selectedSymbol ?? undefined}
                        loading={initialLoading}
                        privacyMode={privacyMode}
                        timeRange={timeRange}
                        onTimeRangeChange={(range) => {
                            setTimeRange(range);
                            localStorage.setItem("hold_timeRange", range);
                        }}
                        formatOrHideCurrency={formatOrHideCurrency}
                        onClearSymbolFilter={() => setSelectedSymbol(null)}
                    />
                </div>

                <HoldingsTable
                    summary={summary}
                    loading={initialLoading}
                    displayCurrency={displayCurrency}
                    hideInPrivacyMode={hideInPrivacyMode}
                    selectedSymbol={selectedSymbol}
                    onSelectSymbol={(symbol) =>
                        setSelectedSymbol((prev) => (prev === symbol ? null : symbol))
                    }
                />

                <TransactionsTable
                    transactions={transactions}
                    loading={initialLoading}
                    hideInPrivacyMode={hideInPrivacyMode}
                    selectedSymbol={selectedSymbol}
                    onClearSymbolFilter={() => setSelectedSymbol(null)}
                    onEdit={(tx: Transaction) => {
                        setEditingTransaction(tx);
                        setShowTransactionModal(true);
                    }}
                    onDelete={(txId: string) =>
                        setConfirmState({ type: "deleteTransaction", txId })
                    }
                />

                <Modal
                    isOpen={showManageModal}
                    onClose={() => setShowManageModal(false)}
                    title="Manage Transactions"
                    content={
                        <ManageTransactionsPanel
                            onAddTransaction={() => {
                                setShowManageModal(false);
                                setEditingTransaction(null);
                                setShowTransactionModal(true);
                            }}
                            onExportCSV={handleExportCSV}
                            onImportCSV={handleImportCSV}
                            onClearTransactions={() =>
                                setConfirmState({ type: "clearTransactions" })
                            }
                            onClearCache={() => setConfirmState({ type: "clearCache" })}
                        />
                    }
                />

                <Modal
                    isOpen={showTransactionModal}
                    onClose={() => {
                        setShowTransactionModal(false);
                        setEditingTransaction(null);
                    }}
                    title={editingTransaction ? "Edit Transaction" : "Add Transaction"}
                    content={
                        <TransactionPanel
                            portfolioId={portfolioId || ""}
                            editingTransaction={editingTransaction}
                            onSuccess={() => {
                                setShowTransactionModal(false);
                                setEditingTransaction(null);
                                fetchPortfolioData();
                            }}
                        />
                    }
                />

                <ConfirmModal
                    isOpen={confirmState !== null}
                    title={confirmDialogProps?.title ?? ""}
                    message={confirmDialogProps?.message ?? ""}
                    confirmLabel={confirmDialogProps?.confirmLabel ?? "Confirm"}
                    loading={confirmLoading}
                    onConfirm={executeConfirmedAction}
                    onCancel={() => {
                        if (!confirmLoading) setConfirmState(null);
                    }}
                />
            </main>
        </div>
    );
}

interface HeaderProps {
    user: User;
    portfolios: PortfolioRef[];
    portfolioId: string | null;
    refreshing: boolean;
    onSelectPortfolio: (id: string) => void;
    onAddPortfolio: (name: string) => void;
    onRenamePortfolio: (name: string) => void;
    onDeletePortfolio: () => void;
    displayCurrency: string;
    onDisplayCurrencyChange: (currency: string) => void;
    privacyMode: boolean;
    onTogglePrivacy: () => void;
    onManageTransactions: () => void;
    onLogout: () => void;
}

function Header({
    user,
    portfolios,
    portfolioId,
    refreshing,
    onSelectPortfolio,
    onAddPortfolio,
    onRenamePortfolio,
    onDeletePortfolio,
    displayCurrency,
    onDisplayCurrencyChange,
    privacyMode,
    onTogglePrivacy,
    onManageTransactions,
    onLogout,
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
                        <div className="text-left hidden sm:block p-2">
                            <p className="text-sm font-semibold text-slate-200">{user.name}</p>
                            <p className="text-xs text-slate-400">{user.email}</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-1">
                        {refreshing && (
                            <Loader2
                                className="h-4 w-4 animate-spin text-sky-400 mr-1"
                                aria-label="Refreshing portfolio"
                            />
                        )}

                        <PortfolioSelect
                            portfolios={portfolios}
                            portfolioId={portfolioId}
                            onSelect={onSelectPortfolio}
                            onCreate={onAddPortfolio}
                            onRename={onRenamePortfolio}
                            onDelete={onDeletePortfolio}
                        />

                        <CurrencySearchBox
                            value={displayCurrency}
                            onChange={onDisplayCurrencyChange}
                        />

                        <button
                            type="button"
                            onClick={onManageTransactions}
                            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-all"
                            title="Manage Transactions"
                        >
                            <Plus className="h-5 w-5" />
                        </button>
                        <button
                            type="button"
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
                        <button
                            type="button"
                            onClick={onLogout}
                            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition-all"
                            title="Logout"
                        >
                            <LogOut className="h-5 w-5" />
                        </button>
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
                            content={
                                <p className="text-3xl font-bold tracking-tight text-white">
                                    {formatOrHideCurrency(summary.totalCost)}
                                </p>
                            }
                            icon={
                                <div className="rounded-xl p-3 bg-indigo-950/40 text-indigo-400 border border-indigo-900/30">
                                    <Wallet className="h-6 w-6" />
                                </div>
                            }
                        />

                        <SummaryCard
                            title="Current Valuation"
                            content={
                                <p className="text-3xl font-bold tracking-tight text-white">
                                    {formatOrHideCurrency(summary.totalValue)}
                                </p>
                            }
                            icon={
                                <div className="rounded-xl p-3 bg-sky-950/40 text-sky-400 border border-sky-900/30">
                                    <DollarSign className="h-6 w-6" />
                                </div>
                            }
                        />

                        <SummaryCard
                            title="Realized Profit"
                            content={
                                <p className="text-3xl font-bold tracking-tight text-white">
                                    {formatOrHideCurrency(summary.totalRealized)}
                                </p>
                            }
                            icon={
                                <div className="rounded-xl p-3 bg-teal-950/40 text-teal-400 border border-teal-900/30">
                                    <HandCoins className="h-6 w-6" />
                                </div>
                            }
                        />

                        <SummaryCard
                            title="Total Profit / Loss"
                            content={
                                <>
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
                            }
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
