import { describe, expect, it } from "vitest";
import type { GatewaySettings, ModelRunner } from "../../src/ports/model-runner.ts";

/** One call as the fake backend saw it. */
export interface SeenCall {
	model: string;
	input: unknown;
	gateway: { id: string; collectLog: boolean };
}

/**
 * The behaviour every ModelRunner adapter must have. `make` builds the adapter on a fake backend
 * (a fake AI binding, or a fake Cloudflare API) that answers `reply` for each call, or fails when
 * `reply` throws.
 */
export function modelRunnerContract(
	adapterName: string,
	make: (
		gateway: GatewaySettings,
		reply: (call: SeenCall) => unknown,
	) => Promise<{ runner: ModelRunner; calls: () => SeenCall[] }>,
): void {
	describe(`ModelRunner contract: ${adapterName}`, () => {
		it("sends the model and its input through the gateway, and returns the output", async () => {
			const { runner, calls } = await make({ id: "checkend", collectLog: false }, (call) => ({
				echo: call.input,
			}));
			const input = { state: "TypeError: x is undefined", questions: { a: { type: "noul" } } };
			expect(await runner.run("@cf/cloudflare/clef-flash", input)).toEqual({ echo: input });
			expect(calls()).toEqual([
				{
					model: "@cf/cloudflare/clef-flash",
					input,
					gateway: { id: "checkend", collectLog: false },
				},
			]);
		});

		it("passes the log setting of the gateway", async () => {
			const { runner, calls } = await make({ id: "default", collectLog: true }, () => ({}));
			await runner.run("@cf/qwen/qwen3-embedding-0.6b", { text: ["a"] });
			expect(calls()[0]?.gateway).toEqual({ id: "default", collectLog: true });
		});

		it("rejects when the model call fails", async () => {
			const { runner } = await make({ id: "default", collectLog: false }, () => {
				throw new Error("model failed");
			});
			await expect(runner.run("@cf/cloudflare/clef-flash", { state: "x" })).rejects.toThrow();
		});
	});
}
