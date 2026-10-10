import { type Socket, connect as tcpConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { checkMail, type Mailer } from "../../ports/mailer.ts";

export interface SmtpOptions {
	host: string;
	port: number;
	/** true: implicit TLS (port 465). false: plain TCP, only for a local relay. */
	secure: boolean;
	username?: string;
	password?: string;
	from: string;
	/** For tests: accept a self-signed certificate. */
	rejectUnauthorized?: boolean;
}

const TIMEOUT_MS = 15_000;
const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
/** RFC 2047 for a subject that is not plain ASCII. */
const header = (text: string) =>
	/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${base64(text)}?=`;

/**
 * Mailer over SMTP: implicit TLS (465) with AUTH PLAIN, for example Cloudflare Email Service
 * (smtp.mx.cloudflare.net) or any provider. One connection per message.
 */
export function smtpMailer(options: SmtpOptions): Mailer {
	return {
		async send(message) {
			checkMail(message);
			const socket: Socket = options.secure
				? tlsConnect({
						host: options.host,
						port: options.port,
						servername: options.host,
						rejectUnauthorized: options.rejectUnauthorized ?? true,
					})
				: tcpConnect({ host: options.host, port: options.port });
			socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error("SMTP timeout")));
			const replies = replyReader(socket);
			const expect = async (code: number) => {
				const reply = await replies();
				if (reply.code !== code)
					throw new Error(`SMTP: expected ${code}, got ${reply.code} ${reply.text}`);
			};
			const command = async (line: string, code: number) => {
				socket.write(`${line}\r\n`);
				await expect(code);
			};
			try {
				await expect(220);
				await command(`EHLO checkend`, 250);
				if (options.username !== undefined) {
					const token = base64(`\0${options.username}\0${options.password ?? ""}`);
					await command(`AUTH PLAIN ${token}`, 235);
				}
				await command(`MAIL FROM:<${options.from}>`, 250);
				for (const to of message.to) await command(`RCPT TO:<${to}>`, 250);
				await command("DATA", 354);
				const body = base64(message.text).replace(/.{1,76}/g, "$&\r\n");
				const data = [
					`From: ${options.from}`,
					`To: ${message.to.join(", ")}`,
					`Subject: ${header(message.subject)}`,
					`Date: ${new Date().toUTCString()}`,
					`Message-ID: <${crypto.randomUUID()}@checkend>`,
					"MIME-Version: 1.0",
					"Content-Type: text/plain; charset=utf-8",
					"Content-Transfer-Encoding: base64",
					"",
					body,
				].join("\r\n");
				// Dot-stuffing: a line that starts with "." gets one more.
				socket.write(`${data.replace(/^\./gm, "..")}\r\n.\r\n`);
				await expect(250);
				socket.write("QUIT\r\n");
			} finally {
				socket.end();
			}
		},
	};
}

/** Reads SMTP replies ("250-..." lines end with "250 ..."). */
function replyReader(socket: Socket): () => Promise<{ code: number; text: string }> {
	let buffer = "";
	const waiting: ((reply: { code: number; text: string }) => void)[] = [];
	const failed: ((error: Error) => void)[] = [];
	const ready: { code: number; text: string }[] = [];
	socket.on("data", (chunk: Buffer) => {
		buffer += chunk.toString("utf8");
		let match = /^(\d{3}) (.*)\r?\n/m.exec(buffer);
		while (match) {
			const end = (match.index ?? 0) + match[0].length;
			const reply = { code: Number(match[1]), text: buffer.slice(0, end).trim() };
			buffer = buffer.slice(end);
			const next = waiting.shift();
			failed.shift();
			if (next) next(reply);
			else ready.push(reply);
			match = /^(\d{3}) (.*)\r?\n/m.exec(buffer);
		}
	});
	const fail = (error: Error) => {
		for (const reject of failed.splice(0)) reject(error);
		waiting.splice(0);
	};
	socket.on("error", fail);
	socket.on("close", () => fail(new Error("SMTP connection closed")));
	return () =>
		new Promise((resolve, reject) => {
			const reply = ready.shift();
			if (reply) return resolve(reply);
			waiting.push(resolve);
			failed.push(reject);
		});
}
