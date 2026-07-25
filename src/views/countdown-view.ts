/**
 * Countdown to a deadline.
 *
 *   view: countdown
 *   source: files
 *   filter: { type: goal }
 *   date: due            # optional; auto-detected when omitted
 *   sort: [due asc]
 *
 * Per the form heuristic this is a stat tile, not a chart: the number *is* the
 * visualisation. Urgency is shown with an icon and a word as well as a colour,
 * so the state never rests on hue alone.
 */

import { coerceDayNum, formatLong, today } from "../core/dates";
import type { CleanViewFile } from "../core/types";
import { type Row, accessor } from "../query/fields";
import type { BlockConfig, QueryResult } from "../query/query";
import { emptyState, errorState, openFileAt, renderCapped, sectionHeader } from "./render-utils";
import type { ViewContext } from "./task-view";

/** Frontmatter keys checked, in order, when `date:` is not given. */
/** Checked in order when `date:` is omitted. Includes a few Norwegian keys. */
const DATE_CANDIDATES = ["due", "deadline", "date", "target", "frist", "dato"];
const START_CANDIDATES = ["start", "started", "from", "startet"];

interface Urgency {
	cls: string;
	icon: string;
	label: string;
}

function urgencyFor(daysLeft: number): Urgency {
	if (daysLeft < 0) return { cls: "is-overdue", icon: "⚠", label: "Overdue" };
	if (daysLeft === 0) return { cls: "is-today", icon: "●", label: "Today" };
	if (daysLeft <= 14) return { cls: "is-soon", icon: "▲", label: "Soon" };
	return { cls: "is-ahead", icon: "○", label: "On track" };
}

export function renderCountdown(
	container: HTMLElement,
	result: QueryResult,
	config: BlockConfig,
	ctx: ViewContext,
): void {
	sectionHeader(container, config.title);

	if (result.rows.length === 0) {
		emptyState(container, "No goals match this filter.");
		return;
	}

	const dateField = resolveDateField(result.rows, config);
	if (!dateField) {
		errorState(
			container,
			"No date field found. Add a due: key to the note frontmatter, or set date: <field> in this block.",
		);
		return;
	}

	const getDate = accessor(config.source, dateField);
	const startField = config.start ? String(config.start) : detectField(result.rows, config.source, START_CANDIDATES);
	const getStart = startField ? accessor(config.source, startField) : null;

	const now = today();
	const list = container.createDiv({ cls: "cleanview-countdowns" });

	renderCapped(list, result.rows, config.limit ?? 10, (row, parent) => {
		const deadline = coerceDayNum(getDate(row));
		if (deadline === undefined) return;
		renderCard(parent, row, deadline, getStart ? coerceDayNum(getStart(row)) : undefined, now, config, ctx);
	});
}

function renderCard(
	parent: HTMLElement,
	row: Row,
	deadline: number,
	start: number | undefined,
	now: number,
	config: BlockConfig,
	ctx: ViewContext,
): void {
	const daysLeft = deadline - now;
	const urgency = urgencyFor(daysLeft);

	const card = parent.createDiv({ cls: `cleanview-countdown ${urgency.cls}` });

	const figure = card.createDiv({ cls: "cleanview-countdown-figure" });
	figure.createSpan({ cls: "cleanview-countdown-days", text: String(Math.abs(daysLeft)) });
	// The figure is an absolute value, so the unit has to say which side of the
	// deadline it falls on. "4 dager" above "Forfalt" otherwise reads as four
	// days remaining.
	figure.createSpan({ cls: "cleanview-countdown-unit", text: unitLabel(daysLeft) });

	const body = card.createDiv({ cls: "cleanview-countdown-body" });

	const label = String(config.label ? accessor(config.source, String(config.label))(row) : (row as CleanViewFile).name ?? "");
	const titleEl = body.createDiv({ cls: "cleanview-countdown-title cleanview-link", text: label });
	titleEl.setAttr("role", "link");
	titleEl.setAttr("tabindex", "0");
	const open = (event: Event) => {
		event.preventDefault();
		openFileAt(ctx.app, (row as { path: string }).path, (row as { line?: number }).line);
	};
	titleEl.addEventListener("click", open);
	titleEl.addEventListener("keydown", (event) => {
		if (event.key === "Enter") open(event);
	});

	const meta = body.createDiv({ cls: "cleanview-countdown-meta" });
	// Icon + word carry the state; the colour only reinforces it.
	const badge = meta.createSpan({ cls: "cleanview-countdown-badge" });
	badge.createSpan({ cls: "cleanview-countdown-icon", text: urgency.icon });
	badge.createSpan({ text: urgency.label });
	meta.createSpan({ cls: "cleanview-countdown-date", text: formatLong(deadline) });

	// Elapsed share of the run-up, when we know when it started.
	if (start !== undefined && deadline > start) {
		const elapsed = Math.max(0, Math.min(1, (now - start) / (deadline - start)));
		const track = body.createDiv({ cls: "cleanview-progress" });
		const bar = track.createDiv({ cls: "cleanview-progress-bar" });
		bar.style.setProperty("--cleanview-progress", `${Math.round(elapsed * 100)}%`);
		track.createSpan({
			cls: "cleanview-progress-label",
			text: `${Math.round(elapsed * 100)}% of the time used`,
		});
	}

	// Step progress, if the goal note has checkboxes of its own.
	const file = row as CleanViewFile;
	if (file.taskCount > 0) {
		const done = file.taskCount - file.openTaskCount;
		body.createDiv({
			cls: "cleanview-countdown-steps",
			text: `${done} of ${file.taskCount} steps done`,
		});
	}
}

/** Uses `date:` when given, otherwise the first candidate field any row has. */
function resolveDateField(rows: Row[], config: BlockConfig): string | null {
	if (config.date) return String(config.date);
	if (config.source === "tasks") return "due";
	return detectField(rows, config.source, DATE_CANDIDATES);
}

function detectField(rows: Row[], source: BlockConfig["source"], candidates: string[]): string | null {
	// Only the first rows are sampled: a field present on none of the leading
	// goals is not the one the dashboard is about.
	const sample = rows.slice(0, 20);
	for (const candidate of candidates) {
		const get = accessor(source, candidate);
		if (sample.some((row) => coerceDayNum(get(row)) !== undefined)) return candidate;
	}
	return null;
}

/** The unit under the figure. Exported for the tests. */
export function unitLabel(daysLeft: number): string {
	if (daysLeft === 0) return "today";
	if (daysLeft < 0) return daysLeft === -1 ? "day ago" : "days ago";
	return daysLeft === 1 ? "day left" : "days left";
}
