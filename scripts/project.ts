// Creates and lists Checkend projects through the API (POST/GET /v1/projects).
//
//   CHECKEND_URL=https://your-checkend.example CHECKEND_ADMIN_TOKEN=... \
//     npm run project -- create --name "My App" [--platform node] [--json]
//   npm run project -- list [--json]
//
// The admin token is the ADMIN_TOKEN secret of the Worker. Runs on Node 22.18+ (type stripping).
import { fileURLToPath } from "node:url";

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Env = Record<string, string | undefined>;

const USAGE = `Usage:
  npm run project -- create --name <name> [--platform <platform>] [--json]
  npm run project -- list [--json]

Environment: CHECKEND_URL (for example https://checkend.example.workers.dev) and
CHECKEND_ADMIN_TOKEN (the ADMIN_TOKEN secret of the Worker).`;

function option(argv: string[], name: string): string | undefined {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] : undefined;
}

interface Project {
	id: number;
	slug: string;
	name: string;
	platform: string | null;
	dsn?: string;
	dsns?: string[];
}

export async function run(
	argv: string[],
	env: Env,
	fetchFn: Fetch = fetch,
	print: (line: string) => void = console.log,
): Promise<number> {
	const [command] = argv;
	const json = argv.includes("--json");
	const name = option(argv, "name");
	if ((command !== "create" && command !== "list") || (command === "create" && !name)) {
		print(USAGE);
		return 2;
	}
	const base = env.CHECKEND_URL?.replace(/\/+$/, "");
	if (!base) {
		print("Set CHECKEND_URL to the URL of your Checkend instance.");
		return 1;
	}
	if (!env.CHECKEND_ADMIN_TOKEN) {
		print("Set CHECKEND_ADMIN_TOKEN to the ADMIN_TOKEN secret of your Checkend Worker.");
		return 1;
	}
	const headers = {
		authorization: `Bearer ${env.CHECKEND_ADMIN_TOKEN}`,
		"content-type": "application/json",
	};

	const response =
		command === "create"
			? await fetchFn(`${base}/v1/projects`, {
					method: "POST",
					headers,
					body: JSON.stringify({ name, platform: option(argv, "platform") }),
				})
			: await fetchFn(`${base}/v1/projects`, { headers });
	const body = (await response.json().catch(() => null)) as { data?: unknown } | null;
	if (!response.ok || !body?.data) {
		print(`Request failed: HTTP ${response.status} ${JSON.stringify(body)}`);
		return 1;
	}

	if (command === "create") {
		const project = body.data as Project;
		if (json) print(JSON.stringify(project, null, 2));
		else {
			print(`Created project ${project.id} (${project.slug}).`);
			print(`DSN: ${project.dsn}`);
			print('Put the DSN in your Sentry SDK: Sentry.init({ dsn: "..." }).');
		}
		return 0;
	}
	const projects = body.data as Project[];
	if (json) print(JSON.stringify(projects, null, 2));
	else if (projects.length === 0) print("No projects yet.");
	else for (const p of projects) print(`${p.id}\t${p.slug}\t${p.name}\t${p.dsns?.join(" ") ?? ""}`);
	return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(2), process.env);
}
