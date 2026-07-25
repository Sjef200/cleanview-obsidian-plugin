/**
 * Turns query results into chart data and draws them.
 *
 *   view: chart
 *   type: bar | line | donut
 *   by: folder            # what to bucket on
 *   value: count          # or sum:sider
 *   fillGap: true         # line charts only: insert empty days
 *
 * Every chart ships with a table view behind a toggle. That is not a nicety:
 * three of the light-mode series colours sit below 3:1 against the surface, and
 * the palette rules require visible relief when that is true.
 */

import { formatISO, formatRelativeDay } from "../core/dates";
import { compileAggregator } from "../query/aggregate";
import { type Row, type Source, accessor, isDateField } from "../query/fields";
import type { BlockConfig, QueryResult } from "../query/query";
import { type Datum, renderBar, renderDonut, renderLine } from "../charts/charts";
import { Tooltip, onWidth } from "../charts/svg";
import { emptyState, sectionHeader } from "./render-utils";
import { formatNumber } from "./table-view";
import type { ViewContext } from "./task-view";

const TYPES = new Set(["bar", "line", "donut"]);

export interface ChartHandle {
	dispose: () => void;
}

export function renderChart(
	container: HTMLElement,
	result: QueryResult,
	config: BlockConfig,
	_ctx: ViewContext,
): ChartHandle {
	sectionHeader(container, config.title);

	const rawType = String(config.type ?? "bar").toLowerCase();
	const type = TYPES.has(rawType) ? rawType : "bar";
	const byField = String(config.by ?? config.group ?? "folder");
	const data = bucket(result.rows, byField, config, type);

	if (data.length === 0) {
		emptyState(container, "Nothing to plot.");
		return { dispose: () => undefined };
	}

	const host = container.createDiv({ cls: "cleanview-chart" });
	const tooltip = new Tooltip();
	const format = (n: number) => formatNumber(Math.round(n * 10) / 10);

	const dispose = onWidth(host, (width) => {
		host.querySelector("svg")?.remove();
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("class", "cleanview-svg");
		svg.setAttribute("role", "img");
		svg.setAttribute("aria-label", chartSummary(config.title, type, data));
		host.insertBefore(svg, host.firstChild);

		if (type === "line") renderLine(host, svg, data, width, tooltip, format);
		else if (type === "donut") renderDonut(host, svg, data, width, tooltip, format, config.title);
		else renderBar(host, svg, data, width, tooltip, format);
	});

	addTableToggle(container, data, format);

	return {
		dispose: () => {
			dispose();
			tooltip.destroy();
		},
	};
}

/** Groups rows by a field and aggregates each bucket. */
function bucket(rows: Row[], byField: string, config: BlockConfig, type: string): Datum[] {
	const source: Source = config.source;
	const get = accessor(source, byField);
	const aggregate = compileAggregator(config.value, source);
	const dateAxis = isDateField(source, byField);

	const buckets = new Map<string, { key: unknown; rows: Row[] }>();
	for (const row of rows) {
		const raw = get(row);
		const values = Array.isArray(raw) ? (raw.length ? raw : [undefined]) : [raw];
		for (const value of values) {
			// Rows with no value in the bucketing field would form a meaningless
			// "empty" slice, so they are dropped from charts.
			if (value === undefined || value === null || value === "") continue;
			const key = String(value);
			let entry = buckets.get(key);
			if (!entry) {
				entry = { key: value, rows: [] };
				buckets.set(key, entry);
			}
			entry.rows.push(row);
		}
	}

	let data: Datum[] = [...buckets.entries()].map(([key, entry]) => ({
		label: dateAxis && typeof entry.key === "number" ? formatISO(entry.key).slice(5) : key,
		value: aggregate(entry.rows),
		sortKey: typeof entry.key === "number" ? entry.key : undefined,
		detail: dateAxis && typeof entry.key === "number" ? formatRelativeDay(entry.key) : undefined,
	}));

	if (dateAxis) {
		data.sort((a, b) => (a.sortKey ?? 0) - (b.sortKey ?? 0));
		if (type === "line" && config.fillGap !== false) data = fillDateGaps(data);
	} else if (type !== "line") {
		data.sort((a, b) => b.value - a.value);
	}

	const limit = Number(config.maxBars);
	if (Number.isFinite(limit) && limit > 0 && data.length > limit && type === "bar") {
		data = data.slice(0, limit);
	}

	return data;
}

/**
 * Inserts zero-valued days for gaps in a date series.
 *
 * Without this a line chart silently compresses time: three days with no
 * activity would look like one step, misrepresenting the trend.
 */
function fillDateGaps(data: Datum[]): Datum[] {
	if (data.length < 2) return data;
	const first = data[0].sortKey;
	const last = data[data.length - 1].sortKey;
	if (first === undefined || last === undefined) return data;

	const span = last - first;
	// Guard against an outlier date turning one chart into 30 000 points.
	if (span > 400) return data;

	const byDay = new Map(data.map((d) => [d.sortKey, d]));
	const filled: Datum[] = [];
	for (let day = first; day <= last; day++) {
		const existing = byDay.get(day);
		filled.push(
			existing ?? {
				label: formatISO(day).slice(5),
				value: 0,
				sortKey: day,
				detail: formatRelativeDay(day),
			},
		);
	}
	return filled;
}

function chartSummary(title: string | undefined, type: string, data: Datum[]): string {
	const kind = type === "line" ? "line chart" : type === "donut" ? "donut chart" : "bar chart";
	return `${title ?? "Chart"}: ${kind} with ${data.length} points`;
}

/** Reveals the numbers behind the chart. Required relief for low-contrast hues. */
function addTableToggle(
	container: HTMLElement,
	data: Datum[],
	format: (n: number) => string,
): void {
	const toggle = container.createEl("button", { cls: "cleanview-more cleanview-table-toggle", text: "Show values" });
	let table: HTMLElement | null = null;

	toggle.addEventListener("click", () => {
		if (table) {
			table.remove();
			table = null;
			toggle.setText("Show values");
			return;
		}
		table = container.createDiv({ cls: "cleanview-table-wrap" });
		const el = table.createEl("table", { cls: "cleanview-table" });
		const head = el.createEl("thead").createEl("tr");
		head.createEl("th", { text: "Category" });
		head.createEl("th", { text: "Value", cls: "cleanview-align-right" });
		const body = el.createEl("tbody");
		for (const datum of data) {
			const tr = body.createEl("tr");
			tr.createEl("td", { text: datum.label });
			tr.createEl("td", { text: format(datum.value), cls: "cleanview-align-right" });
		}
		toggle.setText("Hide values");
	});
}
