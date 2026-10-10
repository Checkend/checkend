import { describe, expect, it } from "vitest";
import {
	finishSetup,
	finishSignIn,
	relyingPartyFor,
	setupOptions,
	signInOptions,
} from "../../src/core/auth/passkeys.ts";
import { getSession } from "../../src/core/auth/sessions.ts";
import type { Ports } from "../../src/ports/index.ts";
import { VirtualAuthenticator } from "../shared/virtual-authenticator.ts";

/**
 * Passkey setup and sign-in with a software authenticator. WebAuthn verification must give
 * the same result in workerd and on Node (Web Crypto only). `makePorts` returns ports with an
 * empty, migrated database and SETUP_CODE = `setupCode`.
 */
export function passkeyContract(
	name: string,
	makePorts: () => Promise<Ports>,
	setupCode: string,
): void {
	describe(`passkeys: ${name}`, () => {
		it("sets up the first member, signs in, and rejects a replay and a wrong origin", async () => {
			const ports = await makePorts();
			const rp = relyingPartyFor("https://checkend.example/setup");
			const device = new VirtualAuthenticator(rp.origin);

			const options = await setupOptions(ports, rp, { code: setupCode, name: "Simon" });
			if (!options.ok) throw new Error(options.error);
			const created = await finishSetup(ports, rp, {
				code: setupCode,
				response: await device.create(options.value),
			});
			if (!created.ok) throw new Error(created.error);
			expect(await getSession(ports, created.value.token)).toMatchObject({ memberName: "Simon" });

			const signIn = await signInOptions(ports, rp);
			const assertion = await device.get(signIn);
			const session = await finishSignIn(ports, rp, assertion);
			if (!session.ok) throw new Error(session.error);
			expect(await getSession(ports, session.value.token)).toMatchObject({ memberName: "Simon" });

			// The same response again: the challenge is used, so it fails.
			expect(await finishSignIn(ports, rp, assertion)).toEqual({
				ok: false,
				error: "invalid_credential",
			});

			// A response made for another origin (phishing site) fails.
			const other = await signInOptions(ports, rp);
			const phished = await device.get(
				{ challenge: other.challenge, rpId: rp.id },
				"https://evil.example",
			);
			expect(await finishSignIn(ports, rp, phished)).toEqual({
				ok: false,
				error: "invalid_credential",
			});
		});
	});
}
