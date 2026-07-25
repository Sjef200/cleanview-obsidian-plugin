/**
 * Declarative filters, compiled to predicates.
 *
 * There is no expression language and no `eval` anywhere: a filter is plain
 * YAML data, and every operator is a fixed function. That keeps dashboards
 * safe to share and makes the hot path a chain of monomorphic closures.
 *
 *   filter:
 *     done: false                     # equality
 *     due: { to: today }              # on or before today
 *     due: { from: today, to: today+7d }
 *     tags: { has: [school, exam] }   # any of
 *     text: { matches: "chapter" }
 *     status: { not: "-" }
 */

import { coerceDayNum, resolveDateExpr } from "../core/dates";
import { type Accessor, type Row, type Source, accessor, isDateField } from "./fields";

export type Predicate = (row: Row) => boolean;

/** Keyword shortcuts that expand to a range on a date field. Norwegian aliases included. */
const DATE_KEYWORDS = new Set([
	"overdue", "forfalt",
	"today", "i dag", "idag",
	"due", "any", "exists",
	"none", "ingen",
	"week", "uke",
	"future", "fremtid",
	"past", "fortid",
]);

/** The subset safe to apply to a field of unknown type. */
const UNAMBIGUOUS_DATE_KEYWORDS = new Set([
	"overdue", "forfalt",
	"week", "uke",
	"future", "fremtid",
	"past", "fortid",
]);

export function compileFilter(config: unknown, source: Source): Predicate | null {
	if (!config || typeof config !== "object" || Array.isArray(config)) return null;

	const predicates: Predicate[] = [];
	for (const [field, condition] of Object.entries(config as Record<string, unknown>)) {
		const predicate = compileCondition(field, condition, source);
		if (predicate) predicates.push(predicate);
	}

	if (predicates.length === 0) return null;
	if (predicates.length === 1) return predicates[0];
	return (row) => {
		for (const predicate of predicates) if (!predicate(row)) return false;
		return true;
	};
}

function compileCondition(field: string, condition: unknown, source: Source): Predicate | null {
	const get = accessor(source, field);
	const dateField = isDateField(source, field);

	if (typeof condition === "string") {
		const keyword = condition.toLowerCase();
		// On a known date field every keyword applies. On an arbitrary
		// frontmatter field only the unambiguous ones do — `status: none` should
		// still mean the literal string "none", not "status is empty".
		if (dateField ? DATE_KEYWORDS.has(keyword) : UNAMBIGUOUS_DATE_KEYWORDS.has(keyword)) {
			return compileDateKeyword(get, keyword);
		}
	}

	if (condition !== null && typeof condition === "object" && !Array.isArray(condition)) {
		return compileOperators(get, condition as Record<string, unknown>, dateField);
	}

	// Bare value means equality; arrays mean "any of".
	if (Array.isArray(condition)) {
		const allowed = condition.map((v) => normalize(v, dateField));
		return (row) => allowed.includes(normalize(get(row), dateField));
	}

	const expected = normalize(condition, dateField);
	return (row) => normalize(get(row), dateField) === expected;
}

function compileDateKeyword(get: Accessor, keyword: string): Predicate {
	// Values are coerced per row rather than assumed to be day numbers, so these
	// keywords work on a frontmatter `frist:` (a Date) as well as on `due`.
	const day = (row: Row) => coerceDayNum(get(row));

	switch (keyword) {
		case "overdue":
		case "forfalt":
		case "past":
		case "fortid":
			return (row) => {
				const value = day(row);
				return value !== undefined && value < todayCached();
			};
		case "today":
		case "i dag":
		case "idag":
			return (row) => day(row) === todayCached();
		case "week":
		case "uke":
			return (row) => {
				const value = day(row);
				if (value === undefined) return false;
				const now = todayCached();
				return value >= now && value <= now + 7;
			};
		case "future":
		case "fremtid":
			return (row) => {
				const value = day(row);
				return value !== undefined && value > todayCached();
			};
		case "none":
		case "ingen":
			return (row) => {
				const value = get(row);
				return value === undefined || value === null || value === "";
			};
		default: // "due" / "any" / "exists"
			return (row) => {
				const value = get(row);
				return value !== undefined && value !== null && value !== "";
			};
	}
}

