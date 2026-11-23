import { Loader2 } from "lucide-react";
import Modal from "./Modal";

interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
    loading?: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

export default function ConfirmModal({
    isOpen,
    title,
    message,
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    destructive = true,
    loading = false,
    onConfirm,
    onCancel,
}: ConfirmModalProps) {
    return (
        <Modal
            isOpen={isOpen}
            onClose={onCancel}
            title={title}
            content={
                <div className="space-y-6">
                    <p className="text-sm text-slate-300 leading-relaxed">{message}</p>
                    <div className="flex justify-end gap-3">
                        <button
                            type="button"
                            onClick={onCancel}
                            disabled={loading}
                            className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 hover:text-white transition-all disabled:opacity-50"
                        >
                            {cancelLabel}
                        </button>
                        <button
                            type="button"
                            onClick={onConfirm}
                            disabled={loading}
                            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-all disabled:opacity-50 ${
                                destructive
                                    ? "bg-rose-600 hover:bg-rose-500"
                                    : "bg-sky-600 hover:bg-sky-500"
                            }`}
                        >
                            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                            {confirmLabel}
                        </button>
                    </div>
                </div>
            }
        />
    );
}
