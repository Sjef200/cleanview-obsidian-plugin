/**
 * Renders a `capacity` block: one hero percentage, a meter, and the numbers
 * behind it. Per the form heuristic this is a stat tile, not a chart — the
 * ratio *is* the visualisation, and a bar chart of "hours" vs "hours" would
 * only dress up the same single comparison.
 *
 *   view: capacity
 *   until: 2026-11-21
 *   budget: { sleep: 8, transport: 3, meals: 2, social: 4, leisure: 4 }
 *   filter: { done: false, tags: { has: exam } }
 */

import { formatLong, resolveDateExpr, today } from "../core/dates";
import type { CleanViewTask } from "../core/types";
import type { BlockConfig, QueryResult } from "../query/query";
import { computeCapacity, normalizeBudget } from "./capacity-spec";
import { errorState, sectionHeader } from "./render-utils";
import { formatNumber } from "./table-view";

interface State {
	cls: string;
	icon: string;
	label: string;
}

/** Icon + word carry the state; colour only reinforces it — never colour alone. */
function stateFor(percent: number): State {
	if (!Number.isFinite(percent)) return { cls: "is-critical", icon: "⚠", label: "No time left" };
	if (percent < 70) return { cls: "is-good", icon: "✓", label: "On track" };
	if (percent <= 100) return { cls: "is-warning", icon: "▲", label: "Tight" };
	return { cls: "is-critical", icon: "⚠", label: "Over capacity" };
}

function heroText(percent: number): string {
	if (!Number.isFinite(percent)) return "—";
	return `${Math.round(percent)}%`;
}

export function renderCapacity(
	container: HTMLElement,
	result: QueryResult,
	config: BlockConfig,
): void {
	sectionHeader(container, config.title);

	const until = resolveDateExpr(config.until);
	if (until === undefined) {
		errorState(
			container,
			"No usable `until:` date. Add e.g. `until: 2026-11-21` or `until: today+90d` to this block.",
		);
		return;
	}

	const budget = normalizeBudget(config.budget);
	const rows = result.rows as CleanViewTask[];
	const calc = computeCapacity(today(), until, budget, rows);
	const state = stateFor(calc.percent);

	const card = container.createDiv({ cls: `cleanview-capacity ${state.cls}` });

	const badge = card.createDiv({ cls: "cleanview-capacity-badge" });
	badge.createSpan({ cls: "cleanview-capacity-icon", text: state.icon });
	badge.createSpan({ text: state.label });

	card.createDiv({ cls: "cleanview-capacity-figure", text: heroText(calc.percent) });

	const track = card.createDiv({ cls: "cleanview-progress" });
	const bar = track.createDiv({ cls: "cleanview-progress-bar" });
	bar.style.setProperty("--cleanview-progress", `${Math.min(100, Math.max(0, calc.percent))}%`);

	const estimatedCount = rows.length - calc.unestimatedCount;
	card.createDiv({
		cls: "cleanview-capacity-detail",
		text:
			`${formatNumber(calc.estimatedHours)}h estimated across ${estimatedCount} ` +
			`${estimatedCount === 1 ? "task" : "tasks"} · ${formatNumber(calc.availableHours)}h available ` +
			`until ${formatLong(until)} (${calc.daysLeft} ${calc.daysLeft === 1 ? "day" : "days"})`,
	});

	// The number is a guess built from guesses; say so rather than presenting
	// it as more certain than it is.
	if (calc.unestimatedCount > 0) {
		card.createDiv({
			cls: "cleanview-capacity-warning",
			text:
				`${calc.unestimatedCount} ${calc.unestimatedCount === 1 ? "task has" : "tasks have"} no ` +
				"estimate — actual load may be higher.",
		});
	}
}
