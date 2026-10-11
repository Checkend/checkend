import type { GatewaySettings, ModelRunner } from "../../ports/model-runner.ts";

/** The part of the Workers AI binding (env.AI) that the runner uses. */
export interface AiBinding {
	run(
		model: string,
		input: Record<string, unknown>,
		options: { gateway: { id: string; collectLog: boolean } },
	): Promise<unknown>;
}

/** ModelRunner on the Workers AI binding. Every call names the gateway and its log setting. */
export function cloudflareModelRunner(binding: AiBinding, gateway: GatewaySettings): ModelRunner {
	return {
		run: (model, input) =>
			binding.run(model, input, {
				gateway: { id: gateway.id, collectLog: gateway.collectLog },
			}),
	};
}
