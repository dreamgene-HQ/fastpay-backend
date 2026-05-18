import * as StellarSdk from "@stellar/stellar-sdk";
import { env } from "./env.js";

export function usdcAsset() {
  return new StellarSdk.Asset(env.STELLAR_ASSET_CODE, env.STELLAR_ASSET_ISSUER);
}

export function makeMuxedTreasuryAddress(muxedId: string) {
  const base = new StellarSdk.Account(env.PLATFORM_TREASURY_PUBLIC_KEY, "0");
  return new StellarSdk.MuxedAccount(base, muxedId).accountId();
}

export function horizonServer() {
  return new StellarSdk.Horizon.Server(env.STELLAR_HORIZON_URL);
}

export async function preparePaymentTransaction(input: {
  payer: string;
  destination: string;
  amount: string;
  memo: string;
}) {
  const account = await horizonServer().loadAccount(input.payer);
  return new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: env.STELLAR_NETWORK_PASSPHRASE
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: input.destination,
        asset: usdcAsset(),
        amount: input.amount
      })
    )
    .addMemo(StellarSdk.Memo.id(input.memo))
    .setTimeout(300)
    .build()
    .toXDR();
}
