"use client";

import { Loader2 } from "lucide-react";
import { Provider } from "next-auth/providers";
import { signIn } from "next-auth/react";

interface LoginProps {
    providers: Record<string, Provider>;
}

export default function Login({ providers }: LoginProps) {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12 sm:px-6 lg:px-8 bg-slate-950 text-slate-100">
            <div className="w-full max-w-md space-y-8 bg-slate-900/60 backdrop-blur-md p-8 rounded-2xl shadow-xl border border-slate-800">
                <div className="text-center flex flex-col items-center">
                    <picture>
                        <img
                            src="/icon.png"
                            alt="Hold Logo"
                            className="h-16 w-16 rounded-2xl shadow-lg border border-slate-800"
                        />
                    </picture>
                    <h2 className="mt-4 text-3xl font-extrabold tracking-tight bg-linear-to-r from-sky-400 to-blue-500 bg-clip-text text-transparent">
                        Hold
                    </h2>
                    <p className="mt-2 text-sm text-slate-400">Simple Portfolio Tracker</p>
                </div>
                <div className="mt-8 space-y-4">
                    {!providers && (
                        <div className="flex justify-center py-4">
                            <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
                        </div>
                    )}

                    {providers && providers.oidc && (
                        <button
                            onClick={() => signIn("oidc")}
                            className="group relative flex w-full justify-center rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 transition-all shadow-md shadow-sky-900/20"
                        >
                            Sign in with {providers.oidc.name || "OIDC"}
                        </button>
                    )}

                    {providers && providers.credentials && (
                        <>
                            {providers.oidc && (
                                <div className="relative flex py-4 items-center">
                                    <div className="grow border-t border-slate-800"></div>
                                    <span className="shrink mx-4 text-slate-500 text-xs uppercase font-medium">
                                        Or Demo Logins
                                    </span>
                                    <div className="grow border-t border-slate-800"></div>
                                </div>
                            )}
                            <button
                                onClick={() =>
                                    signIn("credentials", {
                                        email: "test@example.com",
                                        name: "User",
                                    })
                                }
                                className="flex w-full justify-center rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm font-semibold text-slate-300 hover:bg-slate-800 hover:text-white focus:outline-none focus:ring-2 focus:ring-slate-700 transition-all"
                            >
                                Access Demo Portfolio
                            </button>
                        </>
                    )}

                    {providers && Object.keys(providers).length === 0 && (
                        <div className="text-center py-4 text-sm text-slate-400">
                            No sign-in methods are currently enabled. Please check server
                            configurations.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
