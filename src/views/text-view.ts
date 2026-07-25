/**
 * Dynamic text, without a JavaScript evaluator.
 *
 * This replaces the `$= dv.date("today").toFormat(...)` pattern, which requires
 * enabling arbitrary JavaScript execution in Dataview. Here the template is a
 * fixed set of placeholders resolved by lookup, so a note can never run code.
 *
 *   view: text
 *   format: "Today is {date} — {open} open tasks"
 *
 * Norwegian aliases ({dato}, {åpne}, …) are kept: the plugin grew up in a
 * Norwegian vault and they cost nothing.
 */

import type { VaultIndex } from "../core/index";
import { formatISO, formatLong, today } from "../core/dates";

const PLACEHOLDER = /\{([a-zæøå]+)(?::([a-zæøå]+))?\}/giu;

export function renderText(
	container: HTMLElement,
	config: { format?: string; title?: string },
	index: VaultIndex,
): void {
	const template = config.format ?? "{dato}";
	const text = template.replace(PLACEHOLDER, (match, name: string, modifier?: string) =>
		resolve(name.toLowerCase(), modifier?.toLowerCase(), index) ?? match,
	);
	container.createDiv({ cls: "cleanview-text", text });
}

function resolve(name: string, modifier: string | undefined, index: VaultIndex): string | null {
	const day = today();

	switch (name) {
		case "dato":
		case "date":
			if (modifier === "iso" || modifier === "short" || modifier === "kort") return formatISO(day);
			return formatLong(day);
		case "weekday":
		case "ukedag":
			return formatLong(day).split(" ")[0];
		case "uke":
		case "week":
			return String(isoWeek(day));
		case "år":
		case "year":
			return String(new Date(day * 86_400_000).getUTCFullYear());
		case "åpne":
		case "open":
			return String(index.stats().openTasks);
		case "oppgaver":
		case "tasks":
			return String(index.stats().tasks);
		case "notater":
		case "notes":
			return String(index.stats().files);
		default:
			return null;
	}
}

/** ISO-8601 week number. */
function isoWeek(dayNum: number): number {
	const date = new Date(dayNum * 86_400_000);
	// Shift to the Thursday of this week; the year of that Thursday owns the week.
	const dayOfWeek = (date.getUTCDay() + 6) % 7;
	date.setUTCDate(date.getUTCDate() - dayOfWeek + 3);
	const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
	const firstDayOfWeek = (firstThursday.getUTCDay() + 6) % 7;
	firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayOfWeek + 3);
	return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}
