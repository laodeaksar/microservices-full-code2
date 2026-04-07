/*import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ============================================================
// Rate Limit Configuration
// ============================================================

const rateLimitConfig: Record<string, { max: number; windowMs: number }> = {
  "/api/categories": { max: 100, windowMs: 60 * 1000 },
  "/api/products": { max: 100, windowMs: 60 * 1000 },
  "/api/hero-products": { max: 200, windowMs: 60 * 1000 },
};

export default clerkMiddleware(
  (auth, request: NextRequest) => {
    const response = NextResponse.next();

    // Add performance and caching headers
    const { pathname } = request.nextUrl;

    // Cache static assets aggressively
    if (
      pathname.startsWith("/_next/static/") ||
      pathname.match(
        /\.(jpg|jpeg|png|gif|svg|webp|avif|ico|woff|woff2|ttf|eot)$/i,
      )
    ) {
      response.headers.set(
        "Cache-Control",
        "public, max-age=31536000, immutable",
      );
    }

    // Cache Cloudinary images
    if (pathname.includes("cloudinary.com")) {
      response.headers.set(
        "Cache-Control",
        "public, max-age=86400, stale-while-revalidate=43200",
      );
    }

    // Add security headers
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("X-XSS-Protection", "1; mode=block");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("X-DNS-Prefetch-Control", "on");

    return response;
  },
  {
    debug: process.env.NODE_ENV === "development",
    signInUrl: "/sign-in",
    signUpUrl: "/sign-up",
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

// ============================================================
// Rate Limit Configuration
// ============================================================

const rateLimitConfig: Record<string, { max: number; windowMs: number }> = {
  "/api/categories": { max: 100, windowMs: 60 * 1000 },
  "/api/products": { max: 100, windowMs: 60 * 1000 },
  "/api/hero-products": { max: 200, windowMs: 60 * 1000 },
};

export default clerkMiddleware(
  async (auth, request: NextRequest) => {
    const { pathname } = request.nextUrl;

    // ============================================================
    // Rate Limiting for API Routes
    // ============================================================
    for (const [prefix, config] of Object.entries(rateLimitConfig)) {
      if (pathname.startsWith(prefix)) {
        // Generate rate limit key
        const { userId } = await auth();
        const ip =
          request.headers.get("x-forwarded-for") ||
          request.headers.get("x-real-ip") ||
          "unknown";
        const rateLimitKey = userId
          ? `user:${userId}:${prefix}`
          : `ip:${ip}:${prefix}`;

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
                "X-RateLimit-Limit": config.max.toString(),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": Math.ceil(result.resetTime / 1000).toString(),
              },
            }
          );
        }

        // Continue with rate limit headers on successful responses
        const response = NextResponse.next();
        response.headers.set("RateLimit-Limit", config.max.toString());
        response.headers.set("RateLimit-Remaining", result.remaining.toString());
        response.headers.set(
          "RateLimit-Reset",
          Math.ceil(result.resetTime / 1000).toString()
        );
        response.headers.set("X-RateLimit-Limit", config.max.toString());
        response.headers.set("X-RateLimit-Remaining", result.remaining.toString());
        response.headers.set(
          "X-RateLimit-Reset",
          Math.ceil(result.resetTime / 1000).toString()
        );

        // Add security headers
        response.headers.set("X-Content-Type-Options", "nosniff");
        response.headers.set("X-Frame-Options", "DENY");
        response.headers.set("X-XSS-Protection", "1; mode=block");
        response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
        response.headers.set("X-DNS-Prefetch-Control", "on");

        // Cache static assets
        if (
          pathname.startsWith("/_next/static/") ||
          pathname.match(
            /\.(jpg|jpeg|png|gif|svg|webp|avif|ico|woff|woff2|ttf|eot)$/i
          )
        ) {
          response.headers.set(
            "Cache-Control",
            "public, max-age=31536000, immutable"
          );
        }

        return response;
      }
    }

    // ============================================================
    // Non-API routes - security headers only
    // ============================================================
    const response = NextResponse.next();
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("X-XSS-Protection", "1; mode=block");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("X-DNS-Prefetch-Control", "on");

    // Cache static assets
    if (
      pathname.startsWith("/_next/static/") ||
      pathname.match(
        /\.(jpg|jpeg|png|gif|svg|webp|avif|ico|woff|woff2|ttf|eot)$/i
      )
    ) {
      response.headers.set(
        "Cache-Control",
        "public, max-age=31536000, immutable"
      );
    }

    return response;
  },
  {
    debug: process.env.NODE_ENV === "development",
    signInUrl: "/sign-in",
    signUpUrl: "/sign-up",
  }
);

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};

