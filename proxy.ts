import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

const WORKSPACE_PATH = "/app/check";
const LEGACY_SESSION_COOKIES = ["abn_guard_session", "abn_guard_managed_session"];

// "/" is a static landing page. Send visitors who are already signed in straight to the workspace,
// unless they were sent here to sign in again (?signin=1 / ?auth_error=…), which would loop.
function shouldOpenWorkspace(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  return pathname === "/" && !searchParams.has("signin") && !searchParams.has("auth_error");
}

function hasLegacySession(request: NextRequest) {
  return LEGACY_SESSION_COOKIES.some((name) => Boolean(request.cookies.get(name)?.value));
}

function redirectToWorkspace(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = WORKSPACE_PATH;
  url.search = "";
  return NextResponse.redirect(url);
}

const withClerk = clerkMiddleware(async (auth, request) => {
  if (!shouldOpenWorkspace(request)) return;
  if (hasLegacySession(request)) return redirectToWorkspace(request);
  const { userId } = await auth();
  if (userId) return redirectToWorkspace(request);
});

export default function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!process.env.CLERK_SECRET_KEY?.trim() || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()) {
    return shouldOpenWorkspace(request) && hasLegacySession(request) ? redirectToWorkspace(request) : NextResponse.next();
  }
  return withClerk(request, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|m?js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
