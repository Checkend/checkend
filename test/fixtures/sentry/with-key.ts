/**
 * The headers of a fixture with another DSN key. Some SDKs (Python, Ruby, PHP, Go, .NET) send
 * the key in X-Sentry-Auth, not in the query: a replay must change it there too.
 */
export function withKey(headers: Record<string, string>, key: string): Record<string, string> {
	const auth = headers["x-sentry-auth"];
	if (!auth) return headers;
	return { ...headers, "x-sentry-auth": auth.replace(/sentry_key=[0-9a-f]+/, `sentry_key=${key}`) };
}
