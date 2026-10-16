import {
	callSignal,
	type GatewaySettings,
	MODEL_TIMEOUT_MS,
	type ModelRunner,
} from "../../ports/model-runner.ts";

/** The part of the Workers AI binding (env.AI) that the runner uses. */
export interface AiBinding {
	run(
		model: string,
		input: Record<string, unknown>,
		options: { gateway: { id: string; collectLog: boolean }; signal?: AbortSignal },
	): Promise<unknown>;
}

/** ModelRunner on the Workers AI binding. Every call names the gateway and its log setting. */
export function cloudflareModelRunner(
	binding: AiBinding,
	gateway: GatewaySettings,
	timeoutMs = MODEL_TIMEOUT_MS,
): ModelRunner {
	return {
		run: (model, input, options) => {
			const signal = callSignal(timeoutMs, options?.signal);
			// The binding gets the signal; the race also ends the wait if a binding ignores it.
			return Promise.race([
				binding.run(model, input, {
					gateway: { id: gateway.id, collectLog: gateway.collectLog },
					signal,
				}),
				new Promise<never>((_resolve, reject) => {
					if (signal.aborted) reject(signal.reason);
					signal.addEventListener("abort", () => reject(signal.reason), { once: true });
				}),
			]);
		},
	};
}
