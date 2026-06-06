import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
    Credentials({
      name: "Development Login",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "test@example.com" },
        name: { label: "Name", type: "text", placeholder: "Test User" },
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
              name: (credentials.name as string) || "Test User",
            },
          });
        }
        
        return user;
      },
    }),
  ],
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
