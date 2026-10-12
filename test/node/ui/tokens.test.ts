import { describe, expect, it } from "vitest";
import type { FrontIdentity } from "../../../src/core/auth/front-identity.ts";
import { createProject } from "../../../src/core/projects.ts";
import { sql } from "../../../src/ports/db.ts";
import { uiApp } from "../../support/ui.ts";

/** The token in a page: ck_ and 43 base64url characters. */
const TOKEN = /ck_[A-Za-z0-9_-]{43}/;

async function selfHost() {
	const ui = await uiApp();
	const session = await ui.signIn();
	const page = async (path: string) => {
		const response = await ui.request(path, {
			session: session.token,
			headers: { accept: "text/html" },
		});
		return { response, html: await response.text() };
	};
	const post = (path: string, fields: Record<string, string>, csrf = session.csrf) =>
		ui.form(path, { _csrf: csrf, ...fields }, session.token);
	const shop = await createProject(ui.ports, { name: "Shop", platform: "node" });
	const blog = await createProject(ui.ports, { name: "Blog", platform: "node" });
	/** A bearer call to the API. */
	const api = (method: string, path: string, token: string, body?: unknown) =>
		ui.request(path, {
			method,
			headers: {
				authorization: `Bearer ${token}`,
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	return { ...ui, session, page, post, shop, blog, api };
}

describe("Settings → Tokens", () => {
	it("an owner sees the form: only issues:read, issues:write and releases:write, and the apps", async () => {
		const t = await selfHost();
		const { response, html } = await t.page("/settings/tokens");
		expect(response.status).toBe(200);
		for (const scope of ["issues:read", "issues:write", "releases:write"]) {
			expect(html).toContain(scope);
		}
		expect(html).not.toMatch(/name="scope_admin"/);
		expect(html).toContain(`<option value="${t.shop.id}">Shop</option>`);
		expect(html).toContain('<option value="">All apps</option>');
		// The settings page links to it.
		expect((await t.page("/settings")).html).toContain('href="/settings/tokens"');
	});

	it("creates a token and shows it once, with a copy button; later pages never show it", async () => {
		const t = await selfHost();
		const created = await t.post("/settings/tokens", {
			name: "GitHub Actions",
			scope_releases_write: "1",
			project: String(t.shop.id),
		});
		expect(created.status).toBe(200);
		expect(created.headers.get("cache-control")).toContain("no-store");
		expect(created.headers.get("location")).toBeNull();
		const html = await created.text();
		const token = TOKEN.exec(html)?.[0] ?? "";
		expect(token).not.toBe("");
		expect(html).toContain(`<code id="new-token">${token}</code>`);
		expect(html).toContain('data-copy="new-token"');
		expect(html.split(token)).toHaveLength(2); // once in the page
		// Stored: the hash only, bound to the app, with the scope.
		const row = await t.ports.db.first<{ scopes: string; project_id: number; token_hash: string }>(
			sql`SELECT scopes, project_id, token_hash FROM tokens WHERE name = 'GitHub Actions'`,
		);
		expect(row).toMatchObject({ scopes: "releases:write", project_id: t.shop.internalId });
		expect(row?.token_hash).not.toContain(token);
		// The list: name, scopes, app, prefix, never the token.
		const list = await t.page("/settings/tokens");
		expect(list.html).not.toMatch(TOKEN);
		expect(list.html).toContain("GitHub Actions");
		expect(list.html).toContain("releases:write");
		expect(list.html).toContain(token.slice(0, 10));
		expect(list.html).toMatch(/<td[^>]*>Shop<\/td>/);
		expect((await t.page("/settings")).html).not.toContain(token);
	});

	it("never gives an admin token from the form, and needs a name and a scope", async () => {
		const t = await selfHost();
		for (const fields of [
			{ name: "x", scope_admin: "1" },
			{ name: "x" },
			{ name: "", scope_issues_read: "1" },
			{ name: "x", scope_issues_read: "1", project: "9999999999" },
		]) {
			const response = await t.post("/settings/tokens", fields);
			expect(response.status, JSON.stringify(fields)).toBe(400);
			expect(await response.text()).not.toMatch(TOKEN);
		}
		const both = await t.post("/settings/tokens", {
			name: "reader",
			scope_issues_read: "1",
			scope_admin: "1",
		});
		expect(both.status).toBe(200);
		const row = await t.ports.db.first<{ scopes: string }>(
			sql`SELECT scopes FROM tokens WHERE name = 'reader'`,
		);
		expect(row?.scopes).toBe("issues:read");
		expect(await t.ports.db.first(sql`SELECT 1 AS x FROM tokens WHERE scopes LIKE '%admin%'`)).toBe(
			null,
		);
	});

	it("checks the CSRF token of the create and revoke forms", async () => {
		const t = await selfHost();
		const bad = await t.post("/settings/tokens", { name: "x", scope_issues_read: "1" }, "wrong");
		expect(bad.status).toBe(403);
		const crossSite = await t.form(
			"/settings/tokens",
			{ _csrf: t.session.csrf, name: "x", scope_issues_read: "1" },
			t.session.token,
			{ origin: "https://evil.example" },
		);
		expect(crossSite.status).toBe(403);
		expect(await t.ports.db.first(sql`SELECT 1 AS x FROM tokens`)).toBe(null);
	});

	it("revokes a token after a confirmation; the token stops working", async () => {
		const t = await selfHost();
		const html = await (
			await t.post("/settings/tokens", { name: "reader", scope_issues_read: "1" })
		).text();
		const token = TOKEN.exec(html)?.[0] ?? "";
		expect((await t.api("GET", "/v1/issues", token)).status).toBe(200);
		const id = (await t.ports.db.first<{ id: number }>(sql`SELECT id FROM tokens`))?.id;
		const list = (await t.page("/settings/tokens")).html;
		expect(list).toContain(`action="/settings/tokens/${id}/revoke"`);
		expect(list).toContain("Revoke");
		expect((await t.post(`/settings/tokens/${id}/revoke`, {}, "wrong")).status).toBe(403);
		const revoked = await t.post(`/settings/tokens/${id}/revoke`, {});
		expect(revoked.status).toBe(303);
		expect(revoked.headers.get("location")).toBe("/settings/tokens?revoked=1");
		expect((await t.api("GET", "/v1/issues", token)).status).toBe(401);
		expect((await t.page("/settings/tokens")).html).not.toContain("reader");
	});

	it("a releases:write token bound to an app reports deploys and source maps only for that app", async () => {
		const t = await selfHost();
		const html = await (
			await t.post("/settings/tokens", {
				name: "ci",
				scope_releases_write: "1",
				project: String(t.shop.id),
			})
		).text();
		const token = TOKEN.exec(html)?.[0] ?? "";
		const deploy = (project: number) =>
			t.api("POST", "/v1/deploys", token, { project, commit: "a1b2c3d", release: "1.0.0" });
		expect((await deploy(t.shop.id)).status).toBe(201);
		const other = await deploy(t.blog.id);
		expect(other.status).toBe(403);
		expect(await other.json()).toMatchObject({ error: "forbidden_project" });
		const upload = await t.request(
			`/v1/sourcemaps?project=${t.blog.id}&release=1.0.0&name=app.js`,
			{
				method: "POST",
				headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
				body: "{}",
			},
		);
		expect(upload.status).toBe(403);
		// It cannot read issues: it has only releases:write.
		expect((await t.api("GET", "/v1/issues", token)).status).toBe(403);
	});
});

describe("Settings → Tokens in a hosted install", () => {
	const ORIGIN = "https://hosted.test";
	const BASE = "/k7q2x9";
	const OWNER: FrontIdentity = { accountId: "acc1alice", name: "Alice", role: "owner" };
	const MEMBER: FrontIdentity = { accountId: "acc2bob", name: "Bob", role: "member" };

	async function hosted() {
		const ui = await uiApp(
			{ publicUrl: ORIGIN, basePath: BASE, trustedFront: true, spacesUrl: `${ORIGIN}/spaces` },
			ORIGIN,
		);
		const call = (path: string, as: FrontIdentity, init: RequestInit = {}) =>
			ui.request(`${BASE}${path}`, { ...init, identity: as });
		const csrfOf = async (as: FrontIdentity) =>
			/name="_csrf" value="([^"]+)"/.exec(await (await call("/apps/new", as)).text())?.[1] ?? "";
		const post = async (path: string, fields: Record<string, string>, as: FrontIdentity) =>
			call(path, as, {
				method: "POST",
				headers: {
					"content-type": "application/x-www-form-urlencoded",
					origin: ORIGIN,
					referer: `${ORIGIN}${BASE}/settings/tokens`,
				},
				body: new URLSearchParams({ _csrf: await csrfOf(as), ...fields }).toString(),
			});
		return { ...ui, call, post };
	}

	it("an owner creates a token under the base path; the form posts there", async () => {
		const t = await hosted();
		const page = await (
			await t.call("/settings/tokens", OWNER, { headers: { accept: "text/html" } })
		).text();
		expect(page).toContain(`action="${BASE}/settings/tokens"`);
		const created = await t.post("/settings/tokens", { name: "ci", scope_issues_read: "1" }, OWNER);
		expect(created.status).toBe(200);
		expect(await created.text()).toMatch(TOKEN);
	});

	it("a member who is not an owner cannot open or use it", async () => {
		const t = await hosted();
		const page = await t.call("/settings/tokens", MEMBER, { headers: { accept: "text/html" } });
		expect(page.status).toBe(403);
		expect(await page.text()).not.toContain('name="scope_');
		const created = await t.post("/settings/tokens", { name: "x", scope_issues_read: "1" }, MEMBER);
		expect(created.status).toBe(403);
		expect(await t.ports.db.first(sql`SELECT 1 AS x FROM tokens`)).toBe(null);
		const settings = await (
			await t.call("/settings", MEMBER, { headers: { accept: "text/html" } })
		).text();
		expect(settings).not.toContain("/settings/tokens");
	});
});
