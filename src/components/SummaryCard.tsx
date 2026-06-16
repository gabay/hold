"use client";

import React from "react";

interface SummaryCardProps {
    title: string;
    content: string | React.ReactElement;
    color: string;
    icon: React.ReactElement;
}

export default function SummaryCard({ title, content, color, icon }: SummaryCardProps) {
    return (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-md flex items-center justify-between">
            <div className="space-y-1">
                <p className="text-sm font-medium text-slate-400">{title}</p>
                {typeof content === "string" ? (
                    <p className="text-3xl font-bold tracking-tight text-white">{content}</p>
                ) : (
                    content
                )}
            </div>
            <div
                className={`rounded-xl bg-${color}-950/40 text-${color}-400 border border-${color}-900/30 p-3`}
            >
                {icon}
            </div>
        </div>
    );
}
