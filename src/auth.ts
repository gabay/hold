import { db } from "@/lib/db";
import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";

// Construct providers array dynamically
const providers: Provider[] = [];

if (process.env.ALLOW_DEMO_LOGIN === "true") {
    providers.push(
        Credentials({
            name: "User",
            credentials: {
                email: { label: "Email", type: "email", placeholder: "test@example.com" },
                name: { label: "Name", type: "text", placeholder: "User" },
            },
            async authorize(credentials) {
                if (!credentials?.email) return null;

                let user = await db.user.findUnique({
                    where: { email: credentials.email as string },
                });

                if (!user) {
                    user = await db.user.create({
                        data: {
                            email: credentials.email as string,
                            name: (credentials.name as string) || "User",
                        },
                    });
                }

                return user;
            },
        }),
    );
}

// If dynamic OIDC issuer is configured in env, push generic OIDC provider configuration
if (process.env.AUTH_OIDC_ISSUER && process.env.AUTH_OIDC_CLIENT_ID) {
    providers.push({
        id: "oidc",
        name: process.env.AUTH_OIDC_NAME || "OIDC",
        type: "oidc",
        issuer: process.env.AUTH_OIDC_ISSUER,
        clientId: process.env.AUTH_OIDC_CLIENT_ID,
        clientSecret: process.env.AUTH_OIDC_CLIENT_SECRET,
        authorization: { params: { scope: "openid profile" } },
    });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
    adapter: PrismaAdapter(db),
    providers,
    callbacks: {
        async jwt({ token, user }) {
            if (user) {
                token.id = user.id;
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user && token) {
                session.user.id = token.id as string;
            }
            return session;
        },
    },
    session: {
        strategy: "jwt",
    },
});
