/**
 * Aggregation shared by the stat and chart views.
 *
 * `value` is written as `count`, `sum:sider`, `avg:priority`, `min:due`,
 * `max:due` or `distinct:path`.
 */

import { type Row, type Source, accessor } from "./fields";

export type Aggregator = (rows: readonly Row[]) => number;

export function compileAggregator(spec: unknown, source: Source): Aggregator {
	const raw = String(spec ?? "count").trim();
	const [rawOp, rawField] = raw.split(":");
	const op = rawOp.toLowerCase();

	if (op === "count" || op === "antall" || !rawField) {
		return (rows) => rows.length;
	}

	const get = accessor(source, rawField.trim());

	switch (op) {
		case "sum":
		case "sum_":
			return (rows) => {
				let total = 0;
				for (const row of rows) {
					const value = Number(get(row));
					if (Number.isFinite(value)) total += value;
				}
				return total;
			};
		case "avg":
		case "snitt":
			return (rows) => {
				let total = 0;
				let n = 0;
				for (const row of rows) {
					const value = Number(get(row));
					if (Number.isFinite(value)) {
						total += value;
						n++;
					}
				}
				return n === 0 ? 0 : total / n;
			};
		case "min":
			return (rows) => reduceExtreme(rows, get, Math.min);
		case "max":
			return (rows) => reduceExtreme(rows, get, Math.max);
		case "distinct":
		case "unike": {
			return (rows) => {
				const seen = new Set<unknown>();
				for (const row of rows) seen.add(get(row));
				return seen.size;
			};
		}
		default:
			console.warn(`Puls: ukjent aggregat "${raw}", bruker count`);
			return (rows) => rows.length;
	}
}

function reduceExtreme(
	rows: readonly Row[],
	get: (row: Row) => unknown,
	pick: (a: number, b: number) => number,
): number {
	let result: number | null = null;
	for (const row of rows) {
		const value = Number(get(row));
		if (!Number.isFinite(value)) continue;
		result = result === null ? value : pick(result, value);
	}
	return result ?? 0;
}

/** True when the aggregate is a date, so callers can format it as one. */
export function aggregateYieldsDate(spec: unknown, source: Source): boolean {
	const raw = String(spec ?? "count");
	const [op, field] = raw.split(":");
	if (!field) return false;
	if (op !== "min" && op !== "max") return false;
	const dateFields = source === "tasks"
		? ["due", "scheduled", "start", "created", "completedOn"]
		: ["mtime", "ctime", "modified", "created"];
	return dateFields.includes(field.trim());
}