function compileOperators(
	get: Accessor,
	operators: Record<string, unknown>,
	dateField: boolean,
): Predicate | null {
	const checks: Predicate[] = [];

	for (const [rawOp, operand] of Object.entries(operators)) {
		const op = rawOp.toLowerCase();

		// Whether an operand is a date is decided by the operand itself, not by
		// the field name. Built-in fields like `due` are known at compile time,
		// but a frontmatter field such as `frist` is not — and both must accept
		// `today+30d`. `resolveDateExpr` rejects plain text, so a string field
		// compared against "m" still falls through to a string comparison.
		const bound = resolveDateExpr(operand);
		const isDateBound = bound !== undefined && typeof operand !== "number";
		const asDate = dateField || isDateBound;
		const value = isDateBound ? bound : operand;

		switch (op) {
			case "exists":
				checks.push((row) => {
					const v = get(row);
					return (v !== undefined && v !== null) === (operand !== false);
				});
				break;
			case "is":
			case "eq":
			case "on":
				checks.push((row) => normalize(get(row), asDate) === normalize(value, asDate));
				break;
			case "not":
			case "ne":
				checks.push((row) => normalize(get(row), asDate) !== normalize(value, asDate));
				break;
			case "before":
			case "lt":
				checks.push(numeric(get, value, (a, b) => a < b, asDate));
				break;
			case "after":
			case "gt":
				checks.push(numeric(get, value, (a, b) => a > b, asDate));
				break;
			case "to":
			case "lte":
			case "max":
				checks.push(numeric(get, value, (a, b) => a <= b, asDate));
				break;
			case "from":
			case "gte":
			case "min":
				checks.push(numeric(get, value, (a, b) => a >= b, asDate));
				break;
			case "has":
			case "includes":
			case "in": {
				const wanted = (Array.isArray(value) ? value : [value]).map((v) =>
					String(v).toLowerCase().replace(/^#/, ""),
				);
				checks.push((row) => {
					const actual = get(row);
					if (Array.isArray(actual)) {
						return actual.some((entry) => wanted.includes(String(entry).toLowerCase()));
					}
					if (actual === undefined || actual === null) return false;
					const text = String(actual).toLowerCase();
					return wanted.some((w) => text.includes(w));
				});
				break;
			}
			case "matches":
			case "contains": {
				const needle = String(value).toLowerCase();
				checks.push((row) => {
					const actual = get(row);
					return actual !== undefined && actual !== null
						&& String(actual).toLowerCase().includes(needle);
				});
				break;
			}
			default:
				console.warn(`CleanView: ignored unknown filter operator "${rawOp}"`);
		}
	}

	if (checks.length === 0) return null;
	if (checks.length === 1) return checks[0];
	return (row) => {
		for (const check of checks) if (!check(row)) return false;
		return true;
	};
}

function numeric(
	get: Accessor,
	operand: unknown,
	compare: (a: number, b: number) => boolean,
	asDate: boolean,
): Predicate {
	const bound = typeof operand === "number" ? operand : Number(operand);
	if (!Number.isFinite(bound)) {
		// Non-numeric bound: fall back to string comparison so `name: {from: "m"}`
		// still does something sensible instead of dropping every row.
		const text = String(operand).toLowerCase();
		return (row) => {
			const value = get(row);
			if (value === undefined || value === null) return false;
			const other = String(value).toLowerCase();
			return compare(other < text ? -1 : other > text ? 1 : 0, 0);
		};
	}
	return (row) => {
		const raw = get(row);
		// Frontmatter holds Dates and ISO strings where task fields hold day
		// numbers; coerce so a range test works the same on either.
		const value = asDate ? coerceDayNum(raw) : typeof raw === "number" ? raw : undefined;
		// Rows missing the field never satisfy a range test.
		if (value === undefined) return false;
		return compare(value, bound);
	};
}

function normalize(value: unknown, dateField: boolean): unknown {
	if (value === null || value === undefined) return undefined;
	// A Date is always a date, whatever the caller thinks the field is.
	if (value instanceof Date) return coerceDayNum(value);
	if (dateField && typeof value === "string") {
		const resolved = resolveDateExpr(value);
		if (resolved !== undefined) return resolved;
	}
	if (typeof value === "string") return value.toLowerCase();
	return value;
}

/**
 * `today()` is stable within a render pass but must not be captured at compile
 * time, or a dashboard left open overnight would filter against yesterday.
 */
let cachedToday = 0;
let cachedAt = 0;

function todayCached(): number {
	const now = Date.now();
	if (now - cachedAt > 60_000) {
		const d = new Date(now);
		cachedToday = Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
		cachedAt = now;
	}
	return cachedToday;
}
