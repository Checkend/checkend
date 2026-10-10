const KEY = /^[0-9a-f]{32}$/;

/** The DSN public key from the X-Sentry-Auth header or the `sentry_key` query parameter. */
export function sentryKeyFromRequest(request: Request): string | null {
	const header = request.headers.get("x-sentry-auth") ?? request.headers.get("authorization") ?? "";
	const fromHeader = /^\s*Sentry\s+(.*)$/i
		.exec(header)?.[1]
		?.split(",")
		.map((part) => part.trim().split("="))
		.find(([name]) => name === "sentry_key")?.[1];
	const key = fromHeader ?? new URL(request.url).searchParams.get("sentry_key");
	return key ? key.trim().toLowerCase() : null;
}

/** The public key and project ID of a DSN (`https://KEY@host/PROJECT`). */
export function parseDsn(dsn: unknown): { key: string; projectId: string } | null {
	if (typeof dsn !== "string") return null;
	try {
		const url = new URL(dsn);
		const projectId = url.pathname.split("/").filter(Boolean).at(-1);
		return url.username && projectId ? { key: url.username.toLowerCase(), projectId } : null;
	} catch {
		return null;
	}
}

export const isValidKey = (key: string | null): key is string => key !== null && KEY.test(key);
