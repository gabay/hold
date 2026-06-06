"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect, useState, useRef } from "react";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Brush
} from "recharts";
import { 
  Plus, LogOut, TrendingUp, TrendingDown, DollarSign, Wallet, Percent, Download, Upload, Loader2
} from "lucide-react";

interface Holding {
  symbol: string;
  quantity: number;
  totalCost: number;
  avgBuyPrice: number;
  currentPrice: number;
  currency: string;
  costInDisplayCurrency: number;
  valueInDisplayCurrency: number;
  profitInDisplayCurrency: number;
  profitPercentage: number;
}

interface PortfolioSummary {
  portfolioId: string;
  name: string;
  baseCurrency: string;
  displayCurrency: string;
  totalCost: number;
  totalValue: number;
  totalProfit: number;
  totalProfitPercentage: number;
  holdings: Holding[];
}

interface ChartDataPoint {
  date: string;
  valuation: number;
  invested: number;
}

export default function Dashboard() {
  const { data: session, status } = useSession();
  
  const [portfolio, setPortfolio] = useState<{ id: string; name: string } | null>(null);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [history, setHistory] = useState<ChartDataPoint[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [displayCurrency, setDisplayCurrency] = useState("USD");
  const [timeRange, setTimeRange] = useState("30"); // "30" | "ytd" | "365" | "1825" | "max"
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Transaction Form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [formSymbol, setFormSymbol] = useState("");
  const [formType, setFormType] = useState<"BUY" | "SELL">("BUY");
  const [formQuantity, setFormQuantity] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formFee, setFormFee] = useState("0");
  const [formDate, setFormDate] = useState(new Date().toISOString().split("T")[0]);
  const [formSubmitting, setFormSubmitting] = useState(false);
  
  // Import CSV state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  // Load portfolios
  useEffect(() => {
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
  }, [status]);

  // Load summary, history, and transactions
  useEffect(() => {
    if (portfolio?.id) {
      setLoading(true);
      setError(null);
      
      const summaryPromise = fetch(`/api/portfolio/${portfolio.id}/summary?currency=${displayCurrency}`, { cache: "no-store" })
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch summary");
          return res.json() as Promise<PortfolioSummary>;
        });
        
      const historyPromise = fetch(`/api/portfolio/${portfolio.id}/history?currency=${displayCurrency}&days=${timeRange}`, { cache: "no-store" })
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch performance history");
          return res.json() as Promise<ChartDataPoint[]>;
        });

      const txPromise = fetch(`/api/portfolio/${portfolio.id}/transactions`, { cache: "no-store" })
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch transactions");
          return res.json() as Promise<any[]>;
        });

      Promise.all([summaryPromise, historyPromise, txPromise])
        .then(([sumData, histData, txData]) => {
          setSummary(sumData);
          setHistory(histData);
          setTransactions(txData);
          setLoading(false);
        })
        .catch((err) => {
          setError(err.message);
          setLoading(false);
        });
    }
  }, [portfolio, displayCurrency, timeRange]);

  const refreshData = () => {
    if (portfolio?.id) {
      fetch(`/api/portfolio/${portfolio.id}/summary?currency=${displayCurrency}`, { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => setSummary(data));
        
      fetch(`/api/portfolio/${portfolio.id}/history?currency=${displayCurrency}&days=${timeRange}`, { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => setHistory(data));

      fetch(`/api/portfolio/${portfolio.id}/transactions`, { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => setTransactions(data));
    }
  };

  const startEditTransaction = (tx: any) => {
    setEditingTransactionId(tx.id);
    setFormSymbol(tx.symbol);
    setFormType(tx.type);
    setFormQuantity(tx.quantity.toString());
    setFormPrice(tx.pricePerShare.toString());
    setFormFee(tx.fee.toString());
    setFormDate(new Date(tx.transactionDate).toISOString().split("T")[0]);
    setShowAddForm(true);
  };

  const handleDeleteTransaction = async (txId: string) => {
    const confirmDelete = window.confirm("Are you sure you want to delete this transaction?");
    if (!confirmDelete) return;

    setError(null);
    try {
      const res = await fetch(`/api/transactions/${txId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete transaction");
      
      refreshData();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!portfolio?.id) return;
    
    setFormSubmitting(true);
    setError(null);

    const url = editingTransactionId 
      ? `/api/transactions/${editingTransactionId}`
      : `/api/portfolio/${portfolio.id}/transactions`;
      
    const method = editingTransactionId ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: formSymbol,
          type: formType,
          quantity: parseFloat(formQuantity),
          pricePerShare: parseFloat(formPrice),
          fee: parseFloat(formFee),
          transactionDate: new Date(formDate).toISOString(),
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || `Failed to ${editingTransactionId ? 'update' : 'add'} transaction`);
      }

      // Reset Form
      setFormSymbol("");
      setFormQuantity("");
      setFormPrice("");
      setFormFee("0");
      setEditingTransactionId(null);
      setShowAddForm(false);
      
      // Refresh Data
      refreshData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setFormSubmitting(false);
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
      alert(`Successfully imported ${result.count} transactions!`);
      refreshData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const [clearing, setClearing] = useState(false);
  const handleClearTransactions = async () => {
    if (!portfolio?.id) return;
    const confirmClear = window.confirm(
      "Are you sure you want to clear all transactions? This action is permanent and cannot be undone."
    );
    if (!confirmClear) return;

    setClearing(true);
    setError(null);
    try {
      const res = await fetch(`/api/portfolio/${portfolio.id}/transactions`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to clear transactions");
      
      alert("All transactions cleared successfully!");
      refreshData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setClearing(false);
    }
  };

  // Format currency helpers
  const fmt = (val: number) => {
    const symbol = 
      displayCurrency === "USD" ? "$" : 
      displayCurrency === "EUR" ? "€" : 
      displayCurrency === "ILS" ? "₪" : 
      displayCurrency + " ";
    return `${symbol}${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  if (status === "loading") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950">
        <Loader2 className="h-8 w-8 animate-spin text-sky-400" />
      </div>
    );
  }

  // Not logged in -> Show login UI
  if (status === "unauthenticated" || !session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-8 bg-slate-950 text-slate-100">
        <div className="w-full max-w-md space-y-8 bg-slate-900/60 backdrop-blur-md p-8 rounded-2xl shadow-xl border border-slate-800">
          <div className="text-center">
            <h2 className="mt-6 text-3xl font-extrabold tracking-tight bg-gradient-to-r from-sky-400 to-blue-500 bg-clip-text text-transparent">
              My Portfolio Manager
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              Track valuations, returns, and transactions in USD, EUR and more.
            </p>
          </div>
          <div className="mt-8 space-y-4">
            <button
              onClick={() => signIn("google")}
              className="group relative flex w-full justify-center rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 transition-all shadow-md shadow-sky-900/20"
            >
              Sign in with OIDC (Google)
            </button>
            
            <div className="relative flex py-4 items-center">
              <div className="flex-grow border-t border-slate-800"></div>
              <span className="flex-shrink mx-4 text-slate-500 text-xs uppercase font-medium">Or Dev Login</span>
              <div className="flex-grow border-t border-slate-800"></div>
            </div>

            <button
              onClick={() => signIn("credentials", { email: "test@example.com", name: "Demo User" })}
              className="flex w-full justify-center rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-850 hover:text-white focus:outline-none focus:ring-2 focus:ring-slate-700 transition-all"
            >
              Access Demo Workspace
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      {/* Header navbar */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur-md sticky top-0 z-40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-xl font-bold bg-gradient-to-r from-sky-400 to-blue-500 bg-clip-text text-transparent">
                PortfolioManager
              </span>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-slate-400">Currency:</span>
                <select
                  value={displayCurrency}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDisplayCurrency(val);
                    localStorage.setItem("portfolio_displayCurrency", val);
                  }}
                  className="rounded-lg border border-slate-800 bg-slate-950 text-slate-100 px-3 py-1.5 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-sky-500"
                >
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="GBP">GBP (£)</option>
                  <option value="ILS">ILS (₪)</option>
                </select>
              </div>

              <div className="h-6 w-px bg-slate-800"></div>

              <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-semibold text-slate-200">{session.user?.name}</p>
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
      <main className="flex-grow mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        
        {error && (
          <div className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Dashboard Overview Cards */}
        {loading ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-2xl bg-slate-900 border border-slate-850"></div>
            ))}
          </div>
        ) : (
          summary && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
              {/* Card 1: Total Valuation */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-md flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-400">Current Valuation</p>
                  <p className="text-3xl font-bold tracking-tight text-white">{fmt(summary.totalValue)}</p>
                </div>
                <div className="rounded-xl bg-sky-950/40 text-sky-400 border border-sky-900/30 p-3">
                  <Wallet className="h-6 w-6" />
                </div>
              </div>

              {/* Card 2: Cost Basis */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-md flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-400">Invested Capital (Cost)</p>
                  <p className="text-3xl font-bold tracking-tight text-white">{fmt(summary.totalCost)}</p>
                </div>
                <div className="rounded-xl bg-indigo-950/40 text-indigo-400 border border-indigo-900/30 p-3">
                  <DollarSign className="h-6 w-6" />
                </div>
              </div>

              {/* Card 3: Total Profit/Loss */}
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-md flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-slate-400">Total Profit / Loss</p>
                  <div className="flex items-baseline gap-2">
                    <p className={`text-3xl font-bold tracking-tight ${summary.totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {fmt(summary.totalProfit)}
                    </p>
                    <span className={`text-sm font-semibold flex items-center gap-0.5 ${summary.totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {summary.totalProfit >= 0 ? <TrendingUp className="h-4.5 w-4.5" /> : <TrendingDown className="h-4.5 w-4.5" />}
                      {summary.totalProfitPercentage.toFixed(2)}%
                    </span>
                  </div>
                </div>
                <div className={`rounded-xl p-3 border ${summary.totalProfit >= 0 ? 'bg-emerald-950/40 text-emerald-400 border-emerald-900/30' : 'bg-rose-950/40 text-rose-400 border-rose-900/30'}`}>
                  <Percent className="h-6 w-6" />
                </div>
              </div>
            </div>
          )
        )}

        {/* Charts & Actions Section */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Performance line chart */}
          <div className="lg:col-span-2 rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-md flex flex-col justify-between h-[400px]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
              <h3 className="text-lg font-bold text-slate-100">Valuation History</h3>
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                <button type="button" onClick={() => { setTimeRange("30"); localStorage.setItem("portfolio_timeRange", "30"); }} className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${timeRange === "30" ? "bg-sky-600 text-white" : "text-slate-400 hover:text-white"}`}>1M</button>
                <button type="button" onClick={() => { setTimeRange("ytd"); localStorage.setItem("portfolio_timeRange", "ytd"); }} className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${timeRange === "ytd" ? "bg-sky-600 text-white" : "text-slate-400 hover:text-white"}`}>YTD</button>
                <button type="button" onClick={() => { setTimeRange("365"); localStorage.setItem("portfolio_timeRange", "365"); }} className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${timeRange === "365" ? "bg-sky-600 text-white" : "text-slate-400 hover:text-white"}`}>1Y</button>
                <button type="button" onClick={() => { setTimeRange("1825"); localStorage.setItem("portfolio_timeRange", "1825"); }} className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${timeRange === "1825" ? "bg-sky-600 text-white" : "text-slate-400 hover:text-white"}`}>5Y</button>
                <button type="button" onClick={() => { setTimeRange("max"); localStorage.setItem("portfolio_timeRange", "max"); }} className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${timeRange === "max" ? "bg-sky-600 text-white" : "text-slate-400 hover:text-white"}`}>MAX</button>
              </div>
            </div>
            <div className="flex-1 w-full h-full">
              {loading ? (
                <div className="h-full w-full flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
                </div>
              ) : history.length > 0 ? (
                <ResponsiveContainer width="100%" height="90%">
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} stroke="#64748b" dy={10} />
                    <YAxis tickLine={false} axisLine={false} stroke="#64748b" dx={-10} />
                    <Tooltip 
                      formatter={(value: any) => fmt(value as number)}
                      contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: "12px", color: "#f8fafc" }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="valuation" name="Total Value" stroke="#0ea5e9" strokeWidth={3} dot={false} activeDot={{ r: 8 }} />
                    <Line type="monotone" dataKey="invested" name="Invested Capital" stroke="#6366f1" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                    <Brush dataKey="date" height={30} stroke="#1e293b" fill="#0f172a" />
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
                  setEditingTransactionId(null);
                  setFormSymbol("");
                  setFormType("BUY");
                  setFormQuantity("");
                  setFormPrice("");
                  setFormFee("0");
                  setFormDate(new Date().toISOString().split("T")[0]);
                  setShowAddForm(true);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 transition-all shadow-md shadow-sky-900/20"
              >
                <Plus className="h-4 w-4" /> Log Buy or Sell
              </button>

              <button
                onClick={handleExportCSV}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-850 hover:text-white transition-all"
              >
                <Download className="h-4 w-4" /> Export Transactions (CSV)
              </button>

              <label className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-850 hover:text-white transition-all cursor-pointer">
                {importing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> Importing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" /> Import Transactions (CSV)
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
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-900 bg-rose-950/25 px-4 py-3 text-sm font-semibold text-rose-455 hover:bg-rose-950/40 text-rose-400 transition-all disabled:opacity-50"
              >
                {clearing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Clear All Transactions"}
              </button>
            </div>

            <div className="rounded-xl bg-slate-950 p-4 border border-slate-900">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">CSV Format details</h4>
              <p className="text-xs text-slate-400 leading-normal">
                Columns required: <code className="bg-slate-900 px-1 rounded">symbol</code>, <code className="bg-slate-900 px-1 rounded">type</code> (BUY/SELL), <code className="bg-slate-900 px-1 rounded">quantity</code>, <code className="bg-slate-900 px-1 rounded">pricePerShare</code>.<br />
                Optional: <code className="bg-slate-900 px-1 rounded">currency</code>, <code className="bg-slate-900 px-1 rounded">fee</code>, <code className="bg-slate-900 px-1 rounded">transactionDate</code>.
              </p>
            </div>
          </div>
        </div>

        {/* Add Transaction Dialog Form overlay */}
        {showAddForm && (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-slate-900 rounded-2xl p-6 shadow-2xl border border-slate-800 space-y-6">
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-bold text-slate-100">
                  {editingTransactionId ? "Edit Transaction" : "Log Transaction"}
                </h3>
                <button 
                  onClick={() => setShowAddForm(false)}
                  className="text-slate-400 hover:text-white text-sm font-semibold"
                >
                  Close
                </button>
              </div>

              <form onSubmit={handleAddTransaction} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Ticker Symbol</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. AAPL, VWCE.DE"
                    value={formSymbol}
                    onChange={(e) => setFormSymbol(e.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-100"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Type</label>
                    <select
                      value={formType}
                      onChange={(e) => setFormType(e.target.value as "BUY" | "SELL")}
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-100"
                    >
                      <option value="BUY">BUY</option>
                      <option value="SELL">SELL</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Quantity</label>
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
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Price Per Share</label>
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

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Fee</label>
                    <input
                      type="number"
                      step="any"
                      placeholder="e.g. 2.99"
                      value={formFee}
                      onChange={(e) => setFormFee(e.target.value)}
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Date</label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-100"
                  />
                </div>

                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 transition-all disabled:opacity-50"
                >
                  {formSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : editingTransactionId ? (
                    "Update Transaction"
                  ) : (
                    "Save Transaction"
                  )}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Holdings Table */}
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-md overflow-hidden">
          <h3 className="text-lg font-bold text-slate-100 mb-6">Current Holdings</h3>
          
          {loading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-12 w-full animate-pulse rounded-lg bg-slate-800/50"></div>
              ))}
            </div>
          ) : summary && summary.holdings.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-400 border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-xs font-bold uppercase tracking-wider text-slate-500">
                    <th className="pb-3 pr-4">Symbol</th>
                    <th className="pb-3 px-4">Shares</th>
                    <th className="pb-3 px-4">Avg Buy Price</th>
                    <th className="pb-3 px-4">Current Price</th>
                    <th className="pb-3 px-4">Cost Basis ({displayCurrency})</th>
                    <th className="pb-3 px-4">Market Value ({displayCurrency})</th>
                    <th className="pb-3 pl-4 text-right">Return ({displayCurrency})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850 text-slate-200 font-medium">
                  {summary.holdings.map((h) => (
                    <tr key={h.symbol} className="hover:bg-slate-800/20">
                      <td className="py-4 pr-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-white">{h.symbol}</span>
                          <span className="text-xs text-slate-500 uppercase">{h.currency}</span>
                        </div>
                      </td>
                      <td className="py-4 px-4">{h.quantity}</td>
                      <td className="py-4 px-4">
                        {h.currency === "USD" ? "$" : h.currency === "EUR" ? "€" : h.currency + " "}
                        {h.avgBuyPrice.toFixed(2)}
                      </td>
                      <td className="py-4 px-4">
                        {h.currency === "USD" ? "$" : h.currency === "EUR" ? "€" : h.currency + " "}
                        {h.currentPrice.toFixed(2)}
                      </td>
                      <td className="py-4 px-4">{fmt(h.costInDisplayCurrency)}</td>
                      <td className="py-4 px-4">{fmt(h.valueInDisplayCurrency)}</td>
                      <td className={`py-4 pl-4 text-right ${h.profitInDisplayCurrency >= 0 ? 'text-emerald-450' : 'text-rose-455'}`}>
                        <div className="flex flex-col items-end">
                          <span className={h.profitInDisplayCurrency >= 0 ? 'text-emerald-400' : 'text-rose-450'}>
                            {h.profitInDisplayCurrency >= 0 ? "+" : ""}{fmt(h.profitInDisplayCurrency)}
                          </span>
                          <span className={`text-xs font-bold ${h.profitInDisplayCurrency >= 0 ? 'text-emerald-400' : 'text-rose-450'}`}>
                            {h.profitInDisplayCurrency >= 0 ? "+" : ""}{h.profitPercentage.toFixed(2)}%
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
                <div key={i} className="h-12 w-full animate-pulse rounded-lg bg-slate-800/50"></div>
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
                    <th className="pb-3 px-4">Fee</th>
                    <th className="pb-3 px-4">Total</th>
                    <th className="pb-3 pl-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850 text-slate-200 font-medium">
                  {transactions.map((tx) => {
                    const totalCost = tx.quantity * tx.pricePerShare + (tx.type === "BUY" ? tx.fee : -tx.fee);
                    const sym = 
                      tx.currency === "USD" ? "$" : 
                      tx.currency === "EUR" ? "€" : 
                      tx.currency === "ILS" ? "₪" : 
                      tx.currency + " ";
                    return (
                      <tr key={tx.id} className="hover:bg-slate-800/20">
                        <td className="py-4 pr-4">
                          {new Date(tx.transactionDate).toLocaleDateString()}
                        </td>
                        <td className="py-4 px-4 font-bold text-white">{tx.symbol}</td>
                        <td className="py-4 px-4">
                          <span className={`px-2 py-0.5 rounded text-xs font-bold ${tx.type === "BUY" ? "bg-emerald-950 text-emerald-450 border border-emerald-900/30" : "bg-rose-950 text-rose-455 border border-rose-900/30"}`}>
                            {tx.type}
                          </span>
                        </td>
                        <td className="py-4 px-4">{tx.quantity}</td>
                        <td className="py-4 px-4">{sym}{tx.pricePerShare.toFixed(2)}</td>
                        <td className="py-4 px-4">{sym}{tx.fee.toFixed(2)}</td>
                        <td className="py-4 px-4 font-semibold text-white">{sym}{totalCost.toFixed(2)}</td>
                        <td className="py-4 pl-4 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => startEditTransaction(tx)}
                              className="text-xs font-semibold text-sky-400 hover:text-sky-300 px-2.5 py-1 bg-sky-950/40 rounded-lg border border-sky-900/30 transition-all"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteTransaction(tx.id)}
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
