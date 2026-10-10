/**
 * Email for alerts. Adapters: the Cloudflare Email binding (`adapters/cloudflare`), SMTP on
 * Node (`adapters/node`), and the memory mailer below (tests). The sender comes from the
 * adapter's configuration (EMAIL_FROM), not from the message.
 */
export interface MailMessage {
	to: string[];
	subject: string;
	text: string;
}

export interface Mailer {
	send(message: MailMessage): Promise<void>;
}

/** Email Service allows at most 50 recipients per message. */
export const MAX_RECIPIENTS = 50;
const ADDRESS = /^[^\s@<>,;"]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/;

export const isEmailAddress = (address: string) => ADDRESS.test(address);

/** Throws a TypeError for a message that no adapter may send. Every adapter calls it. */
export function checkMail(message: MailMessage): void {
	if (message.to.length === 0 || message.to.length > MAX_RECIPIENTS) {
		throw new TypeError(`A message has 1 to ${MAX_RECIPIENTS} recipients.`);
	}
	for (const address of message.to) {
		if (!ADDRESS.test(address)) throw new TypeError("Not a valid email address.");
	}
	if (/[\r\n]/.test(message.subject) || message.subject.length > 200) {
		throw new TypeError("The subject must be one line of at most 200 characters.");
	}
	if (message.text.length > 100_000)
		throw new TypeError("The text is longer than 100,000 characters.");
}

/** A mailer in memory: the sent messages, in order. For tests. */
export function memoryMailer(): Mailer & { sent: MailMessage[] } {
	const sent: MailMessage[] = [];
	return {
		sent,
		async send(message) {
			checkMail(message);
			sent.push(structuredClone(message));
		},
	};
}
