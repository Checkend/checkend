/**
 * AWS Signature Version 4 (header form), with Web Crypto. For S3-compatible storage (AWS S3,
 * Cloudflare R2, MinIO, ...). Tested with the example request of the AWS documentation.
 */
const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
	[...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
	const bytes = typeof data === "string" ? encoder.encode(data) : data;
	return hex(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
}

async function hmac(key: Uint8Array | ArrayBuffer, text: string): Promise<ArrayBuffer> {
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		key instanceof ArrayBuffer ? key : new Uint8Array(key),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(text));
}

/** RFC 3986 encoding, as SigV4 needs it ("/" kept in paths). */
const encode = (text: string, keepSlash: boolean) =>
	[...encoder.encode(text)]
		.map((byte) => {
			const char = String.fromCharCode(byte);
			if (/[A-Za-z0-9\-_.~]/.test(char) || (keepSlash && char === "/")) return char;
			return `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
		})
		.join("");

export interface SignInput {
	method: string;
	url: URL;
	/** Headers to sign (lowercase names); host is added from the URL. */
	headers: Record<string, string>;
	payloadHash: string;
	accessKeyId: string;
	secretAccessKey: string;
	region: string;
	service: string;
	/** "YYYYMMDDTHHMMSSZ"; it must also be in headers as x-amz-date. */
	amzDate: string;
}

/** The Authorization header value. */
export async function signV4(input: SignInput): Promise<string> {
	const headers = { ...input.headers, host: input.url.host };
	const names = Object.keys(headers)
		.map((n) => n.toLowerCase())
		.sort();
	const canonicalHeaders = names
		.map(
			(n) =>
				`${n}:${String(headers[n as keyof typeof headers])
					.trim()
					.replace(/\s+/g, " ")}\n`,
		)
		.join("");
	const signedHeaders = names.join(";");
	const query = [...input.url.searchParams.entries()]
		.map(([k, v]) => [encode(k, false), encode(v, false)] as const)
		.sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
		.map(([k, v]) => `${k}=${v}`)
		.join("&");
	const path = encode(decodeURIComponent(input.url.pathname), true) || "/";
	const canonical = [
		input.method,
		path,
		query,
		canonicalHeaders,
		signedHeaders,
		input.payloadHash,
	].join("\n");
	const date = input.amzDate.slice(0, 8);
	const scope = `${date}/${input.region}/${input.service}/aws4_request`;
	const toSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, await sha256Hex(canonical)].join("\n");
	let key: ArrayBuffer = await hmac(encoder.encode(`AWS4${input.secretAccessKey}`), date);
	for (const part of [input.region, input.service, "aws4_request"]) key = await hmac(key, part);
	const signature = hex(await hmac(key, toSign));
	return `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}
