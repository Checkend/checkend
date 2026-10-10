import { applyD1Migrations, createExecutionContext, env } from "cloudflare:test";
import { cloudflarePorts } from "../../src/adapters/cloudflare/ports.ts";
import { passkeyContract } from "../contract/passkey-contract.ts";

passkeyContract(
	"D1 (workerd)",
	async () => {
		await applyD1Migrations(env.DB, env.TEST_D1_MIGRATIONS);
		return cloudflarePorts(env, createExecutionContext());
	},
	env.SETUP_CODE,
);
