/**
 * Runs a Workers AI model. Every call goes through AI Gateway (gateway ID and log setting from
 * the config): the adapters have no way to call a model without it.
 */
export interface ModelRunner {
	/** Runs `model` (a Workers AI ID, "@cf/...") with its input. Returns the model output. */
	run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

/** AI Gateway settings for every model call. */
export interface GatewaySettings {
	/** The gateway ID (AI_GATEWAY_ID); "default" makes one on the first request. */
	id: string;
	/** Store prompts and responses in the gateway logs (AI_GATEWAY_LOGS=on). Default: off. */
	collectLog: boolean;
}
