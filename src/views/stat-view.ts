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

	const card = container.createDiv({ cls: "puls-stat" });
	if (config.title) card.createDiv({ cls: "puls-stat-label", text: config.title });

	const valueRow = card.createDiv({ cls: "puls-stat-value" });
	if (config.prefix) valueRow.createSpan({ cls: "puls-stat-affix", text: String(config.prefix) });
	valueRow.createSpan({ text: isDate ? formatISO(value) : formatNumber(value) });
	if (config.suffix) valueRow.createSpan({ cls: "puls-stat-affix", text: String(config.suffix) });

	const goal = Number(config.goal);
	if (Number.isFinite(goal) && goal > 0) {
		const percent = Math.max(0, Math.min(100, Math.round((value / goal) * 100)));
		const track = card.createDiv({ cls: "puls-progress" });
		const bar = track.createDiv({ cls: "puls-progress-bar" });
		bar.style.setProperty("--puls-progress", `${percent}%`);
		card.createDiv({ cls: "puls-stat-goal", text: `${percent} % av ${formatNumber(goal)}` });
	}
}
