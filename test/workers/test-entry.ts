// The Worker of the workerd tests: the self-host Worker, plus Durable Object classes for the
// tests (the hosted install, and an empty object for the Db contract). wrangler.jsonc (the
// deploy-button config) has no Durable Objects.
import { DurableObject } from "cloudflare:workers";

export { CheckendInstall } from "../../src/entry/durable-object.ts";
export { default } from "../../src/entry/worker.ts";

export class TestSqlObject extends DurableObject {}
