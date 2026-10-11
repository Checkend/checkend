import { cloudflareModelRunner } from "../../src/adapters/cloudflare/model-runner.ts";
import { modelRunnerContract, type SeenCall } from "../contract/model-runner-contract.ts";

// A fake AI binding with the run(model, input, { gateway }) signature of env.AI.
modelRunnerContract("Workers AI binding (Workers)", async (gateway, reply) => {
	const calls: SeenCall[] = [];
	const binding = {
		async run(
			model: string,
			input: Record<string, unknown>,
			options?: { gateway?: { id: string; collectLog?: boolean } },
		) {
			const call: SeenCall = {
				model,
				input,
				gateway: {
					id: options?.gateway?.id ?? "",
					collectLog: options?.gateway?.collectLog ?? true,
				},
			};
			calls.push(call);
			return reply(call);
		},
	};
	return { runner: cloudflareModelRunner(binding, gateway), calls: () => calls };
});
