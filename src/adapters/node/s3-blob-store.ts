import { type BlobStore, checkBlobKey, toBytes } from "../../ports/blob-store.ts";
import { sha256Hex, signV4 } from "./sigv4.ts";

export interface S3Options {
	/** For example https://s3.eu-west-1.amazonaws.com or https://<account>.r2.cloudflarestorage.com */
	endpoint: string;
	region: string;
	bucket: string;
	accessKeyId: string;
	secretAccessKey: string;
}

/** BlobStore on S3-compatible storage, with path-style URLs and SigV4. */
export function s3BlobStore(options: S3Options, send: typeof fetch = fetch): BlobStore {
	const base = options.endpoint.replace(/\/$/, "");
	const request = async (method: string, key: string, body?: Uint8Array) => {
		checkBlobKey(key);
		const url = new URL(`${base}/${options.bucket}/${key}`);
		const amzDate = new Date()
			.toISOString()
			.replace(/[-:]/g, "")
			.replace(/\.\d{3}/, "");
		const payloadHash = await sha256Hex(body ?? "");
		const headers: Record<string, string> = {
			"x-amz-content-sha256": payloadHash,
			"x-amz-date": amzDate,
		};
		const authorization = await signV4({
			method,
			url,
			headers,
			payloadHash,
			accessKeyId: options.accessKeyId,
			secretAccessKey: options.secretAccessKey,
			region: options.region,
			service: "s3",
			amzDate,
		});
		return send(url, {
			method,
			headers: { ...headers, authorization },
			...(body ? { body: new Uint8Array(body) } : {}),
		});
	};
	const ok = async (response: Response, allowed: number[] = []) => {
		if (!response.ok && !allowed.includes(response.status)) {
			throw new Error(`S3 ${response.status}: ${(await response.text()).slice(0, 200)}`);
		}
	};
	return {
		async put(key, value) {
			await ok(await request("PUT", key, toBytes(value)));
		},
		async get(key) {
			const response = await request("GET", key);
			if (response.status === 404) {
				await response.body?.cancel();
				return null;
			}
			await ok(response);
			return new Uint8Array(await response.arrayBuffer());
		},
		async delete(key) {
			await ok(await request("DELETE", key), [404]);
		},
		async deleteMany(keys) {
			for (const key of keys) checkBlobKey(key);
			// Eight at a time: one request per key (no XML batch API needed).
			for (let at = 0; at < keys.length; at += 8) {
				await Promise.all(keys.slice(at, at + 8).map((key) => this.delete(key)));
			}
		},
	};
}
