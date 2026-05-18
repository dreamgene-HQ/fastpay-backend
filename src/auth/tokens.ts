import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import { env } from "../env.js";

const sessionSchema = z.object({
  sub: z.string().uuid(),
  email: z.string().email()
});

export type Session = z.infer<typeof sessionSchema>;

const secret = new TextEncoder().encode(env.JWT_SECRET);

export async function signAccessToken(session: Session) {
  return new SignJWT(session)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${env.JWT_EXPIRY_SECONDS}s`)
    .sign(secret);
}

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, secret);
  return sessionSchema.parse(payload);
}
