import type { IncomingMessage } from "node:http";

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

type Bucket = { count: number; resetAt: number };

/**
 * Simple in-memory fixed-window rate limiter, keyed by an arbitrary string
 * (typically a client IP). Not shared across processes - sufficient to blunt
 * single-instance abuse without adding an external dependency.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  consume(key: string, now: number = Date.now()): RateLimitResult {
    const bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return { allowed: true };
    }

    if (bucket.count >= this.maxRequests) {
      return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
    }

    bucket.count += 1;
    return { allowed: true };
  }
}

export function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}
