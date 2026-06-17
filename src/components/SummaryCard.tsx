"use client";

import React from "react";

interface SummaryCardProps {
    title: string;
    content: React.ReactElement;
    icon: React.ReactElement;
}

export default function SummaryCard({ title, content, icon }: SummaryCardProps) {
    return (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 shadow-md flex items-center justify-between">
            <div className="space-y-1">
                <p className="text-sm font-medium text-slate-400">{title}</p>
                {content}
            </div>
            {icon}
        </div>
    );
}
