/**
 * Countdown to a deadline.
 *
 *   view: countdown
 *   source: files
 *   filter: { type: mål }
 *   date: frist          # optional; auto-detected when omitted
 *   sort: [frist asc]
 *
 * Per the form heuristic this is a stat tile, not a chart: the number *is* the
 * visualisation. Urgency is shown with an icon and a word as well as a colour,
 * so the state never rests on hue alone.
 */

import { coerceDayNum, formatLongNb, today } from "../core/dates";
import type { PulsFile } from "../core/types";
import { type Row, accessor } from "../query/fields";
import type { BlockConfig, QueryResult } from "../query/query";
import { emptyState, errorState, openFileAt, renderCapped, sectionHeader } from "./render-utils";
import type { ViewContext } from "./task-view";

/** Frontmatter keys checked, in order, when `date:` is not given. */
const DATE_CANDIDATES = ["frist", "deadline", "due", "dato", "date", "mål", "target"];
const START_CANDIDATES = ["startet", "start", "fra", "begynt"];

interface Urgency {
	cls: string;
	icon: string;
	label: string;
}

function urgencyFor(daysLeft: number): Urgency {
	if (daysLeft < 0) return { cls: "is-overdue", icon: "⚠", label: "Forfalt" };
	if (daysLeft === 0) return { cls: "is-today", icon: "●", label: "I dag" };
	if (daysLeft <= 14) return { cls: "is-soon", icon: "▲", label: "Snart" };
	return { cls: "is-ahead", icon: "○", label: "På vei" };
}

export function renderCountdown(
	container: HTMLElement,
	result: QueryResult,
	config: BlockConfig,
	ctx: ViewContext,
): void {
	sectionHeader(container, config.title);

	if (result.rows.length === 0) {
		emptyState(container, "Ingen mål passer filteret.");
		return;
	}

	const dateField = resolveDateField(result.rows, config);
	if (!dateField) {
		errorState(
			container,
			`Fant ingen datofelt. Legg til «frist:» i frontmatter, eller sett «date: <felt>» i blokken.`,
		);
		return;
	}

	const getDate = accessor(config.source, dateField);
	const startField = config.start ? String(config.start) : detectField(result.rows, config.source, START_CANDIDATES);
	const getStart = startField ? accessor(config.source, startField) : null;

	const now = today();
	const list = container.createDiv({ cls: "puls-countdowns" });

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

	const card = parent.createDiv({ cls: `puls-countdown ${urgency.cls}` });

	const figure = card.createDiv({ cls: "puls-countdown-figure" });
	figure.createSpan({ cls: "puls-countdown-days", text: String(Math.abs(daysLeft)) });
	// The figure is an absolute value, so the unit has to say which side of the
	// deadline it falls on. "4 dager" above "Forfalt" otherwise reads as four
	// days remaining.
	figure.createSpan({ cls: "puls-countdown-unit", text: unitLabel(daysLeft) });

	const body = card.createDiv({ cls: "puls-countdown-body" });

	const label = String(config.label ? accessor(config.source, String(config.label))(row) : (row as PulsFile).name ?? "");
	const titleEl = body.createDiv({ cls: "puls-countdown-title puls-link", text: label });
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

	const meta = body.createDiv({ cls: "puls-countdown-meta" });
	// Icon + word carry the state; the colour only reinforces it.
	const badge = meta.createSpan({ cls: "puls-countdown-badge" });
	badge.createSpan({ cls: "puls-countdown-icon", text: urgency.icon });
	badge.createSpan({ text: urgency.label });
	meta.createSpan({ cls: "puls-countdown-date", text: formatLongNb(deadline) });

	// Elapsed share of the run-up, when we know when it started.
	if (start !== undefined && deadline > start) {
		const elapsed = Math.max(0, Math.min(1, (now - start) / (deadline - start)));
		const track = body.createDiv({ cls: "puls-progress" });
		const bar = track.createDiv({ cls: "puls-progress-bar" });
		bar.style.setProperty("--puls-progress", `${Math.round(elapsed * 100)}%`);
		track.createSpan({
			cls: "puls-progress-label",
			text: `${Math.round(elapsed * 100)} % av tiden brukt`,
		});
	}

	// Step progress, if the goal note has checkboxes of its own.
	const file = row as PulsFile;
	if (file.taskCount > 0) {
		const done = file.taskCount - file.openTaskCount;
		body.createDiv({
			cls: "puls-countdown-steps",
			text: `${done} av ${file.taskCount} steg ferdig`,
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
	if (daysLeft === 0) return "i dag";
	if (daysLeft < 0) return daysLeft === -1 ? "dag siden" : "dager siden";
	return daysLeft === 1 ? "dag igjen" : "dager igjen";
}
