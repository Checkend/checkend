/**
 * Runs work after the response is sent. On Cloudflare it is `ctx.waitUntil()`: the work can
 * stop 30 seconds after the response, and it is not retried by the platform.
 */
export type Defer = (task: Promise<unknown>) => void;
