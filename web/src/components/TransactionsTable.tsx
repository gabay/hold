import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, X } from "lucide-react";
import { Transaction } from "@/types";
import { formatCurrency, getDateString } from "@/lib/util";

export type TransactionsSortKey =
    | "transactionDate"
    | "symbol"
    | "type"
    | "quantity"
    | "pricePerShare"
    | "total";

type SortDirection = "asc" | "desc";

interface TransactionsTableProps {
    transactions: Transaction[];
    loading: boolean;
    hideInPrivacyMode: (value: string | number) => string;
    onEdit: (tx: Transaction) => void;
    onDelete: (txId: string) => void;
    selectedSymbol?: string | null;
    onClearSymbolFilter?: () => void;
}

export default function TransactionsTable({
    transactions,
    loading,
    hideInPrivacyMode,
    onEdit,
    onDelete,
    selectedSymbol,
    onClearSymbolFilter,
}: TransactionsTableProps) {
    const [sortKey, setSortKey] = useState<TransactionsSortKey | null>(null);
    const [sortDir, setSortDir] = useState<SortDirection>("desc");

    const handleSort = (key: TransactionsSortKey) => {
        if (sortKey === key) {
            setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            setSortDir(key === "symbol" || key === "type" ? "asc" : "desc");
        }
    };

    const displayedTransactions = useMemo(() => {
        const filtered = selectedSymbol
            ? transactions.filter((tx) => tx.symbol === selectedSymbol)
            : transactions;

        if (!sortKey) return filtered;

        return [...filtered].sort((a, b) => {
            let cmp = 0;
            switch (sortKey) {
                case "transactionDate":
                    cmp = getDateString(a.transactionDate).localeCompare(
                        getDateString(b.transactionDate),
                    );
                    break;
                case "symbol":
                    cmp = a.symbol.localeCompare(b.symbol);
                    break;
                case "type":
                    cmp = a.type.localeCompare(b.type);
                    break;
                case "quantity":
                    cmp = a.quantity - b.quantity;
                    break;
                case "pricePerShare":
                    cmp = a.pricePerShare - b.pricePerShare;
                    break;
                case "total":
                    cmp = a.quantity * a.pricePerShare - b.quantity * b.pricePerShare;
                    break;
            }
            return sortDir === "asc" ? cmp : -cmp;
        });
    }, [transactions, selectedSymbol, sortKey, sortDir]);

    const renderSortIcon = (key: TransactionsSortKey) => {
        if (sortKey !== key) {
            return <ArrowUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />;
        }
        return sortDir === "asc" ? (
            <ArrowUp className="h-3 w-3 text-sky-400" aria-hidden="true" />
        ) : (
            <ArrowDown className="h-3 w-3 text-sky-400" aria-hidden="true" />
        );
    };

    const sortButtonClass =
        "inline-flex items-center gap-1 uppercase tracking-wider hover:text-slate-300 transition-colors cursor-pointer";

    return (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-md overflow-hidden">
            <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
                <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="text-lg font-bold text-slate-100">Transactions</h3>
                    {selectedSymbol && onClearSymbolFilter && (
                        <button
                            type="button"
                            onClick={onClearSymbolFilter}
                            className="inline-flex items-center gap-1.5 rounded-full border border-sky-800 bg-sky-950/50 px-3 py-1 text-xs font-semibold text-sky-300 hover:bg-sky-900/60 transition-colors"
                        >
                            <span>Filtering by {selectedSymbol} · Clear</span>
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
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
            ) : displayedTransactions.length > 0 ? (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-slate-400 border-collapse">
                        <thead>
                            <tr className="border-b border-slate-600 text-xs font-bold uppercase tracking-wider text-slate-500">
                                <th className="pb-3 pr-4">
                                    <button
                                        type="button"
                                        onClick={() => handleSort("transactionDate")}
                                        className={sortButtonClass}
                                    >
                                        <span>Date</span>
                                        {renderSortIcon("transactionDate")}
                                    </button>
                                </th>
                                <th className="pb-3 px-4">
                                    <button
                                        type="button"
                                        onClick={() => handleSort("symbol")}
                                        className={sortButtonClass}
                                    >
                                        <span>Symbol</span>
                                        {renderSortIcon("symbol")}
                                    </button>
                                </th>
                                <th className="pb-3 px-4">
                                    <button
                                        type="button"
                                        onClick={() => handleSort("type")}
                                        className={sortButtonClass}
                                    >
                                        <span>Action</span>
                                        {renderSortIcon("type")}
                                    </button>
                                </th>
                                <th className="pb-3 px-4">
                                    <button
                                        type="button"
                                        onClick={() => handleSort("quantity")}
                                        className={sortButtonClass}
                                    >
                                        <span>Shares</span>
                                        {renderSortIcon("quantity")}
                                    </button>
                                </th>
                                <th className="pb-3 px-4">
                                    <button
                                        type="button"
                                        onClick={() => handleSort("pricePerShare")}
                                        className={sortButtonClass}
                                    >
                                        <span>Price</span>
                                        {renderSortIcon("pricePerShare")}
                                    </button>
                                </th>
                                <th className="pb-3 px-4">
                                    <button
                                        type="button"
                                        onClick={() => handleSort("total")}
                                        className={sortButtonClass}
                                    >
                                        <span>Total</span>
                                        {renderSortIcon("total")}
                                    </button>
                                </th>
                                <th className="pb-3 pl-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 text-slate-200 font-medium">
                            {displayedTransactions.map((tx) => {
                                const totalCost = tx.quantity * tx.pricePerShare;
                                return (
                                    <tr key={tx.id} className="hover:bg-slate-800/20">
                                        <td className="py-4 pr-4">
                                            {getDateString(tx.transactionDate)}
                                        </td>
                                        <td className="py-4 px-4 font-bold text-white">
                                            {tx.symbol}
                                        </td>
                                        <td className="py-4 px-4">
                                            <span
                                                className={`px-2 py-0.5 rounded text-xs font-bold ${
                                                    tx.type === "BUY"
                                                        ? "bg-emerald-950 text-emerald-400 border border-emerald-900/30"
                                                        : "bg-rose-950 text-rose-400 border border-rose-900/30"
                                                }`}
                                            >
                                                {tx.type}
                                            </span>
                                        </td>
                                        <td className="py-4 px-4">
                                            {hideInPrivacyMode(tx.quantity)}
                                        </td>
                                        <td className="py-4 px-4">
                                            {hideInPrivacyMode(
                                                formatCurrency(tx.pricePerShare, tx.currency),
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
                                                    type="button"
                                                    onClick={() => onEdit(tx)}
                                                    className="text-xs font-semibold text-sky-400 hover:text-sky-300 px-2.5 py-1 bg-sky-950/40 rounded-lg border border-sky-900/30 transition-all"
                                                >
                                                    Edit
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => onDelete(tx.id)}
                                                    className="text-xs font-semibold text-rose-400 hover:text-rose-300 px-2.5 py-1 bg-rose-950/40 rounded-lg border border-rose-900/30 transition-all"
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
            ) : selectedSymbol ? (
                <div className="py-12 text-center text-slate-500 text-sm">
                    No transactions found for {selectedSymbol}.
                </div>
            ) : (
                <div className="py-12 text-center text-slate-500 text-sm">
                    No transactions logged yet. Use the quick actions panel to log one!
                </div>
            )}
        </div>
    );
}
