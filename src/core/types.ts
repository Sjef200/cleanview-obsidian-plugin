/**
 * Core data model.
 *
 * Dates are stored as "day numbers": whole days since the Unix epoch, computed
 * from the calendar date only (no time, no timezone). Comparing, sorting and
 * offsetting dates is then plain integer math, which matters because filters
 * touch every task on every re-render.
 */

/** A single checkbox line somewhere in the vault. */
export interface PulsTask {
	/** Display text, with metadata (emoji dates, priority, inline fields) stripped out. */
	text: string;
	/** The raw line content after the checkbox, kept for search and debugging. */
	raw: string;
	path: string;
	/** Basename without extension, precomputed for grouping. */
	fileName: string;
	folder: string;
	/** 0-based line number in the file. */
	line: number;
	/** The character between the brackets: " ", "x", "/", "-", ... */
	status: string;
	done: boolean;
	/** Indent depth from the metadata cache; 0 is a top-level list item. */
	depth: number;

	due?: number;
	scheduled?: number;
	start?: number;
	created?: number;
	completedOn?: number;

	/** 0 lowest … 5 highest, 2 = no explicit priority (matches the Tasks plugin). */
	priority: number;
	recurrence?: string;
	/** Tags on the line, without the leading '#'. */
	tags: string[];
}

/** One markdown file, flattened for fast filtering. */
export interface PulsFile {
	path: string;
	/** Basename without extension. */
	name: string;
	folder: string;
	/** Milliseconds since epoch, straight from the vault adapter. */
	mtime: number;
	ctime: number;
	size: number;
	frontmatter: Record<string, unknown>;
	/** Tags from frontmatter and body, without the leading '#'. */
	tags: string[];
	taskCount: number;
	openTaskCount: number;
}

export const PRIORITY_NONE = 2;

export const PRIORITY_LABELS: Record<number, string> = {
	5: "Highest",
	4: "High",
	3: "Medium",
	2: "Normal",
	1: "Low",
	0: "Lowest",
};
