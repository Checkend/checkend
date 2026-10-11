import { IngestState } from "../../src/core/ingest/state.ts";
import { createApp } from "../../src/http/app.ts";
import { testPorts } from "./node-ports.ts";

/** The app with a test admin token, and helpers for the /v1/setup tests. */
export const ADMIN = "setup-api-admin-token-0123456789";

export async function setupApi() {
	const t = await testPorts({ config: { adminToken: ADMIN } });
	const app = createApp({ state: new IngestState() });
	const call = async (method: string, path: string, token: string | null, body?: unknown) => {
		const response = await app.request(
			path,
			{
				method,
				headers: {
					...(token ? { authorization: `Bearer ${token}` } : {}),
					"content-type": "application/json",
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			},
			{ ports: t.ports },
		);
		const text = await response.text();
		return {
			status: response.status,
			body: text ? (JSON.parse(text) as Record<string, any>) : null,
		};
	};
	const newKey = async () => (await call("POST", "/v1/setup/keys", ADMIN)).body?.data.key as string;
	return { ...t, app, call, newKey };
}
