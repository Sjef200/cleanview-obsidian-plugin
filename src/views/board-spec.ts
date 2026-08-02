/**
 * The five columns a board is built from, and the arithmetic behind them.
 * Pure — no Obsidian imports — so it is Node-tested like block-spec.ts,
 * task-spec.ts and capacity-spec.ts before it.
 *
 * Columns are computed from `due`, not a manually-maintained status field:
 * that is the whole point of this view. A status board needs the user to
 * keep the column and the fact in sync by hand; a due-date board cannot
 * drift, because the column *is* the fact. Dragging a card between columns
 * therefore reschedules the task — it writes a new due date, the one thing
 * a generic kanban board has no equivalent action for.
 */

import type { CleanViewTask } from "../core/types";

export type ColumnId = "overdue" | "this-week" | "next-week" | "later" | "no-date";

export interface ColumnDef {
	id: ColumnId;
	label: string;
	/** Whether a task with this due date (or none) belongs in this column. */
	matches(due: number | undefined, today: number): boolean;
	/**
	 * The due date written when a task is dropped into this column from a
	 * different one. `undefined` means the date is cleared, not left alone —
	 * dropping something into "No due date" has to actually remove the date,
	 * not just fail to set one.
	 */
	dropDue(today: number): number | undefined;
}

/** Display order is bucketing order: the first match wins, and every task
 * matches exactly one of these five — the ranges are contiguous and the
 * "no date" column catches the one case the other four cannot. */
export const COLUMNS: readonly ColumnDef[] = [
	{
		id: "overdue",
		label: "Overdue",
		matches: (due, today) => due !== undefined && due < today,
		dropDue: (today) => today - 1,
	},
	{
		id: "this-week",
		label: "This week",
		matches: (due, today) => due !== undefined && due >= today && due <= today + 6,
		dropDue: (today) => today,
	},
	{
		id: "next-week",
		label: "Next week",
		matches: (due, today) => due !== undefined && due >= today + 7 && due <= today + 13,
		dropDue: (today) => today + 7,
	},
	{
		id: "later",
		label: "Later",
		matches: (due, today) => due !== undefined && due >= today + 14,
		dropDue: (today) => today + 14,
	},
	{
		id: "no-date",
		label: "No due date",
		matches: (due) => due === undefined,
		dropDue: () => undefined,
	},
];

/**
 * Sorts every row into exactly one column. Initializes all five keys up
 * front so callers never need an `?? []` guard for a column nobody's task
 * happens to occupy.
 */
export function bucketRows(
	rows: readonly CleanViewTask[],
	today: number,
): Map<ColumnId, CleanViewTask[]> {
	const buckets = new Map<ColumnId, CleanViewTask[]>(COLUMNS.map((c) => [c.id, []]));
	for (const row of rows) {
		const column = COLUMNS.find((c) => c.matches(row.due, today));
		// COLUMNS is exhaustive — "no-date" matches whatever the other four do
		// not — so this is unreachable, but a row is never silently dropped if
		// it somehow were.
		if (column) buckets.get(column.id)!.push(row);
	}
	return buckets;
}

export function columnById(id: ColumnId): ColumnDef {
	const column = COLUMNS.find((c) => c.id === id);
	if (!column) throw new Error(`Unknown board column "${id}"`);
	return column;
}
