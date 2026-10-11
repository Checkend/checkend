import { describe, expect, it } from "vitest";
import type { FrontIdentity } from "../../../src/core/auth/front-identity.ts";
import { DEFAULT_CONFIG } from "../../../src/ports/config.ts";
import { sql } from "../../../src/ports/db.ts";
import { UI_ADMIN_TOKEN, UI_ORIGIN, uiApp } from "../../support/ui.ts";

/**
 * The trusted front identity mode of a hosted install: the front Worker signs people in and
 * passes the member identity with its call. The install takes members from nothing else: no
 * cookies, no setup, no sign-in, no passkeys. Bearer tokens and DSN ingest work as before.
 */
const ALICE: FrontIdentity = { accountId: "acc1alice", name: "Alice", role: "owner" };
const BOB: FrontIdentity = { accountId: "acc2bob", name: "Bob", role: "member" };

async function hosted() {
	const ui = await uiApp({ trustedFront: true, spacesUrl: `${UI_ORIGIN}/spaces` });
	const as = (identity: FrontIdentity | undefined, path: string, init: RequestInit = {}) =>
		ui.request(path, { ...init, ...(identity ? { identity } : {}) });
	const csrfOf = async (identity: FrontIdentity) =>
		/name="_csrf" value="([^"]+)"/.exec(await (await as(identity, "/apps/new")).text())?.[1] ?? "";
	const post = (identity: FrontIdentity, path: string, fields: Record<string, string>) =>
		as(identity, path, {
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded", origin: UI_ORIGIN },
			body: new URLSearchParams(fields).toString(),
		});
	return { ...ui, as, csrfOf, post };
}

