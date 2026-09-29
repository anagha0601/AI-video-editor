import type { NextAuthConfig } from "next-auth";

// Edge-safe part of the Auth.js config (used by middleware). The Credentials
// provider, which needs Prisma + bcrypt, is added in src/auth.ts.
export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      const protectedPath = /^\/(dashboard|projects|media)(\/|$)/.test(path);
      if (protectedPath) return Boolean(auth?.user);
      return true;
    },
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.uid && session.user) session.user.id = token.uid as string;
      return session;
    },
  },
} satisfies NextAuthConfig;
