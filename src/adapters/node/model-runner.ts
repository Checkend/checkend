import type { HttpClient } from "../../ports/http.ts";
import type { GatewaySettings, ModelRunner } from "../../ports/model-runner.ts";

export interface RestModelRunnerOptions {
	/** CLOUDFLARE_ACCOUNT_ID. */
	accountId: string;
	/** CLOUDFLARE_API_TOKEN: a token with the Workers AI Read permission. */
	apiToken: string;
	gateway: GatewaySettings;
	http: HttpClient;
	/** Tests only. Default: https://api.cloudflare.com. */
	baseUrl?: string;
	timeoutMs?: number;
}

const TIMEOUT_MS = 15_000;

/**
 * ModelRunner on the Cloudflare REST API (POST /accounts/<id>/ai/run), for installs that do not
 * run on Workers. The cf-aig-gateway-id header sends each call through AI Gateway.
 */
export function restModelRunner(options: RestModelRunnerOptions): ModelRunner {
	const url = `${options.baseUrl ?? "https://api.cloudflare.com"}/client/v4/accounts/${encodeURIComponent(options.accountId)}/ai/run`;
	return {
		async run(model, input) {
			const response = await options.http.send(url, {
				method: "POST",
				headers: {
					authorization: `Bearer ${options.apiToken}`,
					"content-type": "application/json",
					"cf-aig-gateway-id": options.gateway.id,
					"cf-aig-collect-log": String(options.gateway.collectLog),
				},
				body: JSON.stringify({ model, input }),
				signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
			});
			const body = (await response.json().catch(() => null)) as {
				success?: unknown;
				result?: unknown;
				errors?: unknown;
			} | null;
			if (!response.ok || body?.success === false) {
				// The errors of the API only; the request (and so the token) is never in the message.
				const errors = JSON.stringify(body?.errors ?? null).slice(0, 300);
				throw new Error(`Workers AI ${model}: HTTP ${response.status} ${errors}`);
			}
			if (body?.success !== true || !("result" in body)) {
				throw new Error(`Workers AI ${model}: unexpected response`);
			}
			return body.result;
		},
	};
}
