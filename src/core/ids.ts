/**
 * Public issue and event IDs. Today they are the row IDs. A later change (for example
 * obfuscated IDs) changes only these functions. The brief, the API and the MCP tools use them.
 */
export type PublicId = number;

export const formatIssueId = (rowId: number): PublicId => rowId;
export const formatEventId = (rowId: number): PublicId => rowId;

/** The row ID for a public ID, or null when the value is not a valid ID. */
export function parseIssueId(value: unknown): number | null {
	const id =
		typeof value === "number"
			? value
			: typeof value === "string" && /^\d{1,15}$/.test(value)
				? Number(value)
				: Number.NaN;
	return Number.isSafeInteger(id) && id > 0 ? id : null;
}
export const parseEventId = parseIssueId;
