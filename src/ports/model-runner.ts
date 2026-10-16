/**
 * Runs a Workers AI model. Every call goes through AI Gateway (gateway ID and log setting from
 * the config): the adapters have no way to call a model without it.
 */
export interface ModelRunner {
	/**
	 * Runs `model` (a Workers AI ID, "@cf/...") with its input. Returns the model output. Every
	 * call ends after MODEL_TIMEOUT_MS at the latest; `signal` ends it sooner (a caller that stops
	 * waiting must stop the call too: an open call keeps a hosted install awake).
	 */
	run(
		model: string,
		input: Record<string, unknown>,
		options?: { signal?: AbortSignal },
	): Promise<unknown>;
}

/** The longest time of a model call. */
export const MODEL_TIMEOUT_MS = 30_000;

/** The signal of a call: the timeout, and the caller's signal when there is one. */
export function callSignal(ms: number, signal?: AbortSignal): AbortSignal {
	const timeout = AbortSignal.timeout(ms);
	return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** AI Gateway settings for every model call. */
export interface GatewaySettings {
	/** The gateway ID (AI_GATEWAY_ID); "default" makes one on the first request. */
	id: string;
	/** Store prompts and responses in the gateway logs (AI_GATEWAY_LOGS=on). Default: off. */
	collectLog: boolean;
}
