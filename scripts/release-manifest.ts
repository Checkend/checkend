// Writes checkend-release.json (format 1): the manifest of a server release, which `ce server
// install` and `ce server upgrade` verify. The reader is the contract:
// checkend-cli internal/serverrelease/serverrelease.go. The release workflow
// (.github/workflows/release.yml) runs this script; the signature comes in a separate job.
//
//   node scripts/release-manifest.ts --version 0.9.0 --commit <40 hex> \
//     --worker checkend-worker-0.9.0.tar.gz --migrations checkend-migrations-0.9.0.tar.gz \
//     --image-digest sha256:<64 hex> --caddy docker.io/library/caddy@sha256:<64 hex> \
//     --cloudflared docker.io/cloudflare/cloudflared@sha256:<64 hex> --out checkend-release.json
//
// Never put a secret or a default value of a secret in the manifest: it is public.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** The oldest ce that can install this release (the first ce with the format-1 reader). */
export const MIN_CLI_VERSION = "0.2.0";

export const IMAGE_REPOSITORY = "ghcr.io/checkend/checkend";
export const IMAGE_PLATFORMS = ["linux/amd64", "linux/arm64"];
export const PROXY_REPOSITORIES = {
	caddy: "docker.io/library/caddy",
	cloudflared: "docker.io/cloudflare/cloudflared",
} as const;

/** The Worker bundle: one ES module, from `wrangler deploy --dry-run --outdir`. */
export const MAIN_MODULE = "worker.js";

/**
 * The bindings of the Worker. DB is required; the others are optional: the Worker detects them
 * at runtime (src/adapters/cloudflare/ports.ts). A test checks this list against the code.
 */
export const OPTIONAL_BINDINGS = [
	{ type: "r2", name: "BLOBS" },
	{ type: "queue", name: "INGEST_QUEUE" },
	{ type: "queue", name: "NOTIFY" },
	{ type: "ratelimit", name: "INGEST_RATE_LIMITER" },
	{ type: "send_email", name: "EMAIL" },
	{ type: "ai", name: "AI" },
	{ type: "vectorize", name: "VECTORIZE" },
] as const;

export interface Setting {
	secret: boolean;
	min_length?: number;
	format?: string;
}

/**
 * The settings of src/adapters/config-env.ts, without CHECKEND_DEV (never in production). No
 * setting has a default value: the reader refuses one.
 */
export const SETTINGS: Record<string, Setting> = {
	ADMIN_TOKEN: { secret: true, min_length: 32 },
	SETUP_CODE: { secret: true, format: "<unix seconds>.<code>" },
	ENCRYPTION_KEYS: { secret: true, format: "<id>:<base64 of 32 bytes>[,<id>:<...>]" },
	GITHUB_WEBHOOK_SECRET: { secret: true },
	GITHUB_TOKEN: { secret: true },
	PUBLIC_URL: { secret: false, format: "https://<host>" },
	D1_DAILY_ROW_LIMIT: { secret: false },
	DAILY_EVENT_LIMIT: { secret: false },
	EVENTS_PER_ISSUE: { secret: false },
	NEW_ISSUES_PER_HOUR: { secret: false },
	TAG_KEYS_PER_PROJECT: { secret: false },
	REQUIRE_APPROVAL: { secret: false, format: "comma-separated: delete_project, ignore, merge" },
	VERIFY_QUIET_HOURS: { secret: false },
	RETENTION_DAYS: { secret: false },
	EMAIL_FROM: { secret: false },
	AI_GATEWAY_ID: { secret: false },
	AI_GATEWAY_LOGS: { secret: false, format: "on" },
	AI_TRIAGE: { secret: false, format: "on" },
	AI_SIMILAR: { secret: false, format: "on" },
};

export interface ManifestInput {
	version: string;
	commit: string;
	publishedAt: string;
	worker: { asset: string; bytes: Uint8Array };
	migrations: { asset: string; bytes: Uint8Array };
	/** The sorted file names of migrations/. */
	migrationFiles: string[];
	/** The text of wrangler.jsonc. */
	wranglerJsonc: string;
	imageDigest: string;
	proxies: { caddy: string; cloudflared: string };
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** JSONC: remove the // comment lines (the file has no "//" inside its values). */
export const parseJsonc = (text: string) =>
	JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) as Record<string, any>;

