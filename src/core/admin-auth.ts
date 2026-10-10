const sha256 = async (text: string) =>
	new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));

/**
 * Checks `Authorization: Bearer <token>` against the admin token. Compares SHA-256 digests in
 * constant time, so the time does not show how much of the token matched. Without a
 * configured token, every request fails.
 */
export async function isAdmin(
	authorization: string | null,
	adminToken: string | null,
): Promise<boolean> {
	if (!adminToken) return false;
	const token = /^Bearer\s+(.+)$/i.exec(authorization ?? "")?.[1]?.trim() ?? "";
	const [given, expected] = await Promise.all([sha256(token), sha256(adminToken)]);
	let difference = 0;
	for (let i = 0; i < expected.length; i++) difference |= (given[i] ?? 0) ^ (expected[i] ?? 0);
	return difference === 0;
}
