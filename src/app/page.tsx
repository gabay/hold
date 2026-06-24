"use client";

import { Loader2 } from "lucide-react";
import { useSession } from "next-auth/react";
import Dashboard from "@/components/Dashboard";
import Login from "@/components/Login";
import { useEffect, useState } from "react";
import { Provider } from "next-auth/providers";

export default function Page() {
    const { data, status } = useSession();
    const [activeProviders, setActiveProviders] = useState<Record<string, Provider> | null>(null);

    useEffect(() => {
        if (status === "unauthenticated" && activeProviders === null) {
            fetch("/api/auth/providers")
                .then((res) => {
                    if (!res.ok) throw new Error("Failed to load providers");
                    return res.json();
                })
                .then(setActiveProviders)
                .catch((err) => {
                    console.error("Error loading auth providers:", err);
                });
        }
    }, [status, activeProviders]);

    switch (status) {
        case "loading":
            return <Loading />;
        case "unauthenticated":
            return <Login providers={activeProviders || {}} />;
        case "authenticated":
            return <Dashboard user={data.user!} />;
        default:
            throw new Error("Unknown status: " + status);
    }
}

function Loading() {
    return (
        <div className="flex h-screen w-screen items-center justify-center bg-slate-950">
            <Loader2 className="h-8 w-8 animate-spin text-sky-400" />
        </div>
    );
}
