import { NextResponse, type NextRequest } from "next/server";

// Cheap cookie-presence gate; pages and API routes verify the session signature themselves.
export function middleware(req: NextRequest) {
  if (!req.cookies.has("rs_session")) {
    const url = new URL("/login", req.url);
    url.searchParams.set("next", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/create/:path*", "/projects/:path*", "/billing/:path*"],
};
