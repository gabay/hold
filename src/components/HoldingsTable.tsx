"use client";

import { PortfolioSummary } from "@/lib/portfolio";
import { formatCurrency } from "./util";

interface HoldingsTableProps {
    summary: PortfolioSummary | null;
    loading: boolean;
    displayCurrency: string;
    hideInPrivacyMode: (value: string | number) => string;
    selectedSymbol?: string | null;
    onSelectSymbol?: (symbol: string) => void;
}

export default function HoldingsTable({
    summary,
    loading,
    displayCurrency,
    hideInPrivacyMode,
    selectedSymbol,
    onSelectSymbol,
}: HoldingsTableProps) {
    return (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-md overflow-hidden">
            <h3 className="text-lg font-bold text-slate-100">Current Holdings</h3>
            <div className="text-sm text-slate-400 mb-4">select a holding to see its valuation in the chart</div>

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
                            <tr className="border-b border-slate-600 text-xs font-bold uppercase tracking-wider text-slate-500">
                                <th className="pb-3 px-4">Symbol</th>
                                <th className="pb-3 px-4">Shares</th>
                                <th className="pb-3 px-4">Avg Buy Price</th>
                                <th className="pb-3 px-4">Current Price</th>
                                <th className="pb-3 px-4">Cost Basis ({displayCurrency})</th>
                                <th className="pb-3 px-4">Market Value ({displayCurrency})</th>
                                <th className="pb-3 px-4">Realized ({displayCurrency})</th>
                                <th className="pb-3 px-4 text-right">
                                    Profit / Loss ({displayCurrency})
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 text-slate-200 font-medium">
                            {summary.assets.map((holding) => (
                                <tr
                                    key={holding.symbol}
                                    onClick={() => onSelectSymbol?.(holding.symbol)}
                                    className={`cursor-pointer ${
                                        selectedSymbol === holding.symbol ? "bg-slate-800/40" : "hover:bg-slate-800/20"
                                    }`}
                                >
                                    <td className="py-4 px-4">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-white">
                                                {holding.symbol}
                                            </span>
                                            <span className="text-xs text-slate-500 uppercase">
                                                {holding.currency}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="py-4 px-4">
                                        {hideInPrivacyMode(holding.quantity)}
                                    </td>
                                    <td className="py-4 px-4">
                                        {hideInPrivacyMode(
                                            formatCurrency(holding.avgBuyPrice, holding.currency),
                                        )}
                                    </td>
                                    <td className="py-4 px-4">
                                        {hideInPrivacyMode(
                                            formatCurrency(holding.currentPrice, holding.currency),
                                        )}
                                    </td>
                                    <td className="py-4 px-4">
                                        {hideInPrivacyMode(
                                            formatCurrency(holding.cost, holding.currency),
                                        )}
                                    </td>
                                    <td className="py-4 px-4">
                                        {hideInPrivacyMode(
                                            formatCurrency(holding.value, holding.currency),
                                        )}
                                    </td>
                                    <td className="py-4 px-4">
                                        {hideInPrivacyMode(
                                            formatCurrency(holding.realized, holding.currency),
                                        )}
                                    </td>
                                    <td
                                        className={`py-4 px-4 text-right ${holding.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                                    >
                                        <div className="flex flex-col items-end">
                                            <span
                                                className={
                                                    holding.profit >= 0
                                                        ? "text-emerald-400"
                                                        : "text-rose-400"
                                                }
                                            >
                                                {hideInPrivacyMode(
                                                    formatCurrency(holding.profit, holding.currency),
                                                )}
                                            </span>
                                            <span
                                                className={`text-xs font-bold ${holding.profit >= 0 ? "text-emerald-400" : "text-rose-400"}`}
                                            >
                                                {holding.profitPercentage.toFixed(2)}%
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
    );
}
