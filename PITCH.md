# FastPay

**Stripe Payment Links, but the blockchain is the receipt — nobody can fake "paid," including us.**

---

## The Problem

Getting paid in USDC today means sharing a 56-character address and hoping the sender types it correctly — no link, no receipt, no confirmation a normal person can read. If something goes wrong, there is no dispute flow, no transaction record the payer can show you, and no way to know whether "I sent it" means it actually arrived.

## The Solution

FastPay generates a payment link per invoice. The payer clicks the link, connects their wallet, and pays. The blockchain itself confirms the payment — the frontend and backend can't fake "paid," and neither can we. Merchants receive funds directly to their own Stellar wallet: no custody, no payout delays, no platform risk between invoice creation and settlement.

The trust model is legible: FastPay is the link generator and the UX layer. Stellar is the receipt.

## Why Now

Stablecoin payment rails are live and production-ready, but the UX hasn't caught up. A freelancer in Lagos or a small agency in Manila already uses USDC — they just have no way to send a payment request that works like a Stripe link or a Venmo request. FastPay is the missing translation layer: the familiar "share a link, get paid" experience, with on-chain settlement.

## Why This Team

The hardest part of a payment product is proving a payment happened — with correct money math, atomic state transitions, and reconciliation you can audit. That's built, tested, and running on Stellar testnet. The rest is UX.

## Status

Pre-pilot. Testnet-ready. Three repos (backend, frontend, contract) all building and testing green.

Targeting a **5–15 merchant testnet pilot** — crypto-native freelancers, small agencies, and cross-border gig workers who already hold USDC and want a payment link that works.

---

*Technical appendix: Node.js 22 backend, Next.js 14 frontend, Rust policy contracts, PostgreSQL, Stellar Horizon. Non-custodial. Submit-and-verify model: backend fetches from Horizon to confirm payment on-chain before marking invoice paid.*
