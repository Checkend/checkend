import { describe, expect, it } from "vitest";
import { IngestState } from "../../src/core/ingest/state.ts";
import { createApp } from "../../src/http/app.ts";
import { testPorts } from "../support/node-ports.ts";

async function getDocument() {
	const t = await testPorts();
	const app = createApp({ state: new IngestState() });
	const response = await app.request(
		"https://checkend.example/v1/openapi.json",
		{},
		{ ports: t.ports },
	);
	return { app, response, document: (await response.json()) as Record<string, any> };
}

describe("OpenAPI 3.1 document", () => {
	it("is served at /v1/openapi.json without a token", async () => {
		const { response, document } = await getDocument();
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(document.openapi).toBe("3.1.0");
		expect(document.info).toMatchObject({ title: "Checkend API", version: expect.any(String) });
		expect(document.servers).toEqual([{ url: "https://checkend.example" }]);
		expect(document.components.securitySchemes.bearer).toEqual({ type: "http", scheme: "bearer" });
	});

	it("documents every /v1 route of the app, with its scope", async () => {
		const { app, document } = await getDocument();
		const routes = app.routes.filter(
			(r) => r.path.startsWith("/v1/") && r.method !== "ALL" && r.path !== "/v1/openapi.json",
		);
		for (const route of routes) {
			const path = route.path.replace(/:(\w+)/g, "{$1}");
			const operation = document.paths[path]?.[route.method.toLowerCase()];
			expect(operation, `${route.method} ${route.path}`).toBeDefined();
			if (route.path === "/v1/ingest") {
				// Native ingest uses the DSN key header, not a bearer token.
				expect(operation.security).toEqual([{ dsnKey: [] }]);
				expect(operation["x-required-scope"]).toBeUndefined();
				continue;
			}
			expect(operation["x-required-scope"], `${route.method} ${route.path}`).toMatch(
				/^(issues:read|issues:write|releases:write|admin)$/,
			);
			expect(operation.security).toEqual([{ bearer: [] }]);
		}
	});

	it("documents the DSN key scheme of POST /v1/ingest", async () => {
		const { document } = await getDocument();
		expect(document.components.securitySchemes.dsnKey).toEqual({
			type: "apiKey",
			in: "header",
			name: "X-Checkend-Key",
		});
		const ingest = document.paths["/v1/ingest"].post;
		expect(ingest.parameters.map((p: { name: string }) => p.name)).toEqual(["project"]);
		expect(ingest.requestBody.content["application/json"].schema.properties).toHaveProperty(
			"frames",
		);
	});

	it("documents only routes that the app has", async () => {
		const { app, document } = await getDocument();
		const appRoutes = new Set(
			app.routes.map((r) => `${r.method} ${r.path.replace(/:(\w+)/g, "{$1}")}`),
		);
		for (const [path, operations] of Object.entries(document.paths as Record<string, object>)) {
			for (const method of Object.keys(operations)) {
				expect(appRoutes.has(`${method.toUpperCase()} ${path}`), `${method} ${path}`).toBe(true);
			}
		}
	});

	it("documents query parameters and request bodies from the route schemas", async () => {
		const { document } = await getDocument();
		const list = document.paths["/v1/issues"].get;
		expect(list.parameters.map((p: { name: string }) => p.name).sort()).toEqual([
			"claimed",
			"cursor",
			"environment",
			"limit",
			"project",
			"release",
			"search",
			"since",
			"sort",
			"status",
		]);
		const status = list.parameters.find((p: { name: string }) => p.name === "status");
		expect(status).toMatchObject({
			in: "query",
			required: false,
			schema: {
				enum: [
					"unresolved",
					"resolved",
					"ignored",
					"merged",
					"fix_pending",
					"verified",
					"regressed",
				],
			},
		});
		const createToken = document.paths["/v1/tokens"].post;
		expect(createToken.requestBody.content["application/json"].schema).toMatchObject({
			type: "object",
			required: ["name", "scopes"],
		});
		expect(document.paths["/v1/issues/{id}"].get.parameters).toEqual([
			{
				name: "id",
				in: "path",
				required: true,
				schema: expect.objectContaining({ type: "string" }),
			},
		]);
	});
});
