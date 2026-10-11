import { describe, expect, it } from "vitest";
import { API_ROUTES } from "../../src/core/api-spec.ts";
import { IngestState } from "../../src/core/ingest/state.ts";
import { BOOTSTRAP_ADMIN, createToken, type Scope } from "../../src/core/tokens.ts";
import { createApp } from "../../src/http/app.ts";
import { testPorts } from "../support/node-ports.ts";

/** Every scope except the one a route needs (admin includes all, so it is never given here). */
const OTHERS: Record<Exclude<Scope, "admin">, Scope[]> = {
	"issues:read": ["releases:write"],
	"issues:write": ["issues:read", "releases:write"],
	"releases:write": ["issues:read", "issues:write"],
};

describe("every /v1 route enforces its documented scope", async () => {
	const { ports } = await testPorts({
		config: { adminToken: "route-scope-admin-token-0123456789-abcdef" },
	});
	const app = createApp({ state: new IngestState() });
	const tokenWith = async (scopes: Scope[]) =>
		(await createToken(ports, BOOTSTRAP_ADMIN, { name: scopes.join("+"), scopes })).token;
	const nonAdmin = await tokenWith(["issues:read", "issues:write", "releases:write"]);
	const call = (method: string, path: string, token: string | null) =>
		app.request(
			path
				.replace(/:id/g, "1")
				.replace(/:project/g, "shop")
				.replace(/:version/g, "v1")
				.replace(/:key/g, "k"),
			{ method, headers: token ? { authorization: `Bearer ${token}` } : {} },
			{ ports },
		);

	const routes = API_ROUTES.filter((r) => r.scope !== null && !r.setupKey);
	it("covers the routes", () => expect(routes.length).toBeGreaterThan(40));

	for (const route of routes) {
		it(`${route.method} ${route.path} needs ${route.scope}`, async () => {
			expect((await call(route.method, route.path, null)).status).toBe(401);
			const lacking =
				route.scope === "admin"
					? nonAdmin
					: await tokenWith(OTHERS[route.scope as Exclude<Scope, "admin">]);
			const response = await call(route.method, route.path, lacking);
			expect(response.status, `${route.method} ${route.path}`).toBe(403);
			expect(await response.json()).toMatchObject({
				error: "forbidden",
				required_scope: route.scope,
			});
		});
	}
});
