import { createServer, type Socket } from "node:net";
import { cloudflareMailer } from "../../src/adapters/cloudflare/email-mailer.ts";
import { smtpMailer } from "../../src/adapters/node/smtp-mailer.ts";
import { type MailMessage, memoryMailer } from "../../src/ports/mailer.ts";
import { mailerContract } from "../contract/mailer-contract.ts";

mailerContract("memory", () => {
	const mailer = memoryMailer();
	return { mailer, sent: () => mailer.sent };
});

mailerContract("Cloudflare Email binding (fake binding)", () => {
	const sent: MailMessage[] = [];
	const mailer = cloudflareMailer(
		{
			send: async (m) => {
				if (m.from !== "alerts@example.com") throw new Error("from");
				sent.push({ to: m.to, subject: m.subject, text: m.text });
				return {};
			},
		},
		"alerts@example.com",
	);
	return { mailer, sent: () => sent };
});

/** A fake SMTP server (plain TCP) that decodes what it receives. */
mailerContract("SMTP (node:net, a fake server)", async () => {
	const sent: MailMessage[] = [];
	const server = createServer((socket: Socket) => {
		let data = "";
		let inData = false;
		const to: string[] = [];
		socket.write("220 fake ESMTP\r\n");
		socket.on("data", (chunk) => {
			data += chunk.toString("utf8");
			let line = data.indexOf("\r\n");
			while (line >= 0 && !inData) {
				const command = data.slice(0, line);
				data = data.slice(line + 2);
				if (command.startsWith("EHLO")) socket.write("250-fake\r\n250 AUTH PLAIN\r\n");
				else if (command.startsWith("AUTH PLAIN")) socket.write("235 ok\r\n");
				else if (command.startsWith("MAIL FROM")) socket.write("250 ok\r\n");
				else if (command.startsWith("RCPT TO:")) {
					to.push(command.slice(9, -1));
					socket.write("250 ok\r\n");
				} else if (command === "DATA") {
					inData = true;
					socket.write("354 go\r\n");
				} else if (command === "QUIT") socket.end("221 bye\r\n");
				line = data.indexOf("\r\n");
			}
			if (inData && data.includes("\r\n.\r\n")) {
				const message = data.slice(0, data.indexOf("\r\n.\r\n")).replace(/^\.\./gm, ".");
				data = data.slice(data.indexOf("\r\n.\r\n") + 5);
				inData = false;
				const [head = "", body = ""] = message.split("\r\n\r\n");
				const subjectLine = /^Subject: (.*)$/m.exec(head)?.[1] ?? "";
				const subject = subjectLine.startsWith("=?UTF-8?B?")
					? Buffer.from(subjectLine.slice(10, -2), "base64").toString("utf8")
					: subjectLine;
				sent.push({
					to: [...to],
					subject,
					text: Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8"),
				});
				socket.write("250 queued\r\n");
				let rest = data.indexOf("\r\n");
				while (rest >= 0) {
					if (data.slice(0, rest) === "QUIT") socket.end("221 bye\r\n");
					data = data.slice(rest + 2);
					rest = data.indexOf("\r\n");
				}
			}
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as { port: number }).port;
	const mailer = smtpMailer({
		host: "127.0.0.1",
		port,
		secure: false,
		username: "u",
		password: "p",
		from: "alerts@example.com",
	});
	return { mailer, sent: () => sent };
});
