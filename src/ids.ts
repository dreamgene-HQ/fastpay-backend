import { randomBytes } from "node:crypto";

export function publicId(prefix: string) {
  return `${prefix}_${randomBytes(16).toString("base64url")}`;
}

export function uint63String() {
  const bytes = randomBytes(8);
  bytes[0] &= 0x7f;
  return BigInt(`0x${bytes.toString("hex")}`).toString();
}
