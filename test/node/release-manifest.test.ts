import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	buildManifest,
	type Manifest,
	OPTIONAL_BINDINGS,
	PROXY_REPOSITORIES,
	SETTINGS,
} from "../../scripts/release-manifest.ts";
import { MIN_ADMIN_TOKEN_CHARS } from "../../src/adapters/config-env.ts";

/**
 * The manifest of a server release must pass the reader of `ce` (checkend-cli
 * internal/serverrelease/serverrelease.go, check()). These are its rules, copied. A release is
 * also checked end to end with the Go reader before the first tag.
 */
const versionPattern = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/;
const commitPattern = /^[0-9a-f]{40}$/;
const shaPattern = /^[0-9a-f]{64}$/;
const digestPattern = /^sha256:[0-9a-f]{64}$/;
const assetPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const migrationName = /^\d{4}_[a-z0-9_]+\.sql$/;
const bindingName = /^[A-Z][A-Z0-9_]{0,63}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ASSET = 200 << 20;

/** The errors of check() in the reader, or [] for a valid manifest. */
function formatOneErrors(m: Manifest): string[] {
	const errors: string[] = [];
	if (m.format !== 1) errors.push("format");
	if (!versionPattern.test(m.version)) errors.push("version");
	if (!versionPattern.test(m.min_cli_version)) errors.push("min_cli_version");
	if (!commitPattern.test(m.commit)) errors.push("commit");
	if (m.tag !== `v${m.version}`) errors.push("tag");
	for (const a of [m.migrations, m.worker]) {
		if (!assetPattern.test(a.asset) || a.asset.startsWith("checkend-release.json"))
			errors.push(`asset ${a.asset}`);
		if (!shaPattern.test(a.sha256) || a.size <= 0 || a.size > MAX_ASSET)
			errors.push(`sha256/size ${a.asset}`);
	}
	if (!migrationName.test(m.migrations.latest) || m.migrations.count < 1) errors.push("migrations");
	const w = m.worker;
	if (!w.modules.some((mod) => mod.name === w.main_module && mod.type === "esm"))
		errors.push("main_module");
	for (const mod of w.modules) {
		const base = mod.name.split("/").at(-1) ?? "";
		if (!assetPattern.test(base) || mod.name.startsWith("/") || mod.name.startsWith(".."))
			errors.push(`module ${mod.name}`);
	}
	if (!datePattern.test(w.compatibility_date)) errors.push("compatibility_date");
	for (const b of w.bindings) if (!bindingName.test(b.name)) errors.push(`binding ${b.name}`);
	if (!w.bindings.some((b) => b.type === "d1" && b.name === "DB" && b.required === true))
		errors.push("DB");
	if (m.image.repository !== "ghcr.io/checkend/checkend") errors.push("image repository");
	if (!digestPattern.test(m.image.digest)) errors.push("image digest");
	for (const [name, ref] of Object.entries(m.proxies)) {
		const [repo, digest] = ref.split("@");
		if (
			PROXY_REPOSITORIES[name as keyof typeof PROXY_REPOSITORIES] !== repo ||
			!digestPattern.test(digest ?? "")
		)
			errors.push(`proxy ${name}`);
	}
	return errors;
}

const digest = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

function sample(change: (input: Parameters<typeof buildManifest>[0]) => void = () => {}) {
	const input = {
		version: "0.9.0",
		commit: "a".repeat(40),
		publishedAt: "2026-10-20T12:00:00Z",
		worker: { asset: "checkend-worker-0.9.0.tar.gz", bytes: new TextEncoder().encode("worker") },
		migrations: {
			asset: "checkend-migrations-0.9.0.tar.gz",
			bytes: new TextEncoder().encode("migrations"),
		},
		migrationFiles: readdirSync("migrations"),
		wranglerJsonc: readFileSync("wrangler.jsonc", "utf8"),
		imageDigest: digest("image"),
		proxies: {
			caddy: `docker.io/library/caddy@${digest("caddy")}`,
			cloudflared: `docker.io/cloudflare/cloudflared@${digest("cloudflared")}`,
		},
	};
	change(input);
	return buildManifest(input);
}

