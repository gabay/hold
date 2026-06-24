"use client";

import { Transaction } from "@prisma/client";
import { getDateString } from "@/lib/util";
import { formatCurrency } from "./util";

interface TransactionsTableProps {
    transactions: Transaction[];
    loading: boolean;
    hideInPrivacyMode: (value: string | number) => string;
    onEdit: (tx: Transaction) => void;
    onDelete: (txId: string) => void;
}

export default function TransactionsTable({
    transactions,
    loading,
    hideInPrivacyMode,
    onEdit,
    onDelete,
}: TransactionsTableProps) {
    return (
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
                            <tr className="border-b border-slate-600 text-xs font-bold uppercase tracking-wider text-slate-500">
                                <th className="pb-3 pr-4">Date</th>
                                <th className="pb-3 px-4">Symbol</th>
                                <th className="pb-3 px-4">Action</th>
                                <th className="pb-3 px-4">Shares</th>
                                <th className="pb-3 px-4">Price</th>
                                <th className="pb-3 px-4">Total</th>
                                <th className="pb-3 pl-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 text-slate-200 font-medium">
                            {transactions.map((tx) => {
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
                                                    onClick={() => onEdit(tx)}
                                                    className="text-xs font-semibold text-sky-400 hover:text-sky-300 px-2.5 py-1 bg-sky-950/40 rounded-lg border border-sky-900/30 transition-all"
                                                >
                                                    Edit
                                                </button>
                                                <button
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
            ) : (
                <div className="py-12 text-center text-slate-500 text-sm">
                    No transactions logged yet. Use the quick actions panel to log one!
                </div>
            )}
        </div>
    );
}
