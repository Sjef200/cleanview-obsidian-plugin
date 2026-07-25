/**
 * Field access for the two record kinds a block can query.
 *
 * Accessors are resolved once when a filter is compiled, so the per-row cost is
 * a property read rather than a string lookup and a branch.
 */

import type { PulsFile, PulsTask } from "../core/types";
import { dayNumFromMs } from "../core/dates";

export type Source = "tasks" | "files";
export type Row = PulsTask | PulsFile;
export type Accessor = (row: Row) => unknown;

/** Fields whose values are day numbers, so filters coerce their operands. */
export const DATE_FIELDS: Record<Source, ReadonlySet<string>> = {
	tasks: new Set(["due", "scheduled", "start", "created", "completedOn", "completed"]),
	files: new Set(["mtime", "ctime", "modified", "created"]),
};

const TASK_FIELDS: Record<string, Accessor> = {
	text: (r) => (r as PulsTask).text,
	raw: (r) => (r as PulsTask).raw,
	done: (r) => (r as PulsTask).done,
	completed: (r) => (r as PulsTask).done,
	status: (r) => (r as PulsTask).status,
	priority: (r) => (r as PulsTask).priority,
	due: (r) => (r as PulsTask).due,
	frist: (r) => (r as PulsTask).due,
	scheduled: (r) => (r as PulsTask).scheduled,
	start: (r) => (r as PulsTask).start,
	created: (r) => (r as PulsTask).created,
	completedOn: (r) => (r as PulsTask).completedOn,
	recurrence: (r) => (r as PulsTask).recurrence,
	tags: (r) => (r as PulsTask).tags,
	path: (r) => (r as PulsTask).path,
	file: (r) => (r as PulsTask).fileName,
	folder: (r) => (r as PulsTask).folder,
	line: (r) => (r as PulsTask).line,
	depth: (r) => (r as PulsTask).depth,
};

const FILE_FIELDS: Record<string, Accessor> = {
	path: (r) => (r as PulsFile).path,
	name: (r) => (r as PulsFile).name,
	file: (r) => (r as PulsFile).name,
	folder: (r) => (r as PulsFile).folder,
	tags: (r) => (r as PulsFile).tags,
	size: (r) => (r as PulsFile).size,
	tasks: (r) => (r as PulsFile).taskCount,
	openTasks: (r) => (r as PulsFile).openTaskCount,
	// Timestamps are exposed as day numbers so they compare against date
	// expressions like "today-7d" the same way task dates do.
	mtime: (r) => dayNumFromMs((r as PulsFile).mtime),
	ctime: (r) => dayNumFromMs((r as PulsFile).ctime),
	modified: (r) => dayNumFromMs((r as PulsFile).mtime),
	created: (r) => dayNumFromMs((r as PulsFile).ctime),
	/** Raw millisecond timestamps, for display rather than filtering. */
	mtimeMs: (r) => (r as PulsFile).mtime,
	ctimeMs: (r) => (r as PulsFile).ctime,
};

/**
 * Resolves a field name to an accessor.
 *
 * Unknown names on the `files` source fall through to frontmatter, so
 * `status: leser` filters on the note's own frontmatter without extra syntax.
 */
export function accessor(source: Source, rawField: string): Accessor {
	const field = rawField.trim();

	// Explicit escapes for when a frontmatter key shadows a built-in.
	if (field.startsWith("fm.")) {
		const key = field.slice(3);
		return (r) => (r as PulsFile).frontmatter?.[key];
	}
	if (field.startsWith("file.")) {
		const key = field.slice(5);
		const table = source === "tasks" ? TASK_FIELDS : FILE_FIELDS;
		return table[key] ?? (() => undefined);
	}

	const table = source === "tasks" ? TASK_FIELDS : FILE_FIELDS;
	const known = table[field];
	if (known) return known;

	if (source === "files") return (r) => (r as PulsFile).frontmatter?.[field];
	return () => undefined;
}

export function isDateField(source: Source, field: string): boolean {
	const bare = field.startsWith("file.") ? field.slice(5) : field;
	return DATE_FIELDS[source].has(bare);
}
