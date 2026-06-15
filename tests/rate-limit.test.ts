import assert from "node:assert/strict";
import test from "node:test";
import { RateLimiter } from "../src/middleware/rate-limit.js";

test("allows requests up to the limit then blocks", () => {
  const limiter = new RateLimiter(2, 1000);
  const now = 0;

  assert.deepEqual(limiter.consume("ip", now), { allowed: true });
  assert.deepEqual(limiter.consume("ip", now), { allowed: true });

  const blocked = limiter.consume("ip", now);
  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) {
    assert.equal(blocked.retryAfterSeconds, 1);
  }
});

test("resets once the window has passed", () => {
  const limiter = new RateLimiter(1, 1000);

  assert.deepEqual(limiter.consume("ip", 0), { allowed: true });
  assert.equal(limiter.consume("ip", 500).allowed, false);
  assert.deepEqual(limiter.consume("ip", 1001), { allowed: true });
});

test("tracks separate keys independently", () => {
  const limiter = new RateLimiter(1, 1000);

  assert.deepEqual(limiter.consume("a", 0), { allowed: true });
  assert.deepEqual(limiter.consume("b", 0), { allowed: true });
  assert.equal(limiter.consume("a", 0).allowed, false);
  assert.equal(limiter.consume("b", 0).allowed, false);
});
