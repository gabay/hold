import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { AssetData, PortfolioSummary } from "@/types";
import { formatCurrency } from "@/lib/util";

export type HoldingsSortKey =
    | "symbol"
    | "quantity"
    | "avgBuyPrice"
    | "currentPrice"
    | "cost"
    | "value"
    | "realized"
    | "profit"
    | "profitPercentage";

type SortDirection = "asc" | "desc";

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
    const [sortKey, setSortKey] = useState<HoldingsSortKey | null>(null);
    const [sortDir, setSortDir] = useState<SortDirection>("desc");
    const [hideClosed, setHideClosed] = useState(false);

    const handleSort = (key: HoldingsSortKey) => {
        if (sortKey === key) {
            setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            setSortDir(key === "symbol" ? "asc" : "desc");
        }
    };

    const displayedAssets = useMemo(() => {
        if (!summary?.assets) return [];
        const filtered = hideClosed
            ? summary.assets.filter((a) => a.quantity !== 0)
            : summary.assets;

        if (!sortKey) return filtered;

        return [...filtered].sort((a: AssetData, b: AssetData) => {
            let cmp = 0;
            if (sortKey === "symbol") {
                cmp = a.symbol.localeCompare(b.symbol);
            } else {
                cmp = a[sortKey] - b[sortKey];
            }
            return sortDir === "asc" ? cmp : -cmp;
        });
    }, [summary?.assets, hideClosed, sortKey, sortDir]);

    const renderSortIcon = (key: HoldingsSortKey) => {
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
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                <div>
                    <h3 className="text-lg font-bold text-slate-100">Current Holdings</h3>
                    <div className="text-sm text-slate-400">
                        select a holding to see its valuation in the chart
                    </div>
                </div>
                {summary && summary.assets.length > 0 && (
                    <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-slate-200 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={hideClosed}
                            onChange={(e) => setHideClosed(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-sky-500 focus:ring-sky-500"
                        />
                        Hide closed positions
                    </label>
                )}
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
            ) : summary && summary.assets.length > 0 ? (
                displayedAssets.length > 0 ? (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm text-slate-400 border-collapse">
                            <thead>
                                <tr className="border-b border-slate-600 text-xs font-bold uppercase tracking-wider text-slate-500">
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
                                            onClick={() => handleSort("avgBuyPrice")}
                                            className={sortButtonClass}
                                        >
                                            <span>Avg Buy Price</span>
                                            {renderSortIcon("avgBuyPrice")}
                                        </button>
                                    </th>
                                    <th className="pb-3 px-4">
                                        <button
                                            type="button"
                                            onClick={() => handleSort("currentPrice")}
                                            className={sortButtonClass}
                                        >
                                            <span>Current Price</span>
                                            {renderSortIcon("currentPrice")}
                                        </button>
                                    </th>
                                    <th className="pb-3 px-4">
                                        <button
                                            type="button"
                                            onClick={() => handleSort("cost")}
                                            className={sortButtonClass}
                                        >
                                            <span>Cost Basis ({displayCurrency})</span>
                                            {renderSortIcon("cost")}
                                        </button>
                                    </th>
                                    <th className="pb-3 px-4">
                                        <button
                                            type="button"
                                            onClick={() => handleSort("value")}
                                            className={sortButtonClass}
                                        >
                                            <span>Market Value ({displayCurrency})</span>
                                            {renderSortIcon("value")}
                                        </button>
                                    </th>
                                    <th className="pb-3 px-4">
                                        <button
                                            type="button"
                                            onClick={() => handleSort("realized")}
                                            className={sortButtonClass}
                                        >
                                            <span>Realized ({displayCurrency})</span>
                                            {renderSortIcon("realized")}
                                        </button>
                                    </th>
                                    <th className="pb-3 px-4 text-right">
                                        <div className="inline-flex items-center justify-end gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleSort("profit")}
                                                className={sortButtonClass}
                                            >
                                                <span>Profit / Loss ({displayCurrency})</span>
                                                {renderSortIcon("profit")}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleSort("profitPercentage")}
                                                className={`${sortButtonClass} px-1.5 py-0.5 rounded border border-slate-800 bg-slate-950/60`}
                                                title="Sort by Profit / Loss %"
                                            >
                                                <span>%</span>
                                                {renderSortIcon("profitPercentage")}
                                            </button>
                                        </div>
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800 text-slate-200 font-medium">
                                {displayedAssets.map((holding) => (
                                    <tr
                                        key={holding.symbol}
                                        onClick={() => onSelectSymbol?.(holding.symbol)}
                                        className={`cursor-pointer ${
                                            selectedSymbol === holding.symbol
                                                ? "bg-slate-800/40"
                                                : "hover:bg-slate-800/20"
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
                                                formatCurrency(
                                                    holding.avgBuyPrice,
                                                    holding.currency,
                                                ),
                                            )}
                                        </td>
                                        <td className="py-4 px-4">
                                            {hideInPrivacyMode(
                                                formatCurrency(
                                                    holding.currentPrice,
                                                    holding.currency,
                                                ),
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
                                                        formatCurrency(
                                                            holding.profit,
                                                            holding.currency,
                                                        ),
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
                        No open holdings. Uncheck &ldquo;Hide closed positions&rdquo; to view closed
                        positions.
                    </div>
                )
            ) : (
                <div className="py-12 text-center text-slate-500 text-sm">
                    No active holdings found. Go ahead and log your first transaction!
                </div>
            )}
        </div>
    );
}
