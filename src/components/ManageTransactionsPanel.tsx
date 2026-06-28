"use client";

import { Download, Loader2, Plus, Trash, Upload } from "lucide-react";
import { useRef, useState } from "react";

interface ManageTransactionsPanelProps {
    onAddTransaction: () => void;
    onExportCSV: () => void;
    onImportCSV: (file: File | undefined) => void;
    onClearTransactions: () => void;
}

/**
 * Panel for managing transactions, used inside a Modal.
 */
export default function ManageTransactionsPanel({
    onAddTransaction,
    onExportCSV,
    onImportCSV,
    onClearTransactions,
}: ManageTransactionsPanelProps) {
    const [isImporting, setIsImporting] = useState(false);
    const [isClearing, setIsClearing] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    return (
        <>
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

                <button>
                    <label className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800 hover:text-white transition-all">
                        {isImporting ? (
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
                            onChange={async (e) => {
                                setIsImporting(true);
                                await onImportCSV(e?.target?.files?.[0]);
                                setIsImporting(false);
                                if (fileInputRef.current) fileInputRef.current.value = "";
                            }}
                            disabled={isImporting}
                        />
                    </label>
                </button>

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
        </>
    );
}
