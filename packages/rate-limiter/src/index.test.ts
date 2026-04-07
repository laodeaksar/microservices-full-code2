import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RATE_LIMIT_PRESETS, generateKey, skipRateLimit } from "./index";

describe("Rate Limiter Configuration", () => {
  it("should have all required presets", () => {
    const requiredPresets = [
      "publicRead",
      "publicReadRelaxed",
      "authenticated",
      "writeOperations",
      "externalApi",
      "fileUploads",
      "authEndpoints",
      "critical",
    ];

    requiredPresets.forEach((preset) => {
      expect(RATE_LIMIT_PRESETS[preset]).toBeDefined();
      //@ts-ignore
      expect(RATE_LIMIT_PRESETS[preset].windowMs).toBeGreaterThan(0);
      //@ts-ignore
      expect(RATE_LIMIT_PRESETS[preset].max).toBeGreaterThan(0);
      //@ts-ignore
      expect(RATE_LIMIT_PRESETS[preset].statusCode).toBe(429);
    });
  });

  it("should generate correct key for user", () => {
    const req = { userId: "user123" } as any;
    expect(generateKey(req)).toBe("user:user123");
  });

  it("should generate correct key for API key", () => {
    const req = { headers: { "x-api-key": "key123" } } as any;
    expect(generateKey(req)).toBe("apikey:key123");
  });

  it("should generate correct key for IP", () => {
    const req = { ip: "192.168.1.1" } as any;
    expect(generateKey(req)).toBe("ip:192.168.1.1");
  });

  it("should skip rate limiting for health endpoints", () => {
    const req = { path: "/health" } as any;
    expect(skipRateLimit(req)).toBe(true);
  });

  it("should skip rate limiting for ready endpoint", () => {
    const req = { path: "/ready" } as any;
    expect(skipRateLimit(req)).toBe(true);
  });
});
