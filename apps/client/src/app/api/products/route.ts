import { checkRateLimit } from "@/lib/rate-limiter";
import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;


export async function GET(request: Request) {
  const { userId } = await auth();
  const ip =
    request.headers.get("x-forwarded-for") ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const key = userId
    ? `user:${userId}:products`
    : `ip:${ip}:products`;

  const result = await checkRateLimit(key, 100, 60);

  const headers = new Headers();
  //@ts-ignore
  headers.set("RateLimit-Limit", result.limit.toString());
  headers.set("RateLimit-Remaining", result.remaining.toString());
  //@ts-ignore
  headers.set("RateLimit-Reset", result.reset.toString());

  //@ts-ignore
  if (!result.success) {
    headers.set("Retry-After", "60");
    return NextResponse.json(
      {
        error: "Too Many Requests",
        message: "Rate limit exceeded. Please try again later.",
        retryAfter: 60,
      },
      { status: 429, headers }
    );
  }

  try {
    console.log("API Route: Fetching products from product service");
    const response = await fetch("http://localhost:8000/products", {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.error(
        "API Route: Failed to fetch products",
        response.status,
        response.statusText,
      );
      return NextResponse.json(
        { error: "Failed to fetch products" },
        { status: response.status },
      );
    }

    const products = await response.json();
    console.log("API Route: Successfully fetched products");

    return NextResponse.json(products);
  } catch (error) {
    console.error("API Route: Error fetching products:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
