import { checkMail, type Mailer } from "../../ports/mailer.ts";

/** The part of the Email Service binding that the mailer uses. */
export interface EmailBinding {
	send(message: { to: string[]; from: string; subject: string; text: string }): Promise<unknown>;
}

/** Mailer on the Cloudflare Email Service binding (`send_email`). `from` is EMAIL_FROM. */
export function cloudflareMailer(binding: EmailBinding, from: string): Mailer {
	return {
		async send(message) {
			checkMail(message);
			await binding.send({ to: message.to, from, subject: message.subject, text: message.text });
		},
	};
}
