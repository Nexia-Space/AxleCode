# Axle Gateway

The hosted provider behind `axle --provider axle`. It is an OpenAI-compatible
endpoint that authenticates an `AXLE_API_KEY` and meters turns in Axle credits.
The hosted model catalog is currently empty until a provider integration is
explicitly enabled.

## Routes

| Route | Method | Purpose |
| --- | --- | --- |
| `/v1/models` | `GET` | The currently enabled hosted models (empty by default) |
| `/v1/credits` | `GET` | Current balance; renews the free daily grant |
| `/v1/usage` | `GET` | Recent grants and spends behind the balance |
| `/v1/chat/completions` | `POST` | Metered chat completion |
| `/v1/internal/credits` | `POST` | Purchase/plan-grant application (internal token) |
| `/healthz` | `GET` | Liveness |

## Credits

100 credits == $0.50, so one credit is half a cent ($1 == 200 credits). A
balance is split into three buckets, spent in this order:

1. **Free** — 100 credits per UTC day, granted on the first request of the
   day. The bucket **renews**: a new day sets it back to 100, so unused free
   credits never roll over.
2. **Plan** — the monthly allowance an active paid plan grants (Pro 2,000 /
   Pro+ 4,000 / Ultra 10,000). The bucket is set by the plan, never
   accumulated.
3. **Paid** — credits the user bought (from $5). They persist until spent.

`POST /v1/internal/credits` (authorized by `INTERNAL_API_TOKEN`) is how the
account API applies purchases and plan grants after Bachs confirms a payment:
`{ user_id, amount, bucket: "paid" | "plan", reference }`, where `reference`
is the payment event id — a redelivered webhook can never double-credit.

## Models

No hosted models are enabled at present. When a provider is deliberately
enabled, its model and pricing data belong in `src/pricing.js`.

### How a turn is metered

1. The request's `Authorization: Bearer <key>` is resolved into a user id.
2. The daily grant is renewed (once per UTC day).
3. The maximum possible cost of the turn is **reserved** up front, so a
   streamed response can never be free. If the balance is short, the request
   is refused with `402` and `error.code = "axle_insufficient_credits"`.
4. After the upstream reports `usage`, the difference between the reservation
   and the real cost is refunded. Streaming responses carry the same guarantee
   because the gateway asks the upstream for `stream_options.include_usage` and
   settles when the usage chunk arrives.

## Deploy

```sh
cd axle-gateway-worker
wrangler d1 create axle-credits          # paste the id into wrangler.toml
wrangler d1 execute axle-credits --file=migrations/0001_credits.sql --remote
wrangler d1 execute axle-credits --file=migrations/0002_credit_buckets.sql --remote
wrangler secret put INTERNAL_API_TOKEN   # shared with the account API
wrangler secret put ACCOUNT_API_URL     # e.g. https://axle-account.axle-download-worker.workers.dev
wrangler deploy
```

This deployment lives at
`https://axle-gateway.axle-download-worker.workers.dev`, which is the default
`--provider axle` base URL, so the desktop app reaches it with no configuration.

## Identity

`Authorization: Bearer axl_...` is resolved against the account database the
auth worker owns (`ACCOUNTS_DB`), so the balance follows the user's Axle account
and revoking a key stops it on the next request. Any other bearer token is
hashed into a stable id instead, which is what self-hosted deployments use.

Users mint keys from the desktop app under **Settings → Account → API keys**.

## Tests

```sh
npm test         # unit tests: node --test src/*.test.js
npm run self-test  # end-to-end: boots the gateway and drives the real engine
```

See `TESTING.md` for the manual curl and CLI walkthrough.
