import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

// Edge middleware: redirects signed-out visitors away from the studio pages.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/dashboard/:path*", "/projects/:path*", "/media/:path*", "/jobs/:path*"],
};
