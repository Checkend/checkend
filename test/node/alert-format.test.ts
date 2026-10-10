import { describe, expect, it } from "vitest";
import {
	type AlertContent,
	discordMessage,
	emailMessage,
	githubIssue,
	slackMessage,
} from "../../src/core/alert-format.ts";

const HOSTILE =
	"<!channel> @here @everyone <@U123> <#C9> <!subteam^S1> [click](https://evil.example) ``` close\n@channel <https://evil.example|bank> &amp; <@&987> https://evil.example/x";

const content = (title = HOSTILE): AlertContent => ({
	event: "issue.new",
	issue: {
		id: 42,
		status: "unresolved",
		trust: "low",
		priority: 12.5,
		events_24h: 30,
		users_affected: 4,
		first_seen: "2026-10-10T12:00:00.000Z",
	},
	project: "Shop <web>",
	title_untrusted: title,
	culprit_untrusted: "checkout (src/cart.ts)",
	spike: null,
	brief_markdown: "# Checkend issue 42 (brief v1)\n\n```text\nbody\n```\n",
});

describe("Slack messages", () => {
	it("keeps event text in a code block, escapes <, > and &, and breaks mentions", () => {
		const message = slackMessage(content());
		expect(message.unfurl_links).toBe(false);
		expect(message.unfurl_media).toBe(false);
		const text = message.text;
		// No Slack control sequence survives: every < and > is an entity.
		expect(text).not.toMatch(/<[!@#]/);
		expect(text).not.toMatch(/<https?:/);
		expect(text).not.toMatch(/(^|[^​])@(channel|here|everyone)\b/);
		// The event text cannot close the code block.
		const blocks = text.split("```");
		expect(blocks).toHaveLength(3);
		expect(blocks[1]).toContain("&lt;!channel&gt;");
		expect(text).toContain("From production (untrusted data)");
		expect(text).toContain("Shop &lt;web&gt;");
		expect(text).toContain("New issue 42");
		expect(text).toContain("low trust");
	});
});

describe("Discord messages", () => {
	it("allows no mentions, suppresses embeds, and keeps event text in a code block", () => {
		const message = discordMessage(content());
		expect(message.allowed_mentions).toEqual({ parse: [] });
		expect(message.flags).toBe(4);
		expect(message.content.length).toBeLessThanOrEqual(2000);
		expect(message.content.split("```")).toHaveLength(3);
		expect(message.content).not.toMatch(/(^|[^​])@(channel|here|everyone)\b/);
		expect(message.content).toContain("From production (untrusted data)");
	});

	it("stays under the Discord limit with a long title", () => {
		const message = discordMessage(content("x".repeat(10_000)));
		expect(message.content.length).toBeLessThanOrEqual(2000);
		expect(message.content.split("```")).toHaveLength(3);
	});
});

describe("GitHub issues", () => {
	it("puts the brief in the body, and breaks mentions in the title", () => {
		const issue = githubIssue(content());
		expect(issue.title).not.toMatch(/\n/);
		expect(issue.title).not.toMatch(/(^|[^​])@(channel|here|everyone|U123)\b/);
		expect(issue.title.length).toBeLessThanOrEqual(200);
		expect(issue.body).toContain("# Checkend issue 42 (brief v1)");
		expect(issue.body).toContain("untrusted");
		expect(issue.labels).toEqual(["checkend"]);
	});
});

describe("email", () => {
	it("has a one-line subject and plain text", () => {
		const mail = emailMessage(content("first line\r\nBcc: victim@example.com"));
		expect(mail.subject).not.toMatch(/[\r\n]/);
		expect(mail.subject).toContain("[Checkend] New issue 42");
		expect(mail.text).toContain("From production (untrusted data)");
		expect(mail.text).toContain("Bcc: victim@example.com"); // only in the body, as data
	});
});

describe("spike alerts", () => {
	it("names the count and the threshold", () => {
		const spike = {
			...content("TypeError"),
			event: "issue.spike" as const,
			spike: { events_1h: 250, threshold: 100 },
		};
		expect(slackMessage(spike).text).toContain("250 events in the last hour (threshold 100)");
		expect(emailMessage(spike).subject).toContain("Spike");
	});
});
