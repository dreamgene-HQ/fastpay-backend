import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

const params = { N: 32_768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const keyLength = 64;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = await scryptAsync(password, salt, keyLength, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, encodedHash: string) {
  const [scheme, n, r, p, salt, hash] = encodedHash.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "base64url");
  const actual = await scryptAsync(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: params.maxmem
  });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
