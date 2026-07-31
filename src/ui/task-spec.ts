/**
 * Composing a task line. Pure, so it can be tested in plain Node.
 *
 * Emits the emoji dialect rather than inline fields: it is the more widely
 * recognised of the two, and a vault that later adds the Tasks plugin keeps
 * working without a rewrite. CleanView reads both regardless.
 */

/** Priority values the dialog offers, as emoji. 2 (normal) writes nothing. */
export const PRIORITY_EMOJI: Record<number, string> = {
	5: "🔺",
	4: "⏫",
	3: "🔼",
	1: "🔽",
	0: "⏬",
};

export interface NewTask {
	text: string;
	/** "YYYY-MM-DD", or empty for no due date. */
	due: string;
	/** 0 lowest … 5 highest; 2 means unmarked. */
	priority: number;
}

export const DEFAULT_TASK: NewTask = { text: "", due: "", priority: 2 };

/**
 * Renders the markdown line.
 *
 * Order follows the Tasks plugin's own convention — description, priority,
 * then dates — so a line written here is indistinguishable from one written
 * there.
 */
export function buildTaskLine(task: NewTask): string {
	const parts = ["- [ ]"];

	const text = task.text.trim();
	parts.push(text || "New task");

	const priority = PRIORITY_EMOJI[task.priority];
	if (priority) parts.push(priority);

	// Guard the date rather than trusting the input element: a malformed value
	// would otherwise be written into the note and silently never match a filter.
	if (/^\d{4}-\d{2}-\d{2}$/.test(task.due)) parts.push(`📅 ${task.due}`);

	return parts.join(" ");
}

/** Today as YYYY-MM-DD in the user's own timezone, for the date input. */
export function todayInput(now = new Date()): string {
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${now.getFullYear()}-${month}-${day}`;
}

/** Shifts a YYYY-MM-DD string by whole days, staying on calendar dates. */
export function shiftInput(value: string, days: number): string {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	const base = match
		? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]))
		: new Date(`${todayInput()}T00:00:00Z`);
	base.setUTCDate(base.getUTCDate() + days);
	return base.toISOString().slice(0, 10);
}

/** Metadata the dialog does not touch, which must survive an edit untouched. */
const CARRIED_EMOJI = /(⏳|🛫|➕|✅)\s*\d{4}-\d{2}-\d{2}/gu;
const CARRIED_RECURRENCE = /🔁\s*[^📅⏳🛫➕✅🔺⏫🔼🔽⏬\n]*/u;
const CARRIED_INLINE = /\[\s*(scheduled|start|created|completion|done|repeat|recurrence)\s*::[^\]]*\]/giu;

/** True when the line was written in Dataview's inline-field dialect. */
function usesInlineFields(raw: string): boolean {
	return /\[\s*(due|priority|frist|prioritet)\s*::/iu.test(raw);
}

const PRIORITY_WORD: Record<number, string> = {
	5: "highest", 4: "high", 3: "medium", 1: "low", 0: "lowest",
};

/**
 * Rewrites a task's body with a new text, due date and priority, carrying
 * everything else across.
 *
 * Two rules govern this, and both exist to avoid changing something the user
 * did not ask to change:
 *
 *   - Metadata the dialog has no field for — scheduled, start, created,
 *     completion, recurrence — is extracted from the original and re-appended.
 *     Rebuilding from the parsed fields alone would drop it silently.
 *   - The line keeps its own dialect. A task written with `[due:: …]` is
 *     rewritten with inline fields, not converted to emoji, because the file
 *     is the user's and its style is theirs.
 */
export function rewriteTaskBody(raw: string, edits: NewTask): string {
	const inline = usesInlineFields(raw);

	const carried: string[] = [];
	const recurrence = CARRIED_RECURRENCE.exec(raw);
	if (recurrence) carried.push(recurrence[0].trim());
	for (const match of raw.matchAll(CARRIED_EMOJI)) carried.push(match[0].trim());
	for (const match of raw.matchAll(CARRIED_INLINE)) carried.push(match[0].trim());

	const parts = [edits.text.trim() || "New task", ...carried];

	if (edits.priority !== 2) {
		parts.push(inline
			? `[priority:: ${PRIORITY_WORD[edits.priority]}]`
			: PRIORITY_EMOJI[edits.priority]);
	}
	if (/^\d{4}-\d{2}-\d{2}$/.test(edits.due)) {
		parts.push(inline ? `[due:: ${edits.due}]` : `📅 ${edits.due}`);
	}

	return parts.filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
}

/** Day number back to the YYYY-MM-DD a date input expects. */
export function dayNumToInput(day: number | undefined): string {
	if (day === undefined) return "";
	const d = new Date(day * 86_400_000);
	const month = String(d.getUTCMonth() + 1).padStart(2, "0");
	return `${d.getUTCFullYear()}-${month}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
