/**
 * Calendar-date helpers built on integer day numbers.
 *
 * A day number is `Date.UTC(y, m, d) / 86400000`. Using UTC for what is really a
 * local calendar date sounds wrong, but it is deliberate: it makes the mapping
 * date <-> integer exact and DST-proof, and every date we handle comes from
 * text like "2026-07-11" that has no timezone to begin with.
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

const WEEKDAYS_NB = ["søndag", "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag"];
const MONTHS_NB = [
	"januar", "februar", "mars", "april", "mai", "juni",
	"juli", "august", "september", "oktober", "november", "desember",
];

/** Norwegian long form, e.g. "lørdag 11. juli 2026". */
export function formatLongNb(dayNum: number): string {
	const d = new Date(dayNum * MS_PER_DAY);
	const weekday = WEEKDAYS_NB[d.getUTCDay()];
	return `${weekday} ${d.getUTCDate()}. ${MONTHS_NB[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Short, human day label relative to today: "i dag", "i går", "om 3 dager", ... */
export function formatRelativeNb(dayNum: number, from = today()): string {
	const diff = dayNum - from;
	if (diff === 0) return "i dag";
	if (diff === 1) return "i morgen";
	if (diff === -1) return "i går";
	if (diff === 2) return "i overmorgen";
	if (diff > 0 && diff < 7) return `om ${diff} dager`;
	if (diff < 0 && diff > -7) return `for ${-diff} dager siden`;
	if (diff > 0) {
		const weeks = Math.round(diff / 7);
		if (weeks < 6) return `om ${weeks} uker`;
	} else {
		const weeks = Math.round(-diff / 7);
		if (weeks < 6) return `for ${weeks} uker siden`;
	}
	return formatISO(dayNum);
}

/** Relative label for a millisecond timestamp, including sub-day resolution. */
export function formatRelativeMs(ms: number, now = Date.now()): string {
	const diffMin = Math.round((now - ms) / 60_000);
	if (diffMin < 1) return "nå nettopp";
	if (diffMin < 60) return `${diffMin} min siden`;
	const diffHours = Math.round(diffMin / 60);
	if (diffHours < 24) return `${diffHours} t siden`;
	return formatRelativeNb(dayNumFromMs(ms));
}

/**
 * Coerces whatever a field holds into a day number.
 *
 * Frontmatter is the reason this exists: Obsidian parses `frist: 2026-11-21`
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
 * Accepted: "today"/"i dag", "tomorrow"/"i morgen", "yesterday"/"i går",
 * an ISO date, or an offset like "today+7d", "today-2w", "i dag + 1m".
 * Returns undefined if the expression is not a date at all.
 */
export function resolveDateExpr(input: unknown, base = today()): number | undefined {
	if (typeof input === "number" && Number.isFinite(input)) return input;
	if (input instanceof Date) {
		return toDayNum(input.getFullYear(), input.getMonth() + 1, input.getDate());
	}
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
