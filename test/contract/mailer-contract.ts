import { describe, expect, it } from "vitest";
import type { Mailer, MailMessage } from "../../src/ports/mailer.ts";

/**
 * The behaviour every Mailer adapter must have. `sent()` returns the messages that arrived (the
 * fake SMTP server, the fake binding, or the memory mailer).
 */
export function mailerContract(
	adapterName: string,
	make: () =>
		| Promise<{ mailer: Mailer; sent: () => MailMessage[] }>
		| { mailer: Mailer; sent: () => MailMessage[] },
): void {
	describe(`Mailer contract: ${adapterName}`, () => {
		it("sends a message with its recipients, subject and text", async () => {
			const { mailer, sent } = await make();
			await mailer.send({
				to: ["ops@example.com", "dev@example.com"],
				subject: "[Checkend] New issue 42: TypeError ✓",
				text: "Line one\n.line that starts with a dot\nÜmlaut",
			});
			expect(sent()).toEqual([
				{
					to: ["ops@example.com", "dev@example.com"],
					subject: "[Checkend] New issue 42: TypeError ✓",
					text: "Line one\n.line that starts with a dot\nÜmlaut",
				},
			]);
		});

		it("rejects a subject with a line break, a bad address, and too many recipients", async () => {
			const { mailer, sent } = await make();
			const ok = { to: ["ops@example.com"], subject: "s", text: "t" };
			await expect(mailer.send({ ...ok, subject: "a\r\nBcc: x@example.com" })).rejects.toThrow(
				TypeError,
			);
			await expect(
				mailer.send({ ...ok, to: ["ops@example.com>\r\nRCPT TO:<x@example.com"] }),
			).rejects.toThrow(TypeError);
			await expect(mailer.send({ ...ok, to: [] })).rejects.toThrow(TypeError);
			await expect(
				mailer.send({ ...ok, to: Array.from({ length: 51 }, (_, i) => `u${i}@example.com`) }),
			).rejects.toThrow(TypeError);
			expect(sent()).toEqual([]);
		});
	});
}
