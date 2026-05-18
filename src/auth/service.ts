import { loginSchema, registerSchema, type AuthTokens } from "../contracts.js";
import { query, transaction } from "../database/pool.js";
import { env } from "../env.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { signAccessToken } from "./tokens.js";

type MerchantRow = {
  id: string;
  business_name: string;
  email: string;
  password_hash: string;
};

export async function registerMerchant(input: unknown): Promise<AuthTokens> {
  const dto = registerSchema.parse(input);
  const email = dto.email.toLowerCase();
  const passwordHash = await hashPassword(dto.password);

  const merchant = await transaction(async (client) => {
    const result = await client.query<MerchantRow>(
      `INSERT INTO merchants (business_name, email, password_hash, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id, business_name, email, password_hash`,
      [dto.businessName, email, passwordHash]
    );
    return result.rows[0];
  });

  return tokensForMerchant(merchant);
}

export async function loginMerchant(input: unknown): Promise<AuthTokens | null> {
  const dto = loginSchema.parse(input);
  const result = await query<MerchantRow>(
    `SELECT id, business_name, email, password_hash
     FROM merchants
     WHERE lower(email) = lower($1)
     LIMIT 1`,
    [dto.email]
  );

  const merchant = result.rows[0];
  if (!merchant || !(await verifyPassword(dto.password, merchant.password_hash))) {
    return null;
  }

  return tokensForMerchant(merchant);
}

async function tokensForMerchant(merchant: MerchantRow): Promise<AuthTokens> {
  const accessToken = await signAccessToken({ sub: merchant.id, email: merchant.email });
  return {
    accessToken,
    expiresIn: env.JWT_EXPIRY_SECONDS,
    merchant: {
      id: merchant.id,
      businessName: merchant.business_name,
      email: merchant.email
    }
  };
}
