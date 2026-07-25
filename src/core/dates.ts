/**
 * Calendar-date helpers built on integer day numbers.
 *
 * A day number is `Date.UTC(y, m, d) / 86400000`. Using UTC for what is really a
 * local calendar date sounds wrong, but it is deliberate: it makes the mapping
 * date <-> integer exact and DST-proof, and every date we handle comes from
 * text like "2026-07-11" that has no timezone to begin with.
 *
 * All formatting goes through `Intl` with the runtime's own locale rather than
 * hardcoded month and weekday names, so dates read correctly for every user
 * without the plugin shipping a translation table.
 */

const MS_PER_DAY = 86_400_000;

export function toDayNum(year: number, month: number, day: number): number {
	return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

/** Today according to the user's local clock. */
export function today(): number {
	const now = new Date();
	return toDayNum(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Day number for a millisecond timestamp, interpreted in local time. */
export function dayNumFromMs(ms: number): number {
	const d = new Date(ms);
	return toDayNum(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Parses a leading YYYY-MM-DD. Returns undefined for anything else. */
export function parseDate(value: string): number | undefined {
	const m = ISO_DATE.exec(value.trim());
	if (!m) return undefined;
	const year = +m[1];
	const month = +m[2];
	const day = +m[3];
	if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
	const num = toDayNum(year, month, day);
	// Reject overflow like 2026-02-31, which Date.UTC silently rolls forward.
	const back = new Date(num * MS_PER_DAY);
	if (back.getUTCDate() !== day || back.getUTCMonth() + 1 !== month) return undefined;
	return num;
}

export function formatISO(dayNum: number): string {
	const d = new Date(dayNum * MS_PER_DAY);
	const month = String(d.getUTCMonth() + 1).padStart(2, "0");
	const day = String(d.getUTCDate()).padStart(2, "0");
	return `${d.getUTCFullYear()}-${month}-${day}`;
}

/**
 * Formatters are created once. Constructing an `Intl` formatter is expensive
 * enough that doing it per row shows up in a table of a few hundred dates.
 *
 * `timeZone: "UTC"` is required, not cosmetic: day numbers are UTC-anchored, so
 * formatting them in local time would shift the date a day west of Greenwich.
 */
const longDate = new Intl.DateTimeFormat(undefined, {
	weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** Locale-aware long form, e.g. "Saturday 21 November 2026". */
export function formatLong(dayNum: number): string {
	return longDate.format(new Date(dayNum * MS_PER_DAY));
}

/** Short, human day label relative to today: "today", "yesterday", "in 3 days". */
export function formatRelativeDay(dayNum: number, from = today()): string {
	const diff = dayNum - from;
	if (Math.abs(diff) < 7) return relative.format(diff, "day");
	if (Math.abs(diff) < 42) return relative.format(Math.round(diff / 7), "week");
	// Beyond about six weeks a relative phrase stops being useful; show the date.
	return formatISO(dayNum);
}

/** Relative label for a millisecond timestamp, including sub-day resolution. */
export function formatRelativeMs(ms: number, now = Date.now()): string {
	const diffMin = Math.round((ms - now) / 60_000);
	if (Math.abs(diffMin) < 60) return relative.format(diffMin, "minute");
	const diffHours = Math.round(diffMin / 60);
	if (Math.abs(diffHours) < 24) return relative.format(diffHours, "hour");
	return formatRelativeDay(dayNumFromMs(ms));
}

/**
 * Coerces whatever a field holds into a day number.
 *
 * Frontmatter is the reason this exists: Obsidian parses `due: 2026-11-21`
 * into a real `Date` object, while a quoted `"2026-11-21"` stays a string, and
 * our own task fields are already day numbers. All three must compare equal.
 */
export function coerceDayNum(value: unknown): number | undefined {
	if (value === null || value === undefined) return undefined;
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) return undefined;
		// Frontmatter dates arrive as UTC midnight, so read UTC parts to avoid
		// shifting the date a day backwards west of Greenwich.
		return toDayNum(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
	}
	if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
	if (typeof value === "string") return parseDate(value);
	return undefined;
}

/**
 * Resolves a date expression used in block filters.
 *
 * Accepted: "today", "tomorrow", "yesterday", an ISO date, or an offset like
 * "today+7d", "today-2w", "today+1m". Norwegian equivalents are kept as aliases
 * because the plugin grew up in a Norwegian vault and they cost nothing.
 * Returns undefined if the expression is not a date at all.
 */
export function resolveDateExpr(input: unknown, base = today()): number | undefined {
	if (typeof input === "number" && Number.isFinite(input)) return input;
	if (input instanceof Date) return coerceDayNum(input);
	if (typeof input !== "string") return undefined;

	const raw = input.trim().toLowerCase().replace(/\s+/g, "");
	if (!raw) return undefined;

	const offset = /^([+-])(\d+)([dwmy])$/.exec(raw);
	if (offset) return applyOffset(base, offset[1] === "-" ? -+offset[2] : +offset[2], offset[3]);

	const anchored = /^([a-zæøå ]+|\d{4}-\d{2}-\d{2})(?:([+-])(\d+)([dwmy]))?$/.exec(raw);
	if (!anchored) return undefined;

	const anchor = resolveAnchor(anchored[1], base);
	if (anchor === undefined) return undefined;
	if (!anchored[2]) return anchor;
	return applyOffset(anchor, anchored[2] === "-" ? -+anchored[3] : +anchored[3], anchored[4]);
}

function resolveAnchor(token: string, base: number): number | undefined {
	switch (token) {
		case "today":
		case "idag":
			return base;
		case "tomorrow":
		case "imorgen":
			return base + 1;
		case "yesterday":
		case "igår":
		case "igar":
			return base - 1;
		default:
			return parseDate(token);
	}
}

function applyOffset(dayNum: number, amount: number, unit: string): number {
	if (unit === "d") return dayNum + amount;
	if (unit === "w") return dayNum + amount * 7;

	// Months and years need real calendar arithmetic, so drop back to Date.
	const d = new Date(dayNum * MS_PER_DAY);
	if (unit === "m") d.setUTCMonth(d.getUTCMonth() + amount);
	else if (unit === "y") d.setUTCFullYear(d.getUTCFullYear() + amount);
	return Math.floor(d.getTime() / MS_PER_DAY);
}
