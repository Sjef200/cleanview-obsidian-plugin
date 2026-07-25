/**
 * Field access for the two record kinds a block can query.
 *
 * Accessors are resolved once when a filter is compiled, so the per-row cost is
 * a property read rather than a string lookup and a branch.
 */

import type { CleanViewFile, CleanViewTask } from "../core/types";
import { dayNumFromMs } from "../core/dates";

export type Source = "tasks" | "files";
export type Row = CleanViewTask | CleanViewFile;
export type Accessor = (row: Row) => unknown;

/** Fields whose values are day numbers, so filters coerce their operands. */
export const DATE_FIELDS: Record<Source, ReadonlySet<string>> = {
	tasks: new Set(["due", "scheduled", "start", "created", "completedOn", "completed"]),
	files: new Set(["mtime", "ctime", "modified", "created"]),
};

const TASK_FIELDS: Record<string, Accessor> = {
	text: (r) => (r as CleanViewTask).text,
	raw: (r) => (r as CleanViewTask).raw,
	done: (r) => (r as CleanViewTask).done,
	completed: (r) => (r as CleanViewTask).done,
	status: (r) => (r as CleanViewTask).status,
	priority: (r) => (r as CleanViewTask).priority,
	due: (r) => (r as CleanViewTask).due,
	frist: (r) => (r as CleanViewTask).due,
	scheduled: (r) => (r as CleanViewTask).scheduled,
	start: (r) => (r as CleanViewTask).start,
	created: (r) => (r as CleanViewTask).created,
	completedOn: (r) => (r as CleanViewTask).completedOn,
	recurrence: (r) => (r as CleanViewTask).recurrence,
	tags: (r) => (r as CleanViewTask).tags,
	path: (r) => (r as CleanViewTask).path,
	file: (r) => (r as CleanViewTask).fileName,
	folder: (r) => (r as CleanViewTask).folder,
	line: (r) => (r as CleanViewTask).line,
	depth: (r) => (r as CleanViewTask).depth,
};

const FILE_FIELDS: Record<string, Accessor> = {
	path: (r) => (r as CleanViewFile).path,
	name: (r) => (r as CleanViewFile).name,
	file: (r) => (r as CleanViewFile).name,
	folder: (r) => (r as CleanViewFile).folder,
	tags: (r) => (r as CleanViewFile).tags,
	size: (r) => (r as CleanViewFile).size,
	tasks: (r) => (r as CleanViewFile).taskCount,
	openTasks: (r) => (r as CleanViewFile).openTaskCount,
	// Timestamps are exposed as day numbers so they compare against date
	// expressions like "today-7d" the same way task dates do.
	mtime: (r) => dayNumFromMs((r as CleanViewFile).mtime),
	ctime: (r) => dayNumFromMs((r as CleanViewFile).ctime),
	modified: (r) => dayNumFromMs((r as CleanViewFile).mtime),
	created: (r) => dayNumFromMs((r as CleanViewFile).ctime),
	/** Raw millisecond timestamps, for display rather than filtering. */
	mtimeMs: (r) => (r as CleanViewFile).mtime,
	ctimeMs: (r) => (r as CleanViewFile).ctime,
};

/**
 * Resolves a field name to an accessor.
 *
 * Unknown names on the `files` source fall through to frontmatter, so
 * `status: reading` filters on the note's own frontmatter without extra syntax.
 */
export function accessor(source: Source, rawField: string): Accessor {
	const field = rawField.trim();

	// Explicit escapes for when a frontmatter key shadows a built-in.
	if (field.startsWith("fm.")) {
		const key = field.slice(3);
		return (r) => (r as CleanViewFile).frontmatter?.[key];
	}
	if (field.startsWith("file.")) {
		const key = field.slice(5);
		const table = source === "tasks" ? TASK_FIELDS : FILE_FIELDS;
		return table[key] ?? (() => undefined);
	}

	const table = source === "tasks" ? TASK_FIELDS : FILE_FIELDS;
	const known = table[field];
	if (known) return known;

	if (source === "files") return (r) => (r as CleanViewFile).frontmatter?.[field];
	return () => undefined;
}

export function isDateField(source: Source, field: string): boolean {
	const bare = field.startsWith("file.") ? field.slice(5) : field;
	return DATE_FIELDS[source].has(bare);
}
