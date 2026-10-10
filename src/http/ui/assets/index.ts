import type { Hono } from "hono";
import type { AppEnv } from "../../app.ts";
import { CLIENT_SCRIPT } from "./client.ts";
import { STYLES } from "./styles.ts";

/** FNV-1a, 32 bits: a content hash for cache-busting file names. Not for security. */
function contentHash(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

const FAVICON =
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#7c3aed"/><path d="M24 16A8 8 0 1 1 21.66 10.34" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/><circle cx="22" cy="10" r="2.5" fill="#fff"/></svg>';

const files = [
	{ name: `app.${contentHash(STYLES)}.css`, type: "text/css; charset=utf-8", body: STYLES },
	{
		name: `app.${contentHash(CLIENT_SCRIPT)}.js`,
		type: "text/javascript; charset=utf-8",
		body: CLIENT_SCRIPT,
	},
	{ name: `icon.${contentHash(FAVICON)}.svg`, type: "image/svg+xml", body: FAVICON },
];

/** Paths for the page shell. The names change when the content changes. */
export const ASSETS = {
	css: `/assets/${files[0]?.name}`,
	js: `/assets/${files[1]?.name}`,
	icon: `/assets/${files[2]?.name}`,
};

/**
 * Serves the stylesheet, the script and the icon from the Worker itself (no Static Assets
 * binding), so that the Node entry serves them the same way.
 */
export function assetRoutes(app: Hono<AppEnv>): void {
	for (const file of files) {
		app.get(
			`/assets/${file.name}`,
			() =>
				new Response(file.body, {
					headers: {
						"content-type": file.type,
						"cache-control": "public, max-age=31536000, immutable",
						"x-content-type-options": "nosniff",
					},
				}),
		);
	}
}