describe("the release manifest (format 1)", () => {
	it("passes the rules of the ce reader, with the real wrangler.jsonc and migrations", () => {
		const m = sample();
		expect(formatOneErrors(m)).toEqual([]);
		const files = readdirSync("migrations")
			.filter((f) => f.endsWith(".sql"))
			.sort();
		expect(m.migrations).toMatchObject({ latest: files.at(-1), count: files.length });
		expect(m.worker).toMatchObject({
			main_module: "worker.js",
			modules: [{ name: "worker.js", type: "esm" }],
			compatibility_date: "2026-10-06",
			crons: ["*/5 * * * *"],
			observability: true,
		});
		expect(m.image).toMatchObject({ tag: "0.9.0", platforms: ["linux/amd64", "linux/arm64"] });
	});

	it("rejects what the reader rejects (the copy of its rules is not empty)", () => {
		const bad = (change: (m: Manifest) => void) => {
			const m = structuredClone(sample());
			change(m);
			return formatOneErrors(m);
		};
		expect(bad((m) => (m.commit = "abc"))).toContain("commit");
		expect(bad((m) => (m.image.digest = "latest"))).toContain("image digest");
		expect(bad((m) => (m.proxies.caddy = `docker.io/evil/caddy@${digest("x")}`))).toContain(
			"proxy caddy",
		);
		expect(bad((m) => (m.version = "1.0"))).toContain("version");
		expect(bad((m) => (m.worker.bindings = []))).toContain("DB");
	});

	it("refuses a bad version, commit, digest or proxy before it writes anything", () => {
		for (const change of [
			(i: Parameters<typeof buildManifest>[0]) => (i.version = "1.0.0; rm -rf /"),
			(i: Parameters<typeof buildManifest>[0]) => (i.version = "v1.0.0"),
			(i: Parameters<typeof buildManifest>[0]) => (i.commit = "HEAD"),
			(i: Parameters<typeof buildManifest>[0]) => (i.imageDigest = "sha256:abc"),
			(i: Parameters<typeof buildManifest>[0]) =>
				(i.proxies.cloudflared = "docker.io/cloudflare/cloudflared:latest"),
		]) {
			expect(() => sample(change)).toThrow();
		}
	});

	it("every migration file name passes the reader and the installer", () => {
		for (const name of readdirSync("migrations").filter((f) => f.endsWith(".sql"))) {
			expect(name).toMatch(migrationName);
		}
	});

	it("has no default value, and no secret value, in any setting", () => {
		const text = JSON.stringify(sample());
		for (const setting of Object.values(sample().settings)) {
			expect(Object.keys(setting).sort()).not.toContain("default");
			expect(
				Object.keys(setting).every((k) => ["secret", "min_length", "format"].includes(k)),
			).toBe(true);
		}
		expect(text).not.toMatch(/"default"/);
		expect(SETTINGS.ADMIN_TOKEN).toEqual({ secret: true, min_length: MIN_ADMIN_TOKEN_CHARS });
		for (const secret of [
			"ADMIN_TOKEN",
			"SETUP_CODE",
			"ENCRYPTION_KEYS",
			"GITHUB_WEBHOOK_SECRET",
			"GITHUB_TOKEN",
		]) {
			expect(SETTINGS[secret]?.secret, secret).toBe(true);
		}
	});

	it("lists every setting of config-env.ts, except CHECKEND_DEV", () => {
		const source = readFileSync("src/adapters/config-env.ts", "utf8");
		const block = /export interface ConfigEnv \{([\s\S]*?)\n\}/.exec(source)?.[1] ?? "";
		const names = [...block.matchAll(/^\s*([A-Z][A-Z0-9_]*)\?:/gm)].map((m) => m[1]);
		expect(names.length).toBeGreaterThan(10);
		expect(Object.keys(SETTINGS).sort()).toEqual(names.filter((n) => n !== "CHECKEND_DEV").sort());
	});

	it("lists every binding that the Worker reads, DB as the only required one", () => {
		const source = readFileSync("src/adapters/cloudflare/ports.ts", "utf8");
		const settings = new Set(Object.keys(SETTINGS));
		const read = [...new Set([...source.matchAll(/env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]))]
			.filter((name): name is string => !!name && !settings.has(name))
			.sort();
		const listed = sample()
			.worker.bindings.map((b) => b.name)
			.sort();
		expect(listed).toEqual(read);
		expect(sample().worker.bindings.filter((b) => b.required)).toEqual([
			{ type: "d1", name: "DB", required: true },
		]);
		expect(OPTIONAL_BINDINGS.length).toBe(listed.length - 1);
	});
});

describe("the signing key of server releases", () => {
	it("release/allowed_signers pins the key server-2026 (SHA256:QMPY…)", () => {
		const lines = readFileSync("release/allowed_signers", "utf8")
			.split("\n")
			.filter((line) => line.trim() !== "" && !line.startsWith("#"));
		expect(lines).toHaveLength(1);
		const [principal, options, type, key] = (lines[0] ?? "").split(/\s+/);
		expect(principal).toBe("server-2026");
		expect(options).toBe('namespaces="checkend-server-release"');
		expect(type).toBe("ssh-ed25519");
		const fingerprint = `SHA256:${createHash("sha256")
			.update(Buffer.from(key ?? "", "base64"))
			.digest("base64")
			.replace(/=+$/, "")}`;
		expect(fingerprint).toBe("SHA256:QMPYElbPG0/hSKTHjqjkeaD9ylozLFgf3BFadqoeAzw");
	});
});