const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** The same rules as the reader: a bad value stops the release before anything is written. */
function checkInput(input: ManifestInput) {
	if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(input.version)) {
		throw new Error(`Not a version: ${JSON.stringify(input.version)} (for example 0.9.0).`);
	}
	if (!/^[0-9a-f]{40}$/.test(input.commit)) throw new Error("The commit is not a full SHA.");
	if (!DIGEST.test(input.imageDigest)) throw new Error("The image digest is not sha256:<64 hex>.");
	for (const [name, repository] of Object.entries(PROXY_REPOSITORIES)) {
		const [repo, digest] = input.proxies[name as keyof typeof PROXY_REPOSITORIES].split("@");
		if (repo !== repository || !DIGEST.test(digest ?? "")) {
			throw new Error(`The ${name} image is not ${repository}@sha256:<64 hex>.`);
		}
	}
}

export function buildManifest(input: ManifestInput) {
	checkInput(input);
	const wrangler = parseJsonc(input.wranglerJsonc);
	const migrations = input.migrationFiles.filter((name) => name.endsWith(".sql")).sort();
	const latest = migrations.at(-1);
	if (!latest) throw new Error("No migrations.");
	const d1 = (wrangler.d1_databases ?? []) as { binding: string }[];
	if (!d1.some((db) => db.binding === "DB"))
		throw new Error("wrangler.jsonc has no D1 binding DB.");
	return {
		format: 1,
		version: input.version,
		tag: `v${input.version}`,
		commit: input.commit,
		published_at: input.publishedAt,
		min_cli_version: MIN_CLI_VERSION,
		migrations: {
			asset: input.migrations.asset,
			sha256: sha256(input.migrations.bytes),
			size: input.migrations.bytes.byteLength,
			latest,
			count: migrations.length,
		},
		worker: {
			asset: input.worker.asset,
			sha256: sha256(input.worker.bytes),
			size: input.worker.bytes.byteLength,
			main_module: MAIN_MODULE,
			modules: [{ name: MAIN_MODULE, type: "esm" }],
			compatibility_date: wrangler.compatibility_date as string,
			compatibility_flags: (wrangler.compatibility_flags ?? []) as string[],
			bindings: [
				{ type: "d1", name: "DB", required: true },
				...OPTIONAL_BINDINGS.map((b) => ({ ...b, required: false })),
			],
			crons: (wrangler.triggers?.crons ?? []) as string[],
			observability: wrangler.observability?.enabled === true,
		},
		image: {
			repository: IMAGE_REPOSITORY,
			tag: input.version,
			digest: input.imageDigest,
			platforms: IMAGE_PLATFORMS,
		},
		settings: SETTINGS,
		proxies: input.proxies,
	};
}

export type Manifest = ReturnType<typeof buildManifest>;

function main(argv: string[]) {
	const { values } = parseArgs({
		args: argv,
		options: {
			version: { type: "string" },
			commit: { type: "string" },
			worker: { type: "string" },
			migrations: { type: "string" },
			"image-digest": { type: "string" },
			caddy: { type: "string" },
			cloudflared: { type: "string" },
			"published-at": { type: "string" },
			out: { type: "string" },
		},
	});
	const need = (name: keyof typeof values) => {
		const value = values[name];
		if (typeof value !== "string" || value === "") throw new Error(`Give --${name}.`);
		return value;
	};
	const worker = need("worker");
	const migrations = need("migrations");
	const manifest = buildManifest({
		version: need("version"),
		commit: need("commit"),
		publishedAt: values["published-at"] ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
		worker: { asset: basename(worker), bytes: readFileSync(worker) },
		migrations: { asset: basename(migrations), bytes: readFileSync(migrations) },
		migrationFiles: readdirSync("migrations"),
		wranglerJsonc: readFileSync("wrangler.jsonc", "utf8"),
		imageDigest: need("image-digest"),
		proxies: { caddy: need("caddy"), cloudflared: need("cloudflared") },
	});
	writeFileSync(need("out"), `${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
