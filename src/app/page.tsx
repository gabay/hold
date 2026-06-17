"use client";

import CurrencySearchBox from "@/components/CurrencySearchBox";
import TransactionModal from "@/components/TransactionModal";
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
    TrendingDown,
    TrendingUp,
    Upload,
    Wallet,
} from "lucide-react";
import { signOut, useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
    Brush,
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";

import { ChartDataPoint, PortfolioData, PortfolioSummary } from "@/lib/portfolio";
import { Transaction } from "@prisma/client";
import { Provider } from "next-auth/providers";
import SummaryCard from "@/components/SummaryCard";
import Login from "@/components/Login";
import { getDateString } from "@/lib/util";

function localStorageGet(key: string): string | null {
    if (typeof localStorage !== "undefined") {
        return localStorage.getItem(key);
    }
    return null;
}

export default function Dashboard() {
    const { data: session, status } = useSession();

    const [portfolio, setPortfolio] = useState<{ id: string; name: string } | null>(null);
    const [summary, setSummary] = useState<PortfolioSummary | null>(null);
    const [history, setHistory] = useState<ChartDataPoint[]>([]);
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [displayCurrency, setDisplayCurrency] = useState(
        () => localStorageGet("portfolio_displayCurrency") || "USD",
    );
    const [timeRange, setTimeRange] = useState(
        () => localStorageGet("portfolio_timeRange") || "30",
    ); // "30" | "ytd" | "365" | "1825" | "max"
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [activeProviders, setActiveProviders] = useState<Record<string, Provider> | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [privacyMode, setPrivacyMode] = useState(
        () => localStorageGet("portfolio_privacyMode") === "true",
    );
    const privacyModeText = "••••••";
    const hideInPrivacyMode = (value: string | number): string => {
        return privacyMode ? privacyModeText : value.toString();
    };

    useEffect(() => {
        // Authenticated - load portfolios
        if (status === "authenticated") {
            fetch("/api/portfolio")
                .then((res) => {
                    if (!res.ok) throw new Error("Failed to load portfolio");
                    return res.json();
                })
                .then((data) => {
                    if (data && data.length > 0) {
                        setPortfolio(data[0]);
                    } else {
                        throw new Error("No portfolio initialized");
                    }
                })
                .catch((err) => {
                    console.error(err);
                    setError(err.message);
                });
        }

        // Unauthenticated - load active providers
        if (status === "unauthenticated") {
            fetch("/api/auth/providers")
                .then((res) => {
                    if (!res.ok) throw new Error("Failed to load providers");
                    return res.json();
                })
                .then((data) => {
                    setActiveProviders(data);
                })
                .catch((err) => {
                    console.error("Error loading auth providers:", err);
                });
        }
    }, [status]);

    const togglePrivacy = () => {
        const newMode = !privacyMode;
        setPrivacyMode(newMode);
        localStorage.setItem("portfolio_privacyMode", String(newMode));
    };

    // Transaction Form state
    const [showAddForm, setShowAddForm] = useState(false);
    const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);

    // Import CSV state
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [importing, setImporting] = useState(false);

    const fetchPortfolioData = useCallback(() => {
        if (portfolio?.id) {
            setLoading(true);
            setError(null);

            fetch(
                `/api/portfolio/${portfolio.id}/data?currency=${displayCurrency}&days=${timeRange}`,
                {
                    cache: "no-store",
                },
            )
                .then((res) => {
                    if (!res.ok) throw new Error("Failed to fetch portfolio data");
                    return res.json();
                })
                .then((pd: PortfolioData) => {
                    setSummary(pd.summary);
                    setHistory(pd.history);
                    setTransactions(pd.transactions);
                })
                .catch((err) => {
                    setError(err.message);
                })
                .finally(() => {
                    setLoading(false);
                });
        }
    }, [portfolio, displayCurrency, timeRange]);

    useEffect(() => {
        const timeout = setTimeout(fetchPortfolioData, 0);
        return () => clearTimeout(timeout);
    }, [fetchPortfolioData]);

    const startEditTransaction = (tx: Transaction) => {
        setEditingTransaction(tx);
        setShowAddForm(true);
    };

    const handleDeleteTransaction = async (txId: string) => {
        const confirmDelete = window.confirm("Are you sure you want to delete this transaction?");
        if (!confirmDelete) return;

        setError(null);
        try {
            const res = await fetch(`/api/portfolio/${portfolio?.id}/transactions/${txId}`, {
                method: "DELETE",
            });
            if (!res.ok) throw new Error("Failed to delete transaction");

            fetchPortfolioData();
        } catch (err: unknown) {
            setError((err as Error).message);
        }
    };

    const handleExportCSV = () => {
        if (!portfolio?.id) return;
        window.open(`/api/portfolio/${portfolio.id}/export`, "_blank");
    };

    const handleImportCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!portfolio?.id || !e.target.files || e.target.files.length === 0) return;

        const file = e.target.files[0];
        setImporting(true);
        setError(null);

        const formData = new FormData();
        formData.append("file", file);

        try {
            const res = await fetch(`/api/portfolio/${portfolio.id}/import`, {
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
            setError((err as Error).message);
        } finally {
            setImporting(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    const [clearing, setClearing] = useState(false);
    const handleClearTransactions = async () => {
        if (!portfolio?.id) return;
        const confirmClear = window.confirm(
            "Are you sure you want to clear all transactions? This action is permanent and cannot be undone.",
        );
        if (!confirmClear) return;

        setClearing(true);
        setError(null);
        try {
            const res = await fetch(`/api/portfolio/${portfolio.id}/transactions`, {
                method: "DELETE",
            });
            if (!res.ok) throw new Error("Failed to clear transactions");

            setSuccessMessage("All transactions cleared successfully!");
            setTimeout(() => {
                setSuccessMessage(null);
            }, 3000);
            fetchPortfolioData();
        } catch (err: unknown) {
            setError((err as Error).message);
        } finally {
            setClearing(false);
        }
    };

    // Format currency helpers
    const formatCurrency = (val: number, currency: string) => {
        try {
            return new Intl.NumberFormat("en-US", {
                style: "currency",
                currency: currency,
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            }).format(val);
        } catch (e) {
            console.error(`Error in formatCurrency(${val}, ${currency}):`, e);
            return `${currency} ${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
    };

    const formatDisplayCurrency = (val: number) => formatCurrency(val, displayCurrency);

    const chartData =
        history?.map((d) => ({
            ...d,
            percentReturn:
                d.invested > 0 ? ((d.valuation + d.realized - d.invested) / d.invested) * 100 : 0,
        })) || [];

    if (status === "loading") {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-slate-950">
                <Loader2 className="h-8 w-8 animate-spin text-sky-400" />
            </div>
        );
    }

    // Not logged in -> Show login UI
    if (status === "unauthenticated" || !session) {
        return <Login providers={activeProviders || {}} />;
    }

    return (
        <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
            {/* Header navbar */}
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
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-slate-400">
                                    Currency:
                                </span>
                                <CurrencySearchBox
                                    value={displayCurrency}
                                    onChange={(val) => {
                                        setDisplayCurrency(val);
                                        localStorage.setItem("portfolio_displayCurrency", val);
                                    }}
                                />
                            </div>

                            <div className="h-6 w-px bg-slate-800"></div>

                            <div className="flex items-center gap-3">
                                <button
                                    onClick={togglePrivacy}
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
                                    <p className="text-sm font-semibold text-slate-200">
                                        {session.user?.name}
                                    </p>
                                    <p className="text-xs text-slate-400">{session.user?.email}</p>
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

            {/* Main dashboard content */}
            <main className="grow mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
                {error && (
                    <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
                        {error}
                    </div>
                )}

                {successMessage && (
                    <div className="rounded-xl border border-emerald-900 bg-emerald-950/40 p-4 text-sm text-emerald-300">
                        {successMessage}
                    </div>
                )}

                {/* Dashboard Overview Cards */}
                {loading ? (
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-4">
                        {[...Array(4)].map((_, i) => (
                            <div
                                key={i}
                                className="h-32 animate-pulse rounded-2xl bg-slate-900 border border-slate-850"
                            ></div>
                        ))}
                    </div>
                ) : (
                    summary && (
                        <div className="grid grid-cols-1 gap-5 sm:grid-cols-4">
                            {/* Card 1: Invested Capital */}
                            <SummaryCard
                                title="Invested Capital (Cost)"
                                content=<p className="text-3xl font-bold tracking-tight text-white">
                                    {hideInPrivacyMode(formatDisplayCurrency(summary.totalCost))}
                                </p>
                                icon=<div className="rounded-xl p-3 bg-indigo-950/40 text-indigo-400 border border-indigo-900/30">
                                    <Wallet className="h-6 w-6" />
                                </div>
                            />

                            {/* Card 2: Current Valuation */}
                            <SummaryCard
                                title="Current Valuation"
                                content=<p className="text-3xl font-bold tracking-tight text-white">
                                    {hideInPrivacyMode(formatDisplayCurrency(summary.totalValue))}
                                </p>
                                icon=<div className="rounded-xl p-3 bg-sky-950/40 text-sky-400 border border-sky-900/30">
                                    <DollarSign className="h-6 w-6" />
                                </div>
                            />

                            {/* Card 3: Realized Profit */}
                            <SummaryCard
                                title="Realized Profit"
                                content=<p className="text-3xl font-bold tracking-tight text-white">
                                    {hideInPrivacyMode(
                                        formatDisplayCurrency(summary.totalRealized),
                                    )}
                                </p>
                                icon=<div className="rounded-xl p-3 bg-teal-950/40 text-teal-400 border border-teal-900/30">
                                    <HandCoins className="h-6 w-6" />
                                </div>
                            />

                            {/* Card 4: Total Profit/Loss */}
                            <SummaryCard
                                title="Total Profit / Loss"
                                content=<>
                                    <p
                                        className={`text-3xl font-bold tracking-tight ${summary.totalProfit >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                                    >
                                        {hideInPrivacyMode(formatDisplayCurrency(summary.totalProfit))}
                                    </p>
                                    <span
                                        className={`text-sm font-semibold flex items-center gap-0.5 ${summary.totalProfit >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                                    >
                                        {summary.totalProfitPercentage.toFixed(2)}%
                                    </span>
                                </>
                                icon={
                                    summary.totalProfit >= 0 ? (
                                        <div className="rounded-xl p-3 bg-emerald-950/40 text-emerald-400 border border-emerald-900/30">
                                            <TrendingUp className="h-6 w-6" />
                                        </div>
                                    ) : (
                                        <div className="rounded-xl p-3 bg-rose-950/40 text-rose-400 border border-rose-900/30">
                                            <TrendingDown className="h-6 w-6" />
                                        </div>
                                    )
                                }
                            />
                        </div>
                    )
                )}

                {/* Charts & Actions Section */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
                    {/* Performance line chart */}
                    <div className="lg:col-span-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-md flex flex-col justify-between min-h-100 max-h-fit">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                            <h3 className="text-lg font-bold text-slate-100">Valuation History</h3>
                            <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setTimeRange("30");
                                        localStorage.setItem("portfolio_timeRange", "30");
                                    }}
                                    className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${timeRange === "30" ? "bg-sky-600 text-white" : "text-slate-400 hover:text-white"}`}
                                >
                                    1M
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setTimeRange("ytd");
                                        localStorage.setItem("portfolio_timeRange", "ytd");
                                    }}
                                    className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${timeRange === "ytd" ? "bg-sky-600 text-white" : "text-slate-400 hover:text-white"}`}
                                >
                                    YTD
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setTimeRange("365");
                                        localStorage.setItem("portfolio_timeRange", "365");
                                    }}
                                    className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${timeRange === "365" ? "bg-sky-600 text-white" : "text-slate-400 hover:text-white"}`}
                                >
                                    1Y
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setTimeRange("1825");
                                        localStorage.setItem("portfolio_timeRange", "1825");
                                    }}
                                    className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${timeRange === "1825" ? "bg-sky-600 text-white" : "text-slate-400 hover:text-white"}`}
                                >
                                    5Y
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setTimeRange("max");
                                        localStorage.setItem("portfolio_timeRange", "max");
                                    }}
                                    className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${timeRange === "max" ? "bg-sky-600 text-white" : "text-slate-400 hover:text-white"}`}
                                >
                                    MAX
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 w-full h-full">
                            {loading ? (
                                <div className="h-full w-full flex items-center justify-center">
                                    <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
                                </div>
                            ) : history.length > 0 ? (
                                <ResponsiveContainer
                                    width="100%"
                                    height="90%"
                                    initialDimension={{ width: 500, height: 300 }}
                                >
                                    <LineChart data={chartData}>
                                        <CartesianGrid
                                            strokeDasharray="3 3"
                                            stroke="#1e293b"
                                            vertical={false}
                                        />
                                        <XAxis
                                            dataKey="date"
                                            tickLine={false}
                                            axisLine={false}
                                            stroke="#64748b"
                                            dy={10}
                                            angle={10}
                                        />
                                        <YAxis
                                            tickFormatter={(val) =>
                                                privacyMode ? `${val}%` : formatDisplayCurrency(val)
                                            }
                                            tickLine={false}
                                            axisLine={false}
                                            stroke="#64748b"
                                        />
                                        <Tooltip
                                            formatter={(value: unknown, name: unknown) => {
                                                if (privacyMode && name === "Return")
                                                    return `${Number(value).toFixed(2)}%`;
                                                return hideInPrivacyMode(
                                                    formatDisplayCurrency(value as number),
                                                );
                                            }}
                                            contentStyle={{
                                                background: "#0f172a",
                                                border: "1px solid #1e293b",
                                                borderRadius: "12px",
                                                color: "#f8fafc",
                                            }}
                                        />
                                        <Legend />
                                        {privacyMode ? (
                                            <Line
                                                type="monotone"
                                                dataKey="percentReturn"
                                                name="Return"
                                                stroke="#10b981"
                                                strokeWidth={3}
                                                dot={false}
                                                activeDot={{ r: 8 }}
                                            />
                                        ) : (
                                            <>
                                                <Line
                                                    type="monotone"
                                                    dataKey="valuation"
                                                    name="Valuation"
                                                    stroke="#0ea5e9"
                                                    strokeWidth={3}
                                                    dot={false}
                                                    activeDot={{ r: 8 }}
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="invested"
                                                    name="Invested Capital"
                                                    stroke="#6366f1"
                                                    strokeWidth={2}
                                                    strokeDasharray="5 5"
                                                    dot={false}
                                                />
                                                <Line
                                                    type="monotone"
                                                    dataKey="realized"
                                                    name="Realized Profit"
                                                    stroke="teal"
                                                    strokeWidth={3}
                                                    dot={false}
                                                />
                                            </>
                                        )}
                                        <Brush
                                            dataKey="date"
                                            height={30}
                                            stroke="#1e293b"
                                            fill="#0f172a"
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            ) : (
                                <div className="h-full w-full flex items-center justify-center text-slate-550 text-sm">
                                    Add transactions to start generating charts.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Quick Actions Panel */}
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-md flex flex-col space-y-6">
                        <h3 className="text-lg font-bold text-slate-100">Manage Activities</h3>

                        <div className="flex flex-col gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setEditingTransaction(null);
                                    setShowAddForm(true);
                                }}
                                className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 transition-all shadow-md shadow-sky-900/20"
                            >
                                <Plus className="h-4 w-4" /> Add Transaction
                            </button>

                            <button
                                onClick={handleExportCSV}
                                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-850 hover:text-white transition-all"
                            >
                                <Download className="h-4 w-4" /> Export Transactions
                            </button>

                            <label className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-850 hover:text-white transition-all cursor-pointer">
                                {importing ? (
                                    <>
                                        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />{" "}
                                        Importing...
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
                                    onChange={handleImportCSV}
                                    disabled={importing}
                                />
                            </label>

                            <button
                                type="button"
                                onClick={handleClearTransactions}
                                disabled={clearing}
                                className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-900 bg-rose-950/25 px-4 py-3 text-sm font-semibold text-rose-400 hover:bg-rose-950/40 transition-all disabled:opacity-50"
                            >
                                {clearing ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <>
                                        <Trash className="h-4 w-4" /> Clear All Transactions
                                    </>
                                )}
                            </button>
                        </div>

                        <div className="rounded-xl bg-slate-950 p-4 border border-slate-900">
                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                                CSV Format details
                            </h4>
                            <p className="text-xs text-slate-400 leading-normal">
                                Columns required:{" "}
                                <code className="bg-slate-900 px-1 rounded">symbol</code>,{" "}
                                <code className="bg-slate-900 px-1 rounded">type</code> (BUY/SELL),{" "}
                                <code className="bg-slate-900 px-1 rounded">quantity</code>,{" "}
                                <code className="bg-slate-900 px-1 rounded">pricePerShare</code>.
                                <br />
                                Optional:{" "}
                                <code className="bg-slate-900 px-1 rounded">currency</code>,{" "}
                                <code className="bg-slate-900 px-1 rounded">transactionDate</code>.
                            </p>
                        </div>
                    </div>
                </div>

                <TransactionModal
                    isOpen={showAddForm}
                    onClose={() => {
                        setShowAddForm(false);
                        setEditingTransaction(null);
                    }}
                    portfolioId={portfolio?.id || ""}
                    editingTransaction={editingTransaction}
                    onSuccess={fetchPortfolioData}
                />

                {/* Holdings Table */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-md overflow-hidden">
                    <h3 className="text-lg font-bold text-slate-100 mb-6">Current Holdings</h3>

                    {loading ? (
                        <div className="space-y-3">
                            {[...Array(3)].map((_, i) => (
                                <div
                                    key={i}
                                    className="h-12 w-full animate-pulse rounded-lg bg-slate-800/50"
                                ></div>
                            ))}
                        </div>
                    ) : summary && summary.assets.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm text-slate-400 border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-800 text-xs font-bold uppercase tracking-wider text-slate-500">
                                        <th className="pb-3 pr-4">Symbol</th>
                                        <th className="pb-3 px-4">Shares</th>
                                        <th className="pb-3 px-4">Avg Buy Price</th>
                                        <th className="pb-3 px-4">Current Price</th>
                                        <th className="pb-3 px-4">
                                            Cost Basis ({displayCurrency})
                                        </th>
                                        <th className="pb-3 px-4">
                                            Market Value ({displayCurrency})
                                        </th>
                                        <th className="pb-3 px-4">Realized ({displayCurrency})</th>
                                        <th className="pb-3 pl-4 text-right">
                                            Profit / Loss ({displayCurrency})
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-850 text-slate-200 font-medium">
                                    {summary.assets.map((asset) => (
                                        <tr key={asset.symbol} className="hover:bg-slate-800/20">
                                            <td className="py-4 pr-4">
                                                <div className="flex flex-col">
                                                    <span className="font-bold text-white">
                                                        {asset.symbol}
                                                    </span>
                                                    <span className="text-xs text-slate-500 uppercase">
                                                        {asset.currency}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="py-4 px-4">
                                                {hideInPrivacyMode(asset.quantity)}
                                            </td>
                                            <td className="py-4 px-4">
                                                {hideInPrivacyMode(
                                                    formatCurrency(
                                                        asset.avgBuyPrice,
                                                        asset.currency,
                                                    ),
                                                )}
                                            </td>
                                            <td className="py-4 px-4">
                                                {hideInPrivacyMode(
                                                    formatCurrency(
                                                        asset.currentPrice,
                                                        asset.currency,
                                                    ),
                                                )}
                                            </td>
                                            <td className="py-4 px-4">
                                                {hideInPrivacyMode(
                                                    formatDisplayCurrency(asset.cost),
                                                )}
                                            </td>
                                            <td className="py-4 px-4">
                                                {hideInPrivacyMode(
                                                    formatDisplayCurrency(asset.value),
                                                )}
                                            </td>
                                            <td className="py-4 px-4">
                                                {hideInPrivacyMode(
                                                    formatDisplayCurrency(asset.realized),
                                                )}
                                            </td>
                                            <td
                                                className={`py-4 pl-4 text-right ${asset.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                                            >
                                                <div className="flex flex-col items-end">
                                                    <span
                                                        className={
                                                            asset.profit >= 0
                                                                ? "text-emerald-400"
                                                                : "text-rose-400"
                                                        }
                                                    >
                                                        {hideInPrivacyMode(
                                                            `${asset.profit >= 0 ? "+" : ""}${formatDisplayCurrency(asset.profit)}`,
                                                        )}
                                                    </span>
                                                    <span
                                                        className={`text-xs font-bold ${asset.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                                                    >
                                                        {asset.profit >= 0 ? "+" : ""}
                                                        {asset.profitPercentage.toFixed(2)}%
                                                    </span>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="py-12 text-center text-slate-500 text-sm">
                            No active holdings found. Go ahead and log your first transaction!
                        </div>
                    )}
                </div>

                {/* Activities Table */}
                <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-md overflow-hidden">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-lg font-bold text-slate-100">Activity History</h3>
                    </div>

                    {loading ? (
                        <div className="space-y-3">
                            {[...Array(3)].map((_, i) => (
                                <div
                                    key={i}
                                    className="h-12 w-full animate-pulse rounded-lg bg-slate-800/50"
                                ></div>
                            ))}
                        </div>
                    ) : transactions && transactions.length > 0 ? (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm text-slate-400 border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-800 text-xs font-bold uppercase tracking-wider text-slate-550">
                                        <th className="pb-3 pr-4">Date</th>
                                        <th className="pb-3 px-4">Symbol</th>
                                        <th className="pb-3 px-4">Action</th>
                                        <th className="pb-3 px-4">Shares</th>
                                        <th className="pb-3 px-4">Price</th>
                                        <th className="pb-3 px-4">Total</th>
                                        <th className="pb-3 pl-4 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-850 text-slate-200 font-medium">
                                    {transactions.map((tx) => {
                                        const totalCost = tx.quantity * tx.pricePerShare;
                                        return (
                                            <tr key={tx.id} className="hover:bg-slate-800/20">
                                                <td className="py-4 pr-4">{getDateString(tx.transactionDate)}</td>
                                                <td className="py-4 px-4 font-bold text-white">
                                                    {tx.symbol}
                                                </td>
                                                <td className="py-4 px-4">
                                                    <span
                                                        className={`px-2 py-0.5 rounded text-xs font-bold ${tx.type === "BUY" ? "bg-emerald-950 text-emerald-400 border border-emerald-900/30" : "bg-rose-950 text-rose-400 border border-rose-900/30"}`}
                                                    >
                                                        {tx.type}
                                                    </span>
                                                </td>
                                                <td className="py-4 px-4">
                                                    {hideInPrivacyMode(tx.quantity)}
                                                </td>
                                                <td className="py-4 px-4">
                                                    {hideInPrivacyMode(
                                                        formatCurrency(
                                                            tx.pricePerShare,
                                                            tx.currency,
                                                        ),
                                                    )}
                                                </td>
                                                <td className="py-4 px-4 font-semibold text-white">
                                                    {hideInPrivacyMode(
                                                        formatCurrency(totalCost, tx.currency),
                                                    )}
                                                </td>
                                                <td className="py-4 pl-4 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <button
                                                            onClick={() => startEditTransaction(tx)}
                                                            className="text-xs font-semibold text-sky-400 hover:text-sky-300 px-2.5 py-1 bg-sky-950/40 rounded-lg border border-sky-900/30 transition-all"
                                                        >
                                                            Edit
                                                        </button>
                                                        <button
                                                            onClick={() =>
                                                                handleDeleteTransaction(tx.id)
                                                            }
                                                            className="text-xs font-semibold text-rose-400 hover:text-rose-350 px-2.5 py-1 bg-rose-950/40 rounded-lg border border-rose-900/30 transition-all"
                                                        >
                                                            Delete
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div className="py-12 text-center text-slate-500 text-sm">
                            No transactions logged yet. Use the quick actions panel to log one!
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
