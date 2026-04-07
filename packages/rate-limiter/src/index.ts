import { rateLimit, Options as RateLimitOptions } from "express-rate-limit";
import RedisStore from "rate-limit-redis";
import Redis from "ioredis";
import { Request, Response } from "express";

// ============================================================
// Redis Connection Configuration
// ============================================================

let redisClient: Redis | null = null;

export const getRedisClient = (): Redis => {
    if (!redisClient) {
        redisClient = new Redis({
            host: process.env.REDIS_HOST || "localhost",
            port: parseInt(process.env.REDIS_PORT || "6379"),
            password: process.env.REDIS_PASSWORD || undefined,
            keyPrefix: "ratelimit:",
            retryStrategy: (times: number) => {
                if (times > 10) {
                    console.error(
                        "[RateLimiter] Redis connection failed after 10 retries"
                    );
                    return null;
                }
                return Math.min(times * 100, 3000);
            },
        });

        redisClient.on("error", (err) => {
            console.error("[RateLimiter] Redis error:", err.message);
        });

        redisClient.on("connect", () => {
            console.log("[RateLimiter] Connected to Redis");
        });
    }
    return redisClient;
};

// ============================================================
// Rate Limit Configuration Presets
// ============================================================

export interface RateLimitPreset {
    windowMs: number;
    max: number;
    message: string;
    statusCode: number;
}

export const RATE_LIMIT_PRESETS: Record<string, RateLimitPreset> = {
    publicRead: {
        windowMs: 60 * 1000,
        max: 100,
        message: "Too many requests, please try again later.",
        statusCode: 429,
    },
    publicReadRelaxed: {
        windowMs: 60 * 1000,
        max: 200,
        message: "Too many requests, please try again later.",
        statusCode: 429,
    },
    authenticated: {
        windowMs: 60 * 1000,
        max: 150,
        message: "Too many requests, please try again later.",
        statusCode: 429,
    },
    writeOperations: {
        windowMs: 60 * 1000,
        max: 30,
        message: "Too many write requests, please try again later.",
        statusCode: 429,
    },
    externalApi: {
        windowMs: 60 * 1000,
        max: 20,
        message: "Rate limit exceeded for external API. Please wait before trying again.",
        statusCode: 429,
    },
    fileUploads: {
        windowMs: 60 * 1000,
        max: 5,
        message: "Too many upload requests, please try again later.",
        statusCode: 429,
    },
    authEndpoints: {
        windowMs: 15 * 60 * 1000,
        max: 10,
        message: "Too many authentication attempts, please try again later.",
        statusCode: 429,
    },
    critical: {
        windowMs: 60 * 1000,
        max: 10,
        message: "Too many requests, please try again later.",
        statusCode: 429,
    },
};

// ============================================================
// Key Generator Functions
// ============================================================

export const generateKey = (req: Request): string => {
    const userId = (req as any).userId;
    const apiKey = req.headers["x-api-key"] as string;
    const ip = req.ip || req.socket.remoteAddress;

    if (userId) return `user:${userId}`;
    if (apiKey) return `apikey:${apiKey}`;
    return `ip:${ip}`;
};

export const generateStrictIPKey = (req: Request): string => {
    return `ip:${req.ip || req.socket.remoteAddress}`;
};

// ============================================================
// Handler Functions
// ============================================================

export const rateLimitHandler = (req: Request, res: Response) => {
    const userId = (req as any).userId;
    const key = generateKey(req);

    console.warn(
        `[RateLimiter] Rate limit exceeded: ${key}`,
        `Path: ${req.path}`,
        `Method: ${req.method}`,
        `User: ${userId || "anonymous"}`
    );

    res.status(429).json({
        error: "Too Many Requests",
        //@ts-ignore
        message: req.rateLimit
            //@ts-ignore
            ? `Rate limit exceeded. Try again in ${Math.ceil(req.rateLimit.resetTime! - Date.now() / 1000)} seconds.`
            : "Rate limit exceeded. Please try again later.",
        //@ts-ignore
        retryAfter: req.rateLimit?.resetTime
            //@ts-ignore
            ? Math.ceil((req.rateLimit.resetTime.getTime() - Date.now()) / 1000)
            : 60,
        path: req.path,
    });
};

// ============================================================
// Skip Function - Bypass rate limiting for certain requests
// ============================================================

export const skipRateLimit = (req: Request): boolean => {
    if (process.env.NODE_ENV === "development" && process.env.DISABLE_RATE_LIMIT === "true") {
        return true;
    }

    if (req.path === "/health" || req.path === "/ready") {
        return true;
    }

    const internalToken = req.headers["x-internal-token"];
    if (internalToken === process.env.INTERNAL_SERVICE_TOKEN) {
        return true;
    }

    const userRole = (req as any).userRole;
    if (userRole === "superadmin" && process.env.SKIP_RATE_LIMIT_FOR_ADMINS === "true") {
        return true;
    }

    return false;
};

// ============================================================
// Factory Function - Create rate limiters
// ============================================================

export interface CreateRateLimiterOptions {
    preset: keyof typeof RATE_LIMIT_PRESETS;
    customOptions?: Partial<RateLimitOptions>;
    useRedis?: boolean;
}

export const createRateLimiter = (options: CreateRateLimiterOptions) => {
    const preset = RATE_LIMIT_PRESETS[options.preset];
    const useRedis = options.useRedis !== false && process.env.REDIS_HOST;

    const baseConfig: RateLimitOptions = {
        //@ts-ignore
        windowMs: preset.windowMs,
        //@ts-ignore
        max: preset.max,
        message: {
            error: "Too Many Requests",
            //@ts-ignore
            message: preset.message,
        },
        //@ts-ignore
        statusCode: preset.statusCode,
        keyGenerator: generateKey,
        handler: rateLimitHandler,
        skip: skipRateLimit,
        standardHeaders: true,
        legacyHeaders: false,
        requestWasSuccessful: (req, res) => res.statusCode < 400,
        //@ts-ignore
        trustProxy: true,
    };

    if (useRedis) {
        baseConfig.store = new RedisStore({
            //@ts-ignore
            sendCommand: (...args: string[]) => getRedisClient().call(...args),
            prefix: "ratelimit:",
        });
    }

    return rateLimit({
        ...baseConfig,
        ...options.customOptions,
    });
};

// ============================================================
// Pre-configured Rate Limiters
// ============================================================

export const rateLimiters = {
    publicRead: createRateLimiter({ preset: "publicRead" }),
    publicReadRelaxed: createRateLimiter({ preset: "publicReadRelaxed" }),
    authenticated: createRateLimiter({ preset: "authenticated" }),
    writeOperations: createRateLimiter({ preset: "writeOperations" }),
    externalApi: createRateLimiter({ preset: "externalApi" }),
    fileUploads: createRateLimiter({ preset: "fileUploads" }),
    authEndpoints: createRateLimiter({ preset: "authEndpoints" }),
    critical: createRateLimiter({ preset: "critical" }),
};

export default rateLimiters;
