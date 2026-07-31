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
