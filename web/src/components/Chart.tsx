import { ChartDataPoint } from "@/types";
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
import { Loader2, X } from "lucide-react";

interface ChartProps {
    data: ChartDataPoint[];
    title?: string;
    loading: boolean;
    privacyMode: boolean;
    timeRange: string;
    onTimeRangeChange: (range: string) => void;
    formatOrHideCurrency: (value: number) => string;
    onClearSymbolFilter?: () => void;
}

export default function Chart({
    data,
    title,
    loading,
    privacyMode,
    timeRange,
    onTimeRangeChange,
    formatOrHideCurrency,
    onClearSymbolFilter,
}: ChartProps) {
    const chartData =
        data?.map((d) => ({
            ...d,
            percentReturn:
                d.invested > 0 ? ((d.valuation + d.realized - d.invested) / d.invested) * 100 : 0,
        })) || [];

    const timeRanges = [
        { value: "30", label: "1M" },
        { value: "ytd", label: "YTD" },
        { value: "365", label: "1Y" },
        { value: "1825", label: "5Y" },
        { value: "max", label: "MAX" },
    ];

    return (
        <div className="lg:col-span-3 rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-md flex flex-col justify-between min-h-100 max-h-fit">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="text-lg font-bold text-slate-100">
                        {title ? `${title} Valuation` : "Portfolio Valuation"}
                    </h3>
                    {title && onClearSymbolFilter && (
                        <button
                            type="button"
                            onClick={onClearSymbolFilter}
                            className="inline-flex items-center gap-1.5 rounded-full border border-sky-800 bg-sky-950/50 px-3 py-1 text-xs font-semibold text-sky-300 hover:bg-sky-900/60 transition-colors"
                        >
                            <span>Filtering by {title} · Clear</span>
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
                    {timeRanges.map((range) => (
                        <button
                            key={range.value}
                            type="button"
                            onClick={() => onTimeRangeChange(range.value)}
                            className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                                timeRange === range.value
                                    ? "bg-sky-600 text-white"
                                    : "text-slate-400 hover:text-white"
                            }`}
                        >
                            {range.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="flex-1 w-full h-full">
                {loading ? (
                    <div className="h-full w-full flex items-center justify-center">
                        <Loader2 className="h-6 w-6 animate-spin text-slate-500" role="status" />
                    </div>
                ) : chartData.length > 0 ? (
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
                                    privacyMode ? `${val}%` : formatOrHideCurrency(val)
                                }
                                tickLine={false}
                                axisLine={false}
                                stroke="#64748b"
                            />
                            <Tooltip
                                formatter={(value: unknown, name: unknown) => {
                                    if (privacyMode && name === "Return")
                                        return `${Number(value).toFixed(2)}%`;
                                    return formatOrHideCurrency(value as number);
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
                            <Brush dataKey="date" height={30} stroke="#1e293b" fill="#0f172a" />
                        </LineChart>
                    </ResponsiveContainer>
                ) : (
                    <div className="h-full w-full flex items-center justify-center text-slate-500 text-sm">
                        Add transactions to start generating charts.
                    </div>
                )}
            </div>
        </div>
    );
}
