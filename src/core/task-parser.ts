/**
 * Parses checkbox lines into CleanViewTask records.
 *
 * Supports both metadata dialects people actually have in their vaults:
 *   - Tasks plugin emoji shorthand:  📅 2026-07-11  ⏫  🔁 every week
 *   - Dataview inline fields:        [due:: 2026-07-11]  (priority:: high)
 *
 * A few Norwegian field names (frist, prioritet) are accepted as aliases.
 *
 * Both are stripped from the display text, so a task written either way renders
 * cleanly. Parsing is a single pass per line with precompiled regexes; no
 * allocation happens for lines without metadata.
 */

import type { ListItemCache } from "obsidian";
import type { CleanViewTask } from "./types";
import { PRIORITY_NONE } from "./types";
import { parseDate } from "./dates";

const EMOJI_PRIORITY: Record<string, number> = {
	"🔺": 5,
	"⏫": 4,
	"🔼": 3,
	"🔽": 1,
	"⏬": 0,
};

const NAMED_PRIORITY: Record<string, number> = {
	highest: 5, høyest: 5, hoyest: 5,
	high: 4, høy: 4, hoy: 4,
	medium: 3, middels: 3, normal: 2,
	low: 1, lav: 1,
	lowest: 0, lavest: 0,
};

/** `[key:: value]` or `(key:: value)` — Dataview inline fields. */
const INLINE_FIELD = /[[(]\s*([\p{L}\p{N}_-]+)\s*::\s*([^\])]*?)\s*[\])]/gu;
/** An emoji marker optionally followed by an ISO date. */
const EMOJI_TOKEN = /(📅|⏳|🛫|➕|✅|🔺|⏫|🔼|🔽|⏬)\s*([^\s📅⏳🛫➕✅🔺⏫🔼🔽⏬🔁#[(]*)?/gu;
/**
 * Recurrence is free-form prose ("every week", "hver 2. mandag"), so unlike the
 * date markers it cannot stop at the first space. It runs to the next marker or
 * the end of the line.
 */
const RECURRENCE = /🔁\s*([^📅⏳🛫➕✅🔺⏫🔼🔽⏬\n]*)/u;
/** A #tag, excluding those inside a URL or code. */
const TAG = /(^|\s)#([\p{L}\p{N}/_-]+)/gu;
/** `- [ ] ` / `* [x] ` / `1. [ ] ` prefix. */
const CHECKBOX_PREFIX = /^\s*(?:[-*+]|\d+[.)])\s+\[(.)]\s*/;

const DATE_FIELDS = new Set(["due", "scheduled", "start", "created", "completion", "done", "frist"]);

/**
 * Parses one raw line into a task, or returns null if it is not a checkbox.
 *
 * `item` supplies the checkbox character and position, both of which Obsidian
 * has already computed for us in the metadata cache.
 */
export function parseTaskLine(
	rawLine: string,
	item: ListItemCache,
	path: string,
	fileName: string,
	folder: string,
): CleanViewTask | null {
	const statusChar = item.task;
	if (statusChar === undefined) return null;

	const prefixMatch = CHECKBOX_PREFIX.exec(rawLine);
	// The cache says this is a task, so a missing prefix means the line moved
	// between caching and reading. Skip rather than emit a corrupt entry.
	if (!prefixMatch) return null;

	const body = rawLine.slice(prefixMatch[0].length);
	const indent = prefixMatch[0].length - prefixMatch[0].trimStart().length;

	const task: CleanViewTask = {
		text: body,
		raw: body,
		path,
		fileName,
		folder,
		line: item.position.start.line,
		status: statusChar,
		done: statusChar !== " " && statusChar !== "",
		depth: Math.floor(indent / 2),
		priority: PRIORITY_NONE,
		tags: [],
	};

	let text = body;
	text = extractInlineFields(text, task);
	// Recurrence must come out before the date markers, since it is the only
	// token whose value may contain spaces.
	text = extractRecurrence(text, task);
	text = extractEmoji(text, task);
	extractTags(text, task);

	// Tags stay visible in the display text (they read naturally inline), but
	// collapse whitespace left behind by the stripped metadata.
	task.text = text.replace(/\s{2,}/g, " ").trim();
	return task;
}

function extractInlineFields(text: string, task: CleanViewTask): string {
	if (!text.includes("::")) return text;

	INLINE_FIELD.lastIndex = 0;
	return text.replace(INLINE_FIELD, (match, rawKey: string, rawValue: string) => {
		const key = rawKey.toLowerCase();
		const value = rawValue.trim();

		if (DATE_FIELDS.has(key)) {
			const day = parseDate(value);
			if (day === undefined) return match;
			if (key === "due" || key === "frist") task.due = day;
			else if (key === "scheduled") task.scheduled = day;
			else if (key === "start") task.start = day;
			else if (key === "created") task.created = day;
			else task.completedOn = day;
			return " ";
		}

		if (key === "priority" || key === "prioritet") {
			const named = NAMED_PRIORITY[value.toLowerCase()];
			if (named !== undefined) {
				task.priority = named;
				return " ";
			}
			const numeric = Number(value);
			if (Number.isFinite(numeric)) {
				task.priority = Math.max(0, Math.min(5, numeric));
				return " ";
			}
			return match;
		}

		if (key === "repeat" || key === "recurrence") {
			task.recurrence = value;
			return " ";
		}

		// Unknown field: leave it in place rather than silently eating content.
		return match;
	});
}

function extractRecurrence(text: string, task: CleanViewTask): string {
	if (!text.includes("🔁")) return text;
	return text.replace(RECURRENCE, (_match, rest: string) => {
		const value = rest.trim();
		if (value) task.recurrence = value;
		return " ";
	});
}

function extractEmoji(text: string, task: CleanViewTask): string {
	EMOJI_TOKEN.lastIndex = 0;
	return text.replace(EMOJI_TOKEN, (match, marker: string, rest: string | undefined) => {
		const priority = EMOJI_PRIORITY[marker];
		if (priority !== undefined) {
			task.priority = priority;
			return rest ? ` ${rest}` : " ";
		}

		const value = (rest ?? "").trim();
		const day = parseDate(value);
		if (day === undefined) return match;

		switch (marker) {
			case "📅": task.due = day; break;
			case "⏳": task.scheduled = day; break;
			case "🛫": task.start = day; break;
			case "➕": task.created = day; break;
			case "✅": task.completedOn = day; break;
		}
		// Keep any trailing text that followed the date on the same token.
		const trailing = value.slice(10).trim();
		return trailing ? ` ${trailing}` : " ";
	});
}

function extractTags(text: string, task: CleanViewTask): void {
	if (!text.includes("#")) return;
	TAG.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = TAG.exec(text)) !== null) {
		task.tags.push(match[2].toLowerCase());
	}
}
