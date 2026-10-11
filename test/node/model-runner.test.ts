import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { restModelRunner } from "../../src/adapters/node/model-runner.ts";
import { fetchClient } from "../../src/ports/http.ts";
import { modelRunnerContract, type SeenCall } from "../contract/model-runner-contract.ts";

// A fake Cloudflare API: POST /client/v4/accounts/<account>/ai/run with {model, input}.
let base = "";
let handler: (call: SeenCall, auth: string) => { status: number; body: unknown } = () => ({
	status: 500,
	body: {},
});
const server = createServer((request, response) => {
	let text = "";
	request.on("data", (chunk: Buffer) => {
		text += chunk.toString("utf8");
	});
	request.on("end", () => {
		const body = JSON.parse(text || "{}") as { model: string; input: unknown };
		const call: SeenCall = {
			model: body.model,
			input: body.input,
			gateway: {
				id: String(request.headers["cf-aig-gateway-id"] ?? ""),
				collectLog: request.headers["cf-aig-collect-log"] === "true",
			},
		};
		const ok = request.method === "POST" && request.url === "/client/v4/accounts/acc123/ai/run";
		const { status, body: out } = ok
			? handler(call, String(request.headers.authorization ?? ""))
			: { status: 404, body: { success: false, errors: [{ message: "not found" }] } };
		response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(out));
	});
});
beforeAll(async () => {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
	server.close();
});

const runner = (gateway: { id: string; collectLog: boolean }) =>
	restModelRunner({
		accountId: "acc123",
		apiToken: "token-1",
		gateway,
		http: fetchClient,
		baseUrl: base,
	});

modelRunnerContract("Cloudflare REST API (Node)", async (gateway, reply) => {
	const calls: SeenCall[] = [];
	handler = (call) => {
		calls.push(call);
		try {
			return { status: 200, body: { success: true, errors: [], result: reply(call) } };
		} catch (error) {
			return { status: 400, body: { success: false, errors: [{ message: String(error) }] } };
		}
	};
	return { runner: runner(gateway), calls: () => calls };
});

describe("the REST model runner", () => {
	it("sends the API token, and never puts it in an error message", async () => {
		let seen = "";
		handler = (_call, auth) => {
			seen = auth;
			return { status: 401, body: { success: false, errors: [{ code: 10000 }] } };
		};
		const error = await runner({ id: "default", collectLog: false })
			.run("@cf/cloudflare/clef-flash", { state: "x" })
			.catch((e: unknown) => e);
		expect(seen).toBe("Bearer token-1");
		expect(String(error)).toContain("401");
		expect(String(error)).not.toContain("token-1");
	});

	it("rejects a body that is not a Cloudflare API result", async () => {
		handler = () => ({ status: 200, body: { unexpected: true } });
		await expect(
			runner({ id: "default", collectLog: false }).run("@cf/cloudflare/clef-flash", {}),
		).rejects.toThrow(/unexpected response/);
	});
});
