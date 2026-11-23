import { Loader2 } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import Dashboard from "@/components/Dashboard";
import Login from "@/components/Login";

export default function App() {
    const { user, loading, providers } = useAuth();

    if (loading) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-slate-950">
                <Loader2 className="h-8 w-8 animate-spin text-sky-400" />
            </div>
        );
    }

    if (!user) {
        return <Login providers={providers} />;
    }

    return <Dashboard user={user} />;
}