describe("trusted front identity mode", () => {
	it("is off by default: an identity in the call does nothing, cookies work as before", async () => {
		expect(DEFAULT_CONFIG.trustedFront ?? false).toBe(false);
		const ui = await uiApp();
		const ignored = await ui.request("/issues", { identity: ALICE });
		expect(ignored.status).toBe(303);
		expect(ignored.headers.get("location")).toBe("/setup");
		const { token } = await ui.signIn();
		expect((await ui.request("/issues", { session: token })).status).toBe(200);
		expect(
			await ui.ports.db.first(sql`SELECT 1 AS x FROM members WHERE name = ${ALICE.name}`),
		).toBeNull();
	});

	it("serves the UI to the identity from the front Worker, and maps it to one member", async () => {
		const t = await hosted();
		for (let i = 0; i < 3; i++) {
			const page = await t.as(ALICE, "/issues", { headers: { accept: "text/html" } });
			expect(page.status).toBe(200);
			expect(await page.text()).toContain("Alice");
		}
		await t.as(BOB, "/issues");
		const members = await t.ports.db.all<{ name: string; user_handle: string }>(
			sql`SELECT name, user_handle FROM members ORDER BY id`,
		);
		expect(members).toEqual([
			{ name: "Alice", user_handle: "front:acc1alice" },
			{ name: "Bob", user_handle: "front:acc2bob" },
		]);
		// A new name at the front Worker: the same member, with the new name.
		await t.as({ ...ALICE, name: "Alice Smith" }, "/issues");
		expect(
			(await t.ports.db.all(sql`SELECT name FROM members ORDER BY id`)).map((m) => m.name),
		).toEqual(["Alice Smith", "Bob"]);
	});

	it("shows the person in the activity of a change", async () => {
		const t = await hosted();
		const created = await t.post(ALICE, "/apps", { _csrf: await t.csrfOf(ALICE), name: "Shop" });
		expect(created.status).toBe(303);
		const activity = (await (
			await t.request("/v1/activity", { headers: { authorization: `Bearer ${UI_ADMIN_TOKEN}` } })
		).json()) as { data: { actor_type: string; actor_name: string }[] };
		expect(activity.data.some((a) => a.actor_type === "member" && a.actor_name === "Alice")).toBe(
			true,
		);
	});

	it("keeps the CSRF token per member: Bob cannot post with Alice's token", async () => {
		const t = await hosted();
		const aliceCsrf = await t.csrfOf(ALICE);
		await t.csrfOf(BOB);
		expect((await t.post(BOB, "/apps", { _csrf: aliceCsrf, name: "X" })).status).toBe(403);
		expect((await t.post(ALICE, "/apps", { _csrf: aliceCsrf, name: "X" })).status).toBe(303);
	});

	it("lets only an owner delete an app; a member does not see the form", async () => {
		const t = await hosted();
		const created = await t.post(ALICE, "/apps", { _csrf: await t.csrfOf(ALICE), name: "Shop" });
		const path = created.headers.get("location")?.split("?")[0] ?? "";
		expect(path).toMatch(/^\/apps\/\d+$/);
		const bobPage = await (await t.as(BOB, path)).text();
		expect(bobPage).not.toContain(`action="${path}/delete"`);
		expect(bobPage).toContain("Only an owner");
		const refused = await t.post(BOB, `${path}/delete`, {
			_csrf: await t.csrfOf(BOB),
			confirm: "Shop",
		});
		expect(refused.status).toBe(403);
		expect(
			await t.ports.db.first(sql`SELECT 1 AS x FROM projects WHERE name = 'Shop'`),
		).not.toBeNull();
		expect(await (await t.as(ALICE, path)).text()).toContain(`action="${path}/delete"`);
		const deleted = await t.post(ALICE, `${path}/delete`, {
			_csrf: await t.csrfOf(ALICE),
			confirm: "Shop",
		});
		expect(deleted.status).toBe(303);
	});

	it("lets a member add apps and make setup keys, without the admin scope", async () => {
		const t = await hosted();
		const csrf = await t.csrfOf(BOB);
		expect((await t.post(BOB, "/apps", { _csrf: csrf, name: "Web" })).status).toBe(303);
		const key = await t.as(BOB, "/apps/setup-key", {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				origin: UI_ORIGIN,
				accept: "application/json",
			},
			body: new URLSearchParams({ _csrf: csrf }).toString(),
		});
		expect(key.status).toBe(200);
	});

	it("refuses every UI route without an identity, also with a valid install session cookie", async () => {
		const t = await hosted();
		await t.as(ALICE, "/issues");
		const { token } = await t.signIn();
		for (const path of ["/", "/issues", "/apps", "/apps/new", "/settings", "/apps/progress"]) {
			const bare = await t.request(path, { headers: { accept: "text/html" } });
			expect(bare.status, path).toBe(404);
			const cookie = await t.request(path, { session: token, headers: { accept: "text/html" } });
			expect(cookie.status, path).toBe(404);
		}
		const posted = await t.request("/apps", {
			session: token,
			method: "POST",
			headers: { "content-type": "application/x-www-form-urlencoded", origin: UI_ORIGIN },
			body: "name=X",
		});
		expect(posted.status).toBe(404);
	});

	it("never sets or reads a cookie", async () => {
		const t = await hosted();
		for (const path of ["/issues", "/apps/new", "/settings"]) {
			const response = await t.as(ALICE, path, {
				headers: { cookie: "__Host-checkend_session=x; __Host-checkend_s_other=y" },
			});
			expect(response.headers.get("set-cookie"), path).toBeNull();
		}
	});

	it("does not offer setup, sign-in, sign-out or passkeys", async () => {
		const t = await hosted();
		for (const [method, path] of [
			["GET", "/setup"],
			["GET", "/login"],
			["GET", "/dev/login"],
			["POST", "/setup/options"],
			["POST", "/setup/verify"],
			["POST", "/login/options"],
			["POST", "/login/verify"],
			["POST", "/logout"],
		] as const) {
			for (const identity of [undefined, ALICE]) {
				const response = await t.as(identity, path, {
					method,
					headers: { "content-type": "application/json", origin: UI_ORIGIN },
					...(method === "POST" ? { body: "{}" } : {}),
				});
				expect(response.status, `${method} ${path}`).toBe(404);
				expect(response.headers.get("set-cookie")).toBeNull();
			}
		}
		const page = await (await t.as(ALICE, "/settings")).text();
		expect(page).not.toContain("/logout");
		expect(page).not.toContain("Passkeys");
		expect(page).not.toContain("Last passkey use");
		expect(page).toContain(`href="${UI_ORIGIN}/spaces"`);
	});

	it("refuses an identity that is not well formed", async () => {
		const t = await hosted();
		for (const identity of [
			{ accountId: "", name: "A", role: "owner" },
			{ accountId: "acc:1", name: "A", role: "owner" },
			{ accountId: "a".repeat(65), name: "A", role: "owner" },
			{ accountId: "acc1", name: "", role: "owner" },
			{ accountId: "acc1", name: "x".repeat(101), role: "owner" },
			{ accountId: "acc1", name: "A", role: "admin" },
			{ accountId: "acc1", name: "A" },
		]) {
			const response = await t.as(identity as FrontIdentity, "/issues");
			expect(response.status, JSON.stringify(identity)).toBe(404);
		}
		expect(await t.ports.db.first(sql`SELECT 1 AS x FROM members`)).toBeNull();
	});

	it("keeps bearer tokens and DSN ingest working without an identity", async () => {
		const t = await hosted();
		const created = await t.request("/v1/projects", {
			method: "POST",
			headers: { authorization: `Bearer ${UI_ADMIN_TOKEN}`, "content-type": "application/json" },
			body: JSON.stringify({ name: "Shop" }),
		});
		expect(created.status).toBe(201);
		const { data } = (await created.json()) as { data: { id: number; dsn: string } };
		const sent = await t.request(
			`/api/${data.id}/store/?sentry_key=${new URL(data.dsn).username}`,
			{ method: "POST", body: '{"message":"hosted error"}' },
		);
		expect(sent.status).toBe(200);
		expect((await t.request("/health")).status).toBe(200);
	});
});
