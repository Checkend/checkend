import type { Defer } from "../../ports/defer.ts";

/**
 * Background work after the response, like ctx.waitUntil. drain() waits for all of it: the
 * server calls it on SIGTERM, after it stops taking requests, so that no write is lost.
 */
export function nodeDefer(): { defer: Defer; drain: () => Promise<void>; pending: () => number } {
	const running = new Set<Promise<unknown>>();
	const defer: Defer = (task) => {
		const tracked = Promise.resolve(task)
			.catch((error) => {
				console.error(
					JSON.stringify({
						message: "checkend: background task failed",
						error: String(error).slice(0, 300),
					}),
				);
			})
			.finally(() => running.delete(tracked));
		running.add(tracked);
	};
	return {
		defer,
		pending: () => running.size,
		async drain() {
			while (running.size > 0) await Promise.allSettled([...running]);
		},
	};
}
