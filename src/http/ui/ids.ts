/**
 * IDs in UI URLs. Every page formats and parses issue and event IDs here, so that a change of
 * the public ID format (for example obfuscated issue IDs) touches only this file. Projects use
 * their public 10-digit ID; the internal row ID never appears in the UI.
 */

const ROW_ID = /^[1-9]\d{0,14}$/;
const PROJECT_ID = /^[1-9]\d{9}$/;

/** The issue ID as people and agents type it: in prompts, `ce issue view <id>` and the API. */
export const issueRef = (id: number | string): string => String(id);
export const issuePath = (id: number | string | null | undefined): string => `/issues/${id}`;
export const eventPath = (id: number | string | null | undefined): string => `/events/${id}`;
/** An app (a project in the API) by its public ID. The UI says "app". */
export const appPath = (publicId: number | string | null | undefined): string =>
	`/apps/${publicId}`;

/** The issue ID of a URL segment, or null when it is not one. */
export function parseIssueId(segment: string | undefined): number | null {
	return segment && ROW_ID.test(segment) ? Number(segment) : null;
}

export function parseEventId(segment: string | undefined): number | null {
	return segment && ROW_ID.test(segment) ? Number(segment) : null;
}

/** A public project ID (10 digits), or null. */
export function parseProjectId(segment: string | undefined): number | null {
	return segment && PROJECT_ID.test(segment) ? Number(segment) : null;
}
