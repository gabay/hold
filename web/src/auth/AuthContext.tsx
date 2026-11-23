import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AuthProviders, User } from "@/types";

interface AuthContextValue {
    user: User | null;
    loading: boolean;
    providers: AuthProviders | null;
    loginOIDC: () => void;
    loginDemo: () => Promise<void>;
    logout: () => Promise<void>;
    refreshSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);
    const [providers, setProviders] = useState<AuthProviders | null>(null);

    const refreshSession = useCallback(async () => {
        try {
            const res = await fetch("/api/auth/session", { cache: "no-store" });
            if (!res.ok) {
                setUser(null);
                return;
            }
            const data: { user: User | null } = await res.json();
            setUser(data.user ?? null);
        } catch (err) {
            console.error("Error loading auth session:", err);
            setUser(null);
        }
    }, []);

    useEffect(() => {
        let active = true;
        refreshSession().finally(() => {
            if (active) setLoading(false);
        });
        return () => {
            active = false;
        };
    }, [refreshSession]);

    useEffect(() => {
        if (!loading && !user && providers === null) {
            fetch("/api/auth/providers", { cache: "no-store" })
                .then((res) => {
                    if (!res.ok) throw new Error("Failed to load providers");
                    return res.json();
                })
                .then((data: AuthProviders) => setProviders(data))
                .catch((err) => {
                    console.error("Error loading auth providers:", err);
                    setProviders({});
                });
        }
    }, [loading, user, providers]);

    const loginOIDC = useCallback(() => {
        window.location.assign("/api/auth/login/oidc");
    }, []);

    const loginDemo = useCallback(async () => {
        const res = await fetch("/api/auth/demo", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: "test@example.com", name: "User" }),
        });
        if (!res.ok) {
            throw new Error("Failed to sign in with demo account");
        }
        await refreshSession();
    }, [refreshSession]);

    const logout = useCallback(async () => {
        try {
            await fetch("/api/auth/logout", { method: "POST" });
        } finally {
            setUser(null);
        }
    }, []);

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                providers,
                loginOIDC,
                loginDemo,
                logout,
                refreshSession,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth(): AuthContextValue {
    const ctx = useContext(AuthContext);
    if (!ctx) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return ctx;
}
