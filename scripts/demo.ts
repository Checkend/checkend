// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the demo source lines are code with ${} on purpose.
// Demo data for a LOCAL Checkend: creates (or reuses) a "Demo" project and sends realistic
// error events through the real ingest endpoint, spread over the last 14 days.
//
//   npm run dev                      # in one terminal (it sets CHECKEND_DEV=1)
//   npm run demo                     # in another; default URL http://localhost:8787
//   npm run demo -- --url http://127.0.0.1:8787 --days 7
//
// It refuses every URL that is not localhost, 127.0.0.1 or [::1]. The events carry an
// X-Checkend-Demo-Time header; only a server in development mode (CHECKEND_DEV=1) on
// localhost uses it, so on any other server the events would land "now".
// The admin token comes from CHECKEND_ADMIN_TOKEN, or from ADMIN_TOKEN in .dev.vars.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { loadSentryFixture } from "../test/fixtures/sentry/load.ts";

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Env = Record<string, string | undefined>;
type Json = Record<string, unknown>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DAY = 86400_000;

/** True only for http(s) URLs on this machine, without user info. */
export function isLocalUrl(text: string): boolean {
	try {
		const url = new URL(text);
		return (
			(url.protocol === "http:" || url.protocol === "https:") &&
			LOCAL_HOSTS.has(url.hostname) &&
			url.username === "" &&
			url.password === ""
		);
	} catch {
		return false;
	}
}

// --- deterministic random numbers (mulberry32), so a run is reproducible ----------------

