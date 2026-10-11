import { toJsonSchema } from "@valibot/to-json-schema";
import type { Hono } from "hono";
import type * as v from "valibot";
import { llmsTxt, skillFile } from "../core/agent-docs.ts";
import { API_ROUTES } from "../core/api-spec.ts";
import { installRecipe, setupRecipe, taskRecipe } from "../core/recipes.ts";
import { VERSION } from "../core/version.ts";
import type { AppEnv } from "./app.ts";

type JsonSchema = {
	properties?: Record<string, unknown>;
	required?: string[];
	[key: string]: unknown;
};

const schemaOf = (schema: v.GenericSchema): JsonSchema => {
	const { $schema: _draft, ...json } = toJsonSchema(schema, { errorMode: "ignore" }) as JsonSchema;
	return json;
};

/** The OpenAPI 3.1 document, built from API_ROUTES and their Valibot schemas. */
export function openApiDocument(base: string): Record<string, unknown> {
	const paths: Record<string, Record<string, unknown>> = {};
	for (const route of API_ROUTES) {
		const path = route.path.replace(/:(\w+)/g, "{$1}");
		const pathParams = [...route.path.matchAll(/:(\w+)/g)].map((m) => ({
			name: m[1],
			in: "path",
			required: true,
			schema:
				m[1] === "id"
					? { type: "string", pattern: "^\\d{1,15}$" }
					: { type: "string", minLength: 1, maxLength: 200 },
		}));
		const query = route.query ? schemaOf(route.query) : null;
		const queryParams = Object.entries(query?.properties ?? {}).map(([name, schema]) => ({
			name,
			in: "query",
			required: query?.required?.includes(name) ?? false,
			schema,
		}));
		const parameters = [...pathParams, ...queryParams];
		paths[path] ??= {};
		paths[path][route.method.toLowerCase()] = {
			summary: route.summary,
			...(route.scope ? { "x-required-scope": route.scope } : {}),
			security: route.setupKey
				? [{ setupKey: [] }, { bearer: [] }]
				: [route.scope ? { bearer: [] } : { dsnKey: [] }],
			...(parameters.length > 0 ? { parameters } : {}),
			...(route.body
				? {
						requestBody: {
							required: true,
							content: { "application/json": { schema: schemaOf(route.body) } },
						},
					}
				: {}),
			responses: {
				"200": { description: "Success. JSON with a data field." },
				"401": {
					description: route.scope
						? "No token, or a token that is not valid."
						: "Unknown project, or a wrong DSN key.",
				},
				...(route.scope
					? { "403": { description: `The token does not have the scope ${route.scope}.` } }
					: {}),
			},
		};
	}
	return {
		openapi: "3.1.0",
		info: { title: "Checkend API", version: VERSION },
		servers: [{ url: base }],
		components: {
			securitySchemes: {
				bearer: { type: "http", scheme: "bearer" },
				dsnKey: { type: "apiKey", in: "header", name: "X-Checkend-Key" },
				setupKey: {
					type: "http",
					scheme: "bearer",
					description: "A setup key (cks_...). It opens only the /v1/setup routes.",
				},
			},
		},
		paths,
	};
}

/** Public docs for agents and tools: no token needed, no data in them. */
export function docsRoutes(app: Hono<AppEnv>): void {
	const base = (url: string) => new URL(url).origin;
	app.get("/llms.txt", (c) => c.text(llmsTxt(base(c.req.url))));
	app.get("/skill.md", (c) =>
		c.body(skillFile(base(c.req.url)), 200, { "content-type": "text/markdown; charset=utf-8" }),
	);
	app.get("/v1/openapi.json", (c) => c.json(openApiDocument(base(c.req.url))));
	// Onboarding recipes (D20): no secrets in them; the setup key stays in the user's prompt.
	const markdown = { "content-type": "text/markdown; charset=utf-8" };
	app.get("/agent/install", (c) => c.body(installRecipe(base(c.req.url)), 200, markdown));
	app.get("/agent/setup.md", (c) => c.body(setupRecipe(base(c.req.url)), 200, markdown));
	app.get("/agent/tasks/:file", (c) => {
		const task = /^([a-z-]{1,40})\.md$/.exec(c.req.param("file"))?.[1];
		const text = task ? taskRecipe(base(c.req.url), task) : null;
		return text ? c.body(text, 200, markdown) : c.json({ error: "not_found" }, 404);
	});
}
