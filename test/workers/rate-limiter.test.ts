import { env } from "cloudflare:test";
import { rateLimiterContract } from "../contract/rate-limiter-contract.ts";

// The INGEST_RATE_LIMITER binding of wrangler.jsonc: 1000 requests per 60 seconds per key.
rateLimiterContract("Cloudflare Rate Limiting binding", 1000, () => ({
	allow: async (key) => (await env.INGEST_RATE_LIMITER.limit({ key })).success,
}));
