/*import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { CustomJwtSessionClaims } from "@repo/types";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher(["/sign-in(.*)", "/unauthorized(.*)"]);

export default clerkMiddleware(
  async (auth, req) => {
    const { pathname } = req.nextUrl;

    // Allow public routes
    if (isPublicRoute(req)) {
      return NextResponse.next();
    }

    // Get auth state without throwing
    const { userId, sessionClaims } = await auth();

    // If not authenticated, redirect to sign-in
    if (!userId) {
      const signInUrl = new URL("/sign-in", req.url);
      signInUrl.searchParams.set("redirect_url", pathname);
      return NextResponse.redirect(signInUrl);
    }

    // Check admin role
    if (sessionClaims) {
      const claims = sessionClaims as CustomJwtSessionClaims;

      // Only log in development for debugging
      if (process.env.NODE_ENV === "development") {
        console.log(
          "Session Claims:",
          JSON.stringify(
            {
              userId,
              publicMetadata: claims.publicMetadata,
              metadata: claims.metadata,
              hasPublicMetadata: !!claims.publicMetadata,
              hasMetadata: !!claims.metadata,
            },
            null,
            2,
          ),
        );
      }

      // Check both publicMetadata and metadata for the role
      const userRole = claims.publicMetadata?.role || claims.metadata?.role;

      // Check if user has admin role
      if (userRole !== "admin") {
        if (process.env.NODE_ENV === "development") {
          console.log(
            `Access denied for user ${userId}. Role: ${userRole || "none"}. Redirecting to /unauthorized`,
          );
        }

        // Avoid redirect loop - if already on unauthorized page, allow it
        if (pathname === "/unauthorized") {
          return NextResponse.next();
        }

        return NextResponse.redirect(new URL("/unauthorized", req.url));
      }
    }

    return NextResponse.next();
  },
  {
    // Enable debug mode only in development
    debug: process.env.NODE_ENV === "development",
    signInUrl: "/sign-in",
  },
);

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};*/

import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rate-limiter";

// Admin-specific rate limit configuration (more permissive for authenticated admins)
const rateLimitConfig: Record<string, { max: number; windowMs: number }> = {
  "/api/categories": { max: 150, windowMs: 60 * 1000 },
  "/api/products": { max: 150, windowMs: 60 * 1000 },
  "/api/users": { max: 100, windowMs: 60 * 1000 },
  "/api/orders": { max: 100, windowMs: 60 * 1000 },
};

export default clerkMiddleware(
  async (auth, request: NextRequest) => {
    const { pathname } = request.nextUrl;

    // Rate limiting for API routes
    for (const [prefix, config] of Object.entries(rateLimitConfig)) {
      if (pathname.startsWith(prefix)) {
        const { userId } = await auth();
        const ip =
          request.headers.get("x-forwarded-for") ||
          request.headers.get("x-real-ip") ||
          "unknown";
        const rateLimitKey = userId
          ? `admin-user:${userId}:${prefix}`
          : `admin-ip:${ip}:${prefix}`;

        const result = await checkRateLimit(
          rateLimitKey,
          config.max,
          config.windowMs
        );

        if (!result.allowed) {
          const retryAfter = Math.ceil(
            (result.resetTime - Date.now()) / 1000
          );

          return new NextResponse(
            JSON.stringify({
              error: "Too Many Requests",
              message: "Rate limit exceeded. Please try again later.",
              retryAfter,
            }),
            {
              status: 429,
              headers: {
                "Content-Type": "application/json",
                "Retry-After": retryAfter.toString(),
                "RateLimit-Limit": config.max.toString(),
                "RateLimit-Remaining": "0",
                "RateLimit-Reset": Math.ceil(result.resetTime / 1000).toString(),
              },
            }
          );
        }

        const response = NextResponse.next();
        response.headers.set("RateLimit-Limit", config.max.toString());
        response.headers.set("RateLimit-Remaining", result.remaining.toString());
        response.headers.set(
          "RateLimit-Reset",
          Math.ceil(result.resetTime / 1000).toString()
        );

        return response;
      }
    }

    return NextResponse.next();
  },
  {
    debug: process.env.NODE_ENV === "development",
    signInUrl: "/sign-in",
  }
);

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};