function random(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const pick = <T>(rng: () => number, list: readonly T[]): T =>
	list[Math.floor(rng() * list.length)] as T;

// --- templates from the golden fixtures (real SDK output) -------------------------------

function fixtureEvent(name: string): Json {
	const fixture = loadSentryFixture(name);
	const body =
		fixture.headers["content-encoding"] === "gzip" ? gunzipSync(fixture.body) : fixture.body;
	const [, , payload] = Buffer.from(body).toString("utf8").split("\n");
	return JSON.parse(payload ?? "{}");
}

// --- scenarios ---------------------------------------------------------------------------

interface Frame {
	file: string;
	fn: string;
	line: number;
	/** Source lines around `line`: [before..., the line, after...]; the line is in the middle. */
	source?: string[];
	inApp?: boolean;
}

interface Scenario {
	platform: "node" | "javascript";
	/** Null: a captureMessage event. */
	type: string | null;
	value: string;
	level?: "fatal" | "error" | "warning";
	handled?: boolean;
	/** Oldest call first (Sentry order); the last frame raised the error. */
	frames: Frame[];
	cause?: { type: string; value: string; frames: Frame[] };
	/** Events on a day, by days ago (0 = today). */
	perDay: (daysAgo: number) => number;
	staging?: number;
	transaction?: string;
	route?: string;
}

const NODE_RUNTIME: Frame[] = [
	{
		file: "node:internal/process/task_queues",
		fn: "process.processTicksAndRejections",
		line: 105,
		inApp: false,
	},
	{
		file: "/srv/shop/node_modules/express/lib/router/layer.js",
		fn: "Layer.handle [as handle_request]",
		line: 95,
		inApp: false,
	},
];

const SCENARIOS: Scenario[] = [
	{
		platform: "node",
		type: "TypeError",
		value: "Cannot read properties of undefined (reading 'currency')",
		handled: false,
		transaction: "POST /api/checkout",
		frames: [
			...NODE_RUNTIME,
			{
				file: "src/routes/checkout.ts",
				fn: "checkout",
				line: 31,
				source: [
					"export async function checkout(req: Request, res: Response) {",
					"  const cart = await loadCart(req.session.cartId);",
					"  const total = computeTotal(cart, req.body.priceList);",
					"  res.json({ total });",
					"}",
				],
			},
			{
				file: "src/checkout/total.ts",
				fn: "computeTotal",
				line: 48,
				source: [
					"export function computeTotal(cart: Cart, list?: PriceList) {",
					"  const subtotal = cart.items.reduce((sum, i) => sum + i.price * i.qty, 0);",
					"  return money(subtotal + shipping(cart), list.currency);",
					"}",
					"",
				],
			},
		],
		// Introduced in 2.4.1 (3 days ago); a spike 2 days ago.
		perDay: (d) => (d > 2 ? 0 : d === 2 ? 70 : 14),
	},
	{
		platform: "node",
		type: "DatabaseError",
		value: "deadlock detected while waiting for ShareLock on transaction 4412",
		transaction: "POST /api/orders",
		frames: [
			...NODE_RUNTIME,
			{
				file: "src/orders/save.ts",
				fn: "saveOrder",
				line: 77,
				source: [
					"  await db.transaction(async (tx) => {",
					"    await tx.insert(orders).values(order);",
					"    await tx.update(stock).set({ qty: sql`qty - ${order.qty}` });",
					"  });",
					"",
				],
			},
			{
				file: "src/db/client.ts",
				fn: "Client.query",
				line: 52,
				source: [
					"  async query(text: string, params: unknown[]) {",
					"    const started = performance.now();",
					"    const result = await this.pool.query(text, params);",
					"    metrics.observe(performance.now() - started);",
					"    return result;",
				],
			},
		],
		perDay: (d) => (d % 3 === 0 ? 4 : 2),
	},
	{
		platform: "node",
		type: "FetchError",
		value: "request to https://payments.example.com/v1/charges failed, reason: ETIMEDOUT",
		transaction: "POST /api/checkout",
		frames: [
			...NODE_RUNTIME,
			{
				file: "src/payments/charge.ts",
				fn: "createCharge",
				line: 22,
				source: [
					"export async function createCharge(order: Order) {",
					"  const response = await fetch(`${PAYMENTS_URL}/v1/charges`, {",
					'    method: "POST", body: JSON.stringify(chargeFor(order)), signal: AbortSignal.timeout(10_000),',
					"  });",
					"  if (!response.ok) throw new PaymentError(response.status);",
				],
			},
		],
		// A payment provider outage 6 days ago; nothing since (looks resolved).
		perDay: (d) => (d === 6 ? 55 : d === 5 ? 9 : 0),
	},
	{
		platform: "node",
		type: "ValidationError",
		value: '"email" must be a valid email',
		level: "warning",
		handled: true,
		transaction: "POST /api/signup",
		staging: 0.7,
		frames: [
			...NODE_RUNTIME,
			{
				file: "src/routes/signup.ts",
				fn: "signup",
				line: 14,
				source: [
					"export async function signup(req: Request, res: Response) {",
					"  const input = SignupSchema.parse(req.body);",
					"  const user = await users.create(input);",
					"  res.status(201).json(user);",
					"}",
				],
			},
		],
		perDay: (d) => 3 + (d % 2),
	},
	{
		platform: "node",
		type: "RangeError",
		value: "Invalid time value",
		transaction: "GET /api/reports/daily",
		frames: [
			{
				file: "src/reports/daily.ts",
				fn: "dailyReport",
				line: 18,
				source: [
					"export async function dailyReport(from: string, to: string) {",
					"  const range = formatRange(new Date(from), new Date(to));",
					"  return render(range, await totals(from, to));",
					"}",
					"",
				],
			},
			{
				file: "src/reports/format.ts",
				fn: "formatRange",
				line: 9,
				source: [
					"export function formatRange(from: Date, to: Date) {",
					'  const fmt = new Intl.DateTimeFormat("en", { dateStyle: "medium" });',
					"  return `${fmt.format(from)} – ${fmt.format(to)}`;",
					"}",
					"",
				],
			},
		],
		// Only in 2.3.1; fixed in 2.4.0 (8 days ago).
		perDay: (d) => (d >= 8 ? 5 : 0),
	},
	{
		platform: "node",
		type: "Error",
		value: "Failed to send the receipt email",
		transaction: "POST /api/orders",
		frames: [
			...NODE_RUNTIME,
			{
				file: "src/mail/receipt.ts",
				fn: "sendReceipt",
				line: 40,
				source: [
					"  try {",
					"    await mailer.send(receiptFor(order));",
					"  } catch (cause) {",
					'    throw new Error("Failed to send the receipt email", { cause });',
					"  }",
				],
			},
		],
		cause: {
			type: "Error",
			value: "connect ECONNREFUSED 10.0.4.12:587",
			frames: [
				{
					file: "/srv/shop/node_modules/nodemailer/lib/smtp-connection/index.js",
					fn: "SMTPConnection._onError",
					line: 801,
					inApp: false,
				},
			],
		},
		perDay: (d) => (d === 4 || d === 1 ? 6 : 1),
	},
	{
		platform: "node",
		type: null,
		value: "Inventory sync took longer than 30 s",
		level: "warning",
		frames: [],
		perDay: () => 2,
	},
	{
		platform: "javascript",
		type: "TypeError",
		value: "Cannot read properties of null (reading 'addEventListener')",
		handled: false,
		route: "/cart",
		frames: [
			{
				file: "https://shop.example/assets/vendor.8b21f0c4.js",
				fn: "HTMLDocument.<anonymous>",
				line: 2,
				inApp: false,
			},
			{
				file: "https://shop.example/assets/cart.4f1c2e9a.js",
				fn: "mountCart",
				line: 1,
				inApp: true,
			},
		],
		// Only on 2.4.1, growing.
		perDay: (d) => (d > 2 ? 0 : 20 - d * 6),
	},
	{
		platform: "javascript",
		type: "ChunkLoadError",
		value: "Loading chunk 412 failed. (error: https://shop.example/assets/412.c09d1e2b.js)",
		handled: false,
		route: "/products",
		frames: [
			{
				file: "https://shop.example/assets/runtime.0a7e2f11.js",
				fn: "o.f.j",
				line: 1,
				inApp: true,
			},
		],
		// After each deploy, old tabs load missing chunks.
		perDay: (d) => (d === 8 || d === 3 ? 18 : 1),
	},
	{
		platform: "javascript",
		type: "SyntaxError",
		value: "Unexpected token '<', \"<!doctype \"... is not valid JSON",
		route: "/account",
		staging: 0.3,
		frames: [
			{
				file: "https://shop.example/assets/app.5d9e7a10.js",
				fn: "parseResponse",
				line: 1,
				inApp: true,
			},
			{ file: "https://shop.example/assets/app.5d9e7a10.js", fn: "apiGet", line: 1, inApp: true },
		],
		perDay: (d) => (d % 4 === 0 ? 5 : 2),
	},
	{
		platform: "javascript",
		type: "Error",
		value: "ResizeObserver loop completed with undelivered notifications.",
		level: "warning",
		route: "/products",
		frames: [],
		perDay: () => 3,
	},
];

const releaseAt = (daysAgo: number) =>
	daysAgo >= 8 ? "shop@2.3.1" : daysAgo >= 3 ? "shop@2.4.0" : "shop@2.4.1";

const BROWSERS = [
	["Chrome", "141.0.0"],
	["Safari", "26.0"],
	["Firefox", "143.0"],
	["Edge", "141.0.0"],
] as const;
const OSES = ["macOS", "Windows", "iOS", "Android"] as const;

function sentryFrame(frame: Frame, platform: Scenario["platform"]): Json {
	const lines = frame.source ?? [];
	const mid = Math.floor(lines.length / 2);
	const inApp = frame.inApp ?? true;
	const filename =
		platform === "node" && !frame.file.startsWith("/") && !frame.file.startsWith("node:")
			? `/srv/shop/${frame.file}`
			: frame.file;
	return {
		filename,
		abs_path: filename,
		function: frame.fn,
		lineno: frame.line,
		colno: platform === "javascript" ? 10_000 + frame.fn.length * 97 : 12,
		in_app: inApp,
		...(platform === "node" && inApp
			? {
					module: frame.file
						.replace(/^src\//, "")
						.replace(/\.ts$/, "")
						.replace(/\//g, "."),
				}
			: {}),
		...(lines.length > 0
			? {
					pre_context: lines.slice(0, mid),
					context_line: lines[mid],
					post_context: lines.slice(mid + 1),
				}
			: {}),
	};
}

export interface DemoEvent {
	/** When the event happened (ISO); sent as X-Checkend-Demo-Time. */
	at: string;
	event: Json;
}

/** The demo events of the last `days` days before `now`, oldest first. Deterministic. */
export function demoEvents(now: Date, days: number, seed = 1015): DemoEvent[] {
	const rng = random(seed);
	const node = fixtureEvent("node-type-error");
	const browser = fixtureEvent("browser-unhandled-error");
	const out: DemoEvent[] = [];
	for (const scenario of SCENARIOS) {
		for (let daysAgo = days - 1; daysAgo >= 0; daysAgo--) {
			const n = Math.round(scenario.perDay(daysAgo) * (0.7 + 0.6 * rng()));
			for (let i = 0; i < n; i++) {
				const at = new Date(now.getTime() - daysAgo * DAY - Math.floor(rng() * DAY));
				out.push({ at: at.toISOString(), event: build(scenario, at, daysAgo, rng, node, browser) });
			}
		}
	}
	return out.sort((a, b) => a.at.localeCompare(b.at));
}

function build(
	s: Scenario,
	at: Date,
	daysAgo: number,
	rng: () => number,
	node: Json,
	browser: Json,
): Json {
	const template = s.platform === "node" ? node : browser;
	const userId = `u_${1000 + Math.floor(rng() * 400)}`;
	const environment = rng() < (s.staging ?? 0.08) ? "staging" : "production";
	const [browserName, browserVersion] = pick(rng, BROWSERS);
	const exception =
		s.type === null
			? undefined
			: {
					values: [
						...(s.cause
							? [
									{
										type: s.cause.type,
										value: s.cause.value,
										stacktrace: { frames: s.cause.frames.map((f) => sentryFrame(f, s.platform)) },
										mechanism: { type: "chained", handled: true },
									},
								]
							: []),
						{
							type: s.type,
							value: s.value,
							...(s.frames.length > 0
								? { stacktrace: { frames: s.frames.map((f) => sentryFrame(f, s.platform)) } }
								: {}),
							mechanism: {
								type: s.platform === "node" ? "onunhandledrejection" : "onerror",
								handled: s.handled ?? true,
							},
						},
					],
				};
	const event: Json = {
		event_id: crypto.randomUUID().replace(/-/g, ""),
		timestamp: at.getTime() / 1000,
		platform: s.platform,
		level: s.level ?? "error",
		release: releaseAt(daysAgo),
		environment,
		sdk: template.sdk,
		...(exception ? { exception } : { message: s.value }),
		user: { id: userId },
		breadcrumbs: [
			{
				timestamp: at.getTime() / 1000 - 4,
				category: "http",
				data: { method: "GET", url: "/api/session", status_code: 200 },
			},
			{
				timestamp: at.getTime() / 1000 - 1,
				category: s.platform === "node" ? "console" : "ui.click",
				message: s.platform === "node" ? "handling request" : "button#checkout",
			},
		],
	};
	if (s.platform === "node") {
		event.server_name = pick(rng, ["web-1", "web-2", "web-3"]);
		event.contexts = node.contexts;
		event.tags = {
			...(s.transaction ? { transaction: s.transaction } : {}),
			region: pick(rng, ["us-east", "us-east", "eu-west"]),
		};
		if (s.transaction) {
			const [method, path] = s.transaction.split(" ");
			event.request = {
				method,
				url: `https://shop.example${path}`,
				headers: { "User-Agent": "shop-web/2.4" },
			};
		}
	} else {
		event.contexts = {
			...(browser.contexts as Json),
			browser: { name: browserName, version: browserVersion },
			os: { name: pick(rng, OSES) },
		};
		event.tags = { page: s.route ?? "/" };
		event.request = {
			url: `https://shop.example${s.route ?? "/"}`,
			headers: { "User-Agent": `Mozilla/5.0 (${browserName} ${browserVersion})` },
		};
	}
	return event;
}

// --- sending -----------------------------------------------------------------------------

function option(argv: string[], name: string): string | undefined {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] : undefined;
}

function devVarsToken(): string | undefined {
	if (!existsSync(".dev.vars")) return undefined;
	const line = readFileSync(".dev.vars", "utf8")
		.split("\n")
		.find((l) => /^\s*ADMIN_TOKEN\s*=/.test(l));
	return line
		?.replace(/^\s*ADMIN_TOKEN\s*=\s*/, "")
		.trim()
		.replace(/^["']|["']$/g, "");
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function run(
	argv: string[],
	env: Env,
	fetchFn: Fetch = fetch,
	print: (line: string) => void = console.log,
	now: Date = new Date(),
): Promise<number> {
	const base = (option(argv, "url") ?? "http://localhost:8787").replace(/\/+$/, "");
	if (!isLocalUrl(base)) {
		print(`npm run demo only sends to localhost, 127.0.0.1 or [::1]. Refused: ${base}`);
		return 1;
	}
	const days = Math.min(Math.max(Number(option(argv, "days") ?? 14) || 14, 1), 28);
	const token = env.CHECKEND_ADMIN_TOKEN ?? devVarsToken();
	if (!token) {
		print(
			"Set CHECKEND_ADMIN_TOKEN, or put ADMIN_TOKEN=... in .dev.vars (the local server reads it too).",
		);
		return 1;
	}
	const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };

	// The Demo project: reuse it when it exists.
	const list = await fetchFn(`${base}/v1/projects`, { headers: auth }).catch(() => null);
	if (!list) {
		print(`No Checkend at ${base}. Start it with: npm run dev`);
		return 1;
	}
	if (!list.ok) {
		print(`GET /v1/projects failed: HTTP ${list.status}. Check the admin token.`);
		return 1;
	}
	const projects = ((await list.json()) as { data: { slug: string; dsns?: string[] }[] }).data;
	let dsn = projects.find((p) => p.slug === "demo")?.dsns?.[0];
	if (!dsn) {
		const created = await fetchFn(`${base}/v1/projects`, {
			method: "POST",
			headers: auth,
			body: JSON.stringify({ name: "Demo", platform: "node" }),
		});
		if (!created.ok) {
			print(`Could not create the Demo project: HTTP ${created.status}`);
			return 1;
		}
		dsn = ((await created.json()) as { data: { dsn: string } }).data.dsn;
	}
	const parsed = new URL(dsn);
	const key = parsed.username;
	const projectId = parsed.pathname.replace(/^\//, "");

	const events = demoEvents(now, days);
	print(`Sending ${events.length} events over ${days} days to the Demo project (${projectId})…`);
	let sent = 0;
	for (const { at, event } of events) {
		const body = `${JSON.stringify({ event_id: event.event_id, sent_at: at })}\n{"type":"event"}\n${JSON.stringify(event)}\n`;
		for (let attempt = 1; attempt <= 5; attempt++) {
			const response = await fetchFn(
				`${base}/api/${projectId}/envelope/?sentry_key=${key}&sentry_version=7`,
				{
					method: "POST",
					headers: { "content-type": "application/x-sentry-envelope", "x-checkend-demo-time": at },
					body,
				},
			);
			if (response.status !== 429) {
				if (response.ok) sent++;
				else print(`An event was refused: HTTP ${response.status}`);
				break;
			}
			const wait = Number(response.headers.get("retry-after") ?? 5);
			print(`Rate limited; waiting ${wait} s…`);
			await sleep(wait * 1000);
		}
	}
	print(`Sent ${sent} events.`);

	// Without development mode, the server ignores the demo time: every issue is "now".
	const issues = await fetchFn(`${base}/v1/issues?project=demo&limit=100`, { headers: auth });
	const data = issues.ok ? ((await issues.json()) as { data: { first_seen: string }[] }).data : [];
	const oldest = Math.min(...data.map((i) => Date.parse(i.first_seen)));
	if (data.length > 0 && now.getTime() - oldest < 3600_000) {
		print("The server ignored the demo times, so all events are from today.");
		print("Start the server with `npm run dev` (it sets CHECKEND_DEV=1), then run the demo again.");
	}
	print(
		`Open ${base}/dev/login to sign in without a passkey (development only), or ${base}/login.`,
	);
	return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(2), process.env);
}
