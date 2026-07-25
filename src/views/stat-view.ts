/**
 * A single headline number, optionally with a goal bar.
 *
 *   view: stat
 *   title: Åpne oppgaver
 *   filter: { done: false }
 *   value: count
 *   goal: 20
 */

import { formatISO } from "../core/dates";
import { aggregateYieldsDate, compileAggregator } from "../query/aggregate";
import type { BlockConfig, QueryResult } from "../query/query";
import { formatNumber } from "./table-view";

export function renderStat(
	container: HTMLElement,
	result: QueryResult,
	config: BlockConfig,
): void {
	const aggregate = compileAggregator(config.value, config.source);
	const value = aggregate(result.rows);
	const isDate = aggregateYieldsDate(config.value, config.source);

	const card = container.createDiv({ cls: "cleanview-stat" });
	if (config.title) card.createDiv({ cls: "cleanview-stat-label", text: config.title });

	const valueRow = card.createDiv({ cls: "cleanview-stat-value" });
	if (config.prefix) valueRow.createSpan({ cls: "cleanview-stat-affix", text: String(config.prefix) });
	valueRow.createSpan({ text: isDate ? formatISO(value) : formatNumber(value) });
	if (config.suffix) valueRow.createSpan({ cls: "cleanview-stat-affix", text: String(config.suffix) });

	const goal = Number(config.goal);
	if (Number.isFinite(goal) && goal > 0) {
		const percent = Math.max(0, Math.min(100, Math.round((value / goal) * 100)));
		const track = card.createDiv({ cls: "cleanview-progress" });
		const bar = track.createDiv({ cls: "cleanview-progress-bar" });
		bar.style.setProperty("--cleanview-progress", `${percent}%`);
		card.createDiv({ cls: "cleanview-stat-goal", text: `${percent}% of ${formatNumber(goal)}` });
	}
}
