"use client";

import { useEffect } from "react";

interface ManageTransactionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    content: React.ReactNode;
}

export default function ManageTransactionsModal({
    isOpen,
    onClose,
    title,
    content,
}: ManageTransactionsModalProps) {
    // ESC key listener
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && isOpen) onClose();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex justify-between items-center">
                    <h2 className="text-lg font-bold text-slate-100">{title}</h2>

                    <button
                        onClick={onClose}
                        className="text-sm font-semibold text-slate-400 hover:text-white"
                    >
                        Close
                    </button>
                </div>

                {content}
            </div>
        </div>
    );
}
