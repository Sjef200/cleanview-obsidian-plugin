/**
 * Correctness and performance harness for the pure query layer.
 *
 * Runs outside Obsidian: everything under src/core and src/query is deliberately
 * free of Obsidian runtime dependencies (only types), so it can be tested in
 * plain Node. Bundle with esbuild and run:  npm test
 */

import type { ListItemCache } from "obsidian";
import { coerceDayNum, formatISO, parseDate, resolveDateExpr, today } from "../src/core/dates";
import { parseTaskLine } from "../src/core/task-parser";
import { compileFilter } from "../src/query/filter";
import { compileSort } from "../src/query/sort";
import { compileAggregator } from "../src/query/aggregate";
import type { CleanViewTask } from "../src/core/types";
import type { Row } from "../src/query/fields";
import { DEFAULT_STATE, buildBlock, toBuilderState, type BuilderState } from "../src/ui/block-spec";
import { DEFAULT_TASK, buildTaskLine, dayNumToInput, hoursToInput, rewriteTaskBody, shiftInput, todayInput } from "../src/ui/task-spec";
import { computeCapacity, normalizeBudget } from "../src/views/capacity-spec";
import { COLUMNS, bucketRows, columnById } from "../src/views/board-spec";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
	const a = JSON.stringify(actual);
	const b = JSON.stringify(expected);
	if (a === b) {
		passed++;
	} else {
		failed++;
		console.log(`  FAIL  ${name}\n          got:      ${a}\n          expected: ${b}`);
	}
}

function ok(name: string, condition: boolean): void {
	if (condition) passed++;
	else {
		failed++;
		console.log(`  FAIL  ${name}`);
	}
}

function listItem(line: number, task: string): ListItemCache {
	return {
		position: { start: { line, col: 0, offset: 0 }, end: { line, col: 0, offset: 0 } },
		parent: -1,
		task,
	} as ListItemCache;
}

function parse(line: string, lineNo = 0): CleanViewTask {
	const status = /\[(.)\]/.exec(line)?.[1] ?? " ";
	const task = parseTaskLine(line, listItem(lineNo, status), "School/Matte.md", "Matte", "Skole");
	if (!task) throw new Error(`could not parse: ${line}`);
	return task;
}

// ---------------------------------------------------------------- dates

console.log("\nDates");
check("parseDate accepts a valid date", parseDate("2026-07-11"), Date.UTC(2026, 6, 11) / 86_400_000);
check("parseDate rejects 31 February", parseDate("2026-02-31"), undefined);
check("parseDate rejects non-dates", parseDate("i går"), undefined);
check("formatISO round-trips", formatISO(parseDate("2026-03-01")!), "2026-03-01");

const base = parseDate("2026-07-11")!;
check("today+7d", resolveDateExpr("today+7d", base), base + 7);
check("today-2w", resolveDateExpr("today-2w", base), base - 14);
check("Norwegian alias: i dag", resolveDateExpr("i dag", base), base);
check("Norwegian alias: i morgen", resolveDateExpr("i morgen", base), base + 1);
check("whitespace is tolerated", resolveDateExpr("today + 7d", base), base + 7);
check("month offset crosses the year boundary", formatISO(resolveDateExpr("2026-11-30+2m", base)!), "2027-01-30");
check("absolute date", resolveDateExpr("2026-01-05", base), parseDate("2026-01-05"));
check("invalid expression", resolveDateExpr("neste tirsdag", base), undefined);

// ------------------------------------------------------------ task parsing

console.log("\nTask parsing (Tasks dialect)");
{
	const t = parse("- [ ] Read chapter 5 📅 2026-07-14 ⏫ #school");
	check("metadata stripped from text", t.text, "Read chapter 5 #school");
	check("due date", t.due, parseDate("2026-07-14"));
	check("priority high", t.priority, 4);
	check("tag", t.tags, ["school"]);
	check("not done", t.done, false);
}
{
	const t = parse("- [x] Submission ✅ 2026-07-10 📅 2026-07-09");
	check("done", t.done, true);
	check("completion date", t.completedOn, parseDate("2026-07-10"));
	check("due date preserved", t.due, parseDate("2026-07-09"));
	check("text without metadata", t.text, "Submission");
}
{
	const t = parse("    - [ ] Subtask 🔁 every week 🔺");
	check("recurrence keeps multi-word value", t.recurrence, "every week");
	check("priority highest", t.priority, 5);
	check("depth from indent", t.depth, 2);
}

console.log("\nTask parsing (Dataview dialect)");
{
	const t = parse("- [ ] Write note [due:: 2026-08-01] [priority:: high]");
	check("inline due date", t.due, parseDate("2026-08-01"));
	check("inline priority", t.priority, 4);
	check("metadata stripped from text", t.text, "Write note");
}
{
	const t = parse("- [ ] Meeting (frist:: 2026-09-15) with (place:: school)");
	check("Norwegian field alias: frist", t.due, parseDate("2026-09-15"));
	ok("unknown inline field is left in the text", t.text.includes("place:: school"));
}
{
	const t = parse("- [/] In-progress task");
	check("custom status counts as done", t.done, true);
	check("status character preserved", t.status, "/");
}
{
	const t = parse("- [ ] Plain task with nothing");
	check("no due date", t.due, undefined);
	check("default priority", t.priority, 2);
}

// -------------------------------------------------- the actual dashboard

console.log("\nThe dashboard queries");

const T = today();
const tasks: CleanViewTask[] = [
	parse("- [ ] Overdue homework 📅 " + formatISO(T - 3) + " ⏫"),
	parse("- [ ] Due today 📅 " + formatISO(T)),
	parse("- [ ] Test in 3 days 📅 " + formatISO(T + 3) + " 🔺"),
	parse("- [ ] In 10 days 📅 " + formatISO(T + 10)),
	parse("- [ ] No deadline"),
	parse("- [x] Finished 📅 " + formatISO(T - 1)),
];

// "Dagens oppgaver": !completed AND (due = today OR due < today)
{
	const predicate = compileFilter({ done: false, due: { to: "today" } }, "tasks")!;
	const hits = tasks.filter((t) => predicate(t as Row));
	check("due today: count", hits.length, 2);
	ok("excludes done", !hits.some((t) => t.done));
	ok("excludes future", !hits.some((t) => (t.due ?? 0) > T));
	ok("excludes undated", !hits.some((t) => t.due === undefined));

	const sorter = compileSort(["priority desc", "due asc"], "tasks")!;
	hits.sort((a, b) => sorter(a as Row, b as Row));
	check("sorted: priority first", hits[0].text, "Overdue homework");
}

// "Alle åpne oppgaver"
{
	const predicate = compileFilter({ done: false }, "tasks")!;
	check("all open", tasks.filter((t) => predicate(t as Row)).length, 5);
}

// "Neste 7 dager": due >= today AND due <= today + 7d
{
	const predicate = compileFilter({ done: false, due: { from: "today", to: "today+7d" } }, "tasks")!;
	const hits = tasks.filter((t) => predicate(t as Row));
	check("next 7 days: count", hits.length, 2);
	ok("day 10 excluded", !hits.some((t) => t.text.includes("10 dager")));
}

// Overdue keyword
{
	const predicate = compileFilter({ done: false, due: "overdue" }, "tasks")!;
	const hits = tasks.filter((t) => predicate(t as Row));
	check("overdue", hits.map((t) => t.text), ["Overdue homework"]);
}

console.log("\nAggregates");
{
	const count = compileAggregator("count", "tasks");
	check("count", count(tasks as Row[]), 6);
	const maxDue = compileAggregator("max:due", "tasks");
	check("max:due", maxDue(tasks as Row[]), T + 10);
	const distinct = compileAggregator("distinct:priority", "tasks");
	check("distinct:priority", distinct(tasks as Row[]), 3);
}

// ---------------------------------------------------------------- sorting

console.log("\nSorting");
{
	const sorter = compileSort("due asc", "tasks")!;
	const sorted = [...tasks].sort((a, b) => sorter(a as Row, b as Row));
	check("undated sorts last", sorted[sorted.length - 1].text, "No deadline");

	const desc = compileSort("due desc", "tasks")!;
	const sortedDesc = [...tasks].sort((a, b) => desc(a as Row, b as Row));
	check("undated sorts last descending too", sortedDesc[sortedDesc.length - 1].text, "No deadline");
}

// --------------------------------------------- goals & frontmatter dates

console.log("\nGoals and frontmatter dates");
{
	// Obsidian's YAML parser turns an unquoted `due: 2026-11-21` into a Date,
	// but a quoted one stays a string. Both must behave identically.
	const asDate = new Date(Date.UTC(2026, 10, 21));
	check("Date object", coerceDayNum(asDate), parseDate("2026-11-21"));
	check("ISO string", coerceDayNum("2026-11-21"), parseDate("2026-11-21"));
	check("day number passes through", coerceDayNum(20279), 20279);
	check("missing field", coerceDayNum(undefined), undefined);
	check("invalid Date", coerceDayNum(new Date("tull")), undefined);

	const goals = [
		{ path: "Goals/Eksamen.md", name: "Exam", folder: "Goals", mtime: 0, ctime: 0, size: 0,
			frontmatter: { type: "goal", frist: new Date(Date.UTC(2026, 10, 21)) }, tags: [], taskCount: 5, openTaskCount: 2 },
		{ path: "Goals/Innlevering.md", name: "Essay", folder: "Goals", mtime: 0, ctime: 0, size: 0,
			frontmatter: { type: "goal", frist: new Date(Date.UTC(2026, 10, 3)) }, tags: [], taskCount: 0, openTaskCount: 0 },
		{ path: "Goals/Fjern.md", name: "Certificate", folder: "Goals", mtime: 0, ctime: 0, size: 0,
			frontmatter: { type: "goal", frist: new Date(Date.UTC(2027, 4, 1)) }, tags: [], taskCount: 0, openTaskCount: 0 },
		{ path: "Goals/Utenfrist.md", name: "No deadline", folder: "Goals", mtime: 0, ctime: 0, size: 0,
			frontmatter: { type: "goal" }, tags: [], taskCount: 0, openTaskCount: 0 },
	] as unknown as Row[];

	// Chronological, not alphabetical by weekday name.
	const byDeadline = compileSort("frist asc", "files")!;
	const sorted = [...goals].sort(byDeadline);
	check(
		"frontmatter dates sort chronologically",
		sorted.map((g) => (g as { name: string }).name),
		["Essay", "Exam", "Certificate", "No deadline"],
	);

	// A date expression against a frontmatter field whose name we cannot know
	// at compile time.
	const inNovember = compileFilter(
		{ type: "goal", frist: { from: "2026-11-01", to: "2026-11-30" } },
		"files",
	)!;
	check(
		"range on a frontmatter date",
		goals.filter((g) => inNovember(g)).map((g) => (g as { name: string }).name),
		["Exam", "Essay"],
	);

	const overdue = compileFilter({ frist: "overdue" }, "files")!;
	check("overdue keyword on frontmatter", goals.filter((g) => overdue(g)).length, 0);

	// A plain string field must not be hijacked by the date machinery.
	const notADate = compileFilter({ type: "goal" }, "files")!;
	check("string field untouched", goals.filter((g) => notADate(g)).length, 4);
}

// --------------------------------------------------------- block builder

console.log("\nBlock builder");
{
	const base = { ...DEFAULT_STATE };

	check(
		"default: open tasks",
		buildBlock(base),
		"```cleanview\nview: tasks\nfilter:\n  done: false\nsort: [priority desc, due asc]\n```\n",
	);

	check(
		"title, folder, tag and due window",
		buildBlock({ ...base, title: "This week", folder: "School", tag: "#exam", due: "week" }),
		"```cleanview\nview: tasks\ntitle: This week\nfrom: School\nfilter:\n  done: false\n"
			+ "  due: { to: today+7d }\n  tags: { has: exam }\nsort: [priority desc, due asc]\n```\n",
	);

	check(
		"chart carries its type and split",
		buildBlock({ ...base, view: "chart", chartType: "donut", by: "priority" }),
		"```cleanview\nview: chart\ntype: donut\nfilter:\n  done: false\nby: priority\nvalue: count\n```\n",
	);

	check(
		"counting notes switches the source and drops task filters",
		buildBlock({ ...base, view: "stat", measure: "notes", status: "all" }),
		"```cleanview\nview: stat\nsource: files\nvalue: count\n```\n",
	);

	check(
		"countdown reads notes, not tasks",
		buildBlock({ ...base, view: "countdown", folder: "Goals" }),
		"```cleanview\nview: countdown\nfrom: Goals\nsource: files\nsort: [due asc]\n```\n",
	);

	// "Both" means no status filter at all, and with no due window that leaves
	// nothing to filter on — the block must then omit the key entirely rather
	// than emit a dangling "filter:".
	const noFilters = buildBlock({ ...base, status: "all", due: "any" });
	ok("no empty filter key", !noFilters.includes("filter:"));

	// Whatever the combination, the result has to stay well-formed.
	const views: Array<BuilderState["view"]> = ["tasks", "table", "stat", "chart", "countdown"];
	const dues: Array<BuilderState["due"]> = ["any", "overdue", "today", "week", "month", "none"];
	let malformed = 0;
	for (const view of views) {
		for (const dueChoice of dues) {
			for (const status of ["open", "done", "all"] as Array<BuilderState["status"]>) {
				const block = buildBlock({ ...base, view, due: dueChoice, status, tag: "x", folder: "F" });
				const lines = block.trimEnd().split("\n");
				if (lines[0] !== "```cleanview" || lines[lines.length - 1] !== "```") malformed++;
				// Only filter entries are indented, and always by exactly two spaces.
				for (const line of lines.slice(1, -1)) {
					if (line.startsWith(" ") && !/^ {2}\S/.test(line)) malformed++;
					if (line.trim() === "filter:" ) continue;
				}
				if (block.includes("filter:\n```")) malformed++;
			}
		}
	}
	check("all 90 combinations are well-formed", malformed, 0);

	// Every block the dialog can produce must be readable back into the same
	// state, or the edit button would quietly rewrite the user's block.
	let roundTripFailures = 0;
	for (const view of views) {
		for (const dueChoice of dues) {
			for (const status of ["open", "done", "all"] as Array<BuilderState["status"]>) {
				for (const folder of ["", "School"]) {
					const original = { ...base, view, due: dueChoice, status, folder, title: "T" };
					const block = buildBlock(original);
					const read = toBuilderState(block);
					if (!read || buildBlock(read) !== block) roundTripFailures++;
				}
			}
		}
	}
	check("every generated block reads back identically", roundTripFailures, 0);

	// Anything the dialog cannot express must be refused rather than mangled.
	const handTuned = [
		"```cleanview\nview: tasks\nfilter:\n  due: { from: today, to: today+3d }\n```",
		"```cleanview\nview: table\nsource: files\ncolumns:\n  - { field: name }\n```",
		"```cleanview\nview: tasks\nfilter:\n  text: { matches: chapter }\n```",
		"```cleanview\nview: tasks\nlimit: 5\n```",
	];
	check(
		"hand-tuned blocks are refused",
		handTuned.map((b) => toBuilderState(b)),
		[null, null, null, null],
	);
}

// ----------------------------------------------------------- task entry

console.log("\nTask entry");
{
	check("bare task", buildTaskLine({ ...DEFAULT_TASK, text: "Read chapter 5" }),
		"- [ ] Read chapter 5");
	check("with due date", buildTaskLine({ ...DEFAULT_TASK, text: "Essay", due: "2026-08-04" }),
		"- [ ] Essay 📅 2026-08-04");
	check("with priority", buildTaskLine({ ...DEFAULT_TASK, text: "Exam", priority: 5, due: "2026-11-21" }),
		"- [ ] Exam 🔺 📅 2026-11-21");
	check("normal priority writes no emoji", buildTaskLine({ ...DEFAULT_TASK, text: "X", priority: 2 }),
		"- [ ] X");
	check("empty text still yields a valid line", buildTaskLine(DEFAULT_TASK), "- [ ] New task");

	// A malformed date must never reach the note: it would look fine and then
	// silently fail to match every date filter.
	check("malformed date is dropped", buildTaskLine({ ...DEFAULT_TASK, text: "X", due: "04.08.2026" }),
		"- [ ] X");

	check("shiftInput crosses a month boundary", shiftInput("2026-07-31", 1), "2026-08-01");
	check("shiftInput crosses a year boundary", shiftInput("2026-12-31", 1), "2027-01-01");
	check("shiftInput handles a leap day", shiftInput("2028-02-28", 1), "2028-02-29");
	ok("todayInput is YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(todayInput()));

	// Whatever the dialog writes, the parser has to read back.
	const line = buildTaskLine({ text: "Round trip", due: "2026-09-15", priority: 4, estimate: "" });
	const parsed = parse(line);
	check("parser reads the emitted line", parsed.text, "Round trip");
	check("parser reads the emitted due date", parsed.due, parseDate("2026-09-15"));
	check("parser reads the emitted priority", parsed.priority, 4);

	// Estimates, both dialects and the round trip.
	check("with estimate", buildTaskLine({ ...DEFAULT_TASK, text: "Lab report", estimate: "4" }),
		"- [ ] Lab report ⏱️ 4h");
	check("estimate accepts a comma decimal", buildTaskLine({ ...DEFAULT_TASK, text: "X", estimate: "1,5" }),
		"- [ ] X ⏱️ 1.5h");
	check("zero estimate writes nothing", buildTaskLine({ ...DEFAULT_TASK, text: "X", estimate: "0" }),
		"- [ ] X");
	check("estimate parses from the emoji dialect", parse("- [ ] Lab report ⏱️ 4h").estimate, 4);
	check("estimate parses a comma decimal", parse("- [ ] X ⏱️ 1,5h").estimate, 1.5);
	check("estimate parses from the Dataview dialect", parse("- [ ] X [estimate:: 4]").estimate, 4);
	check("no estimate is undefined", parse("- [ ] Plain task").estimate, undefined);

	check("hoursToInput round-trips", hoursToInput(4), "4");
	check("hoursToInput handles no estimate", hoursToInput(undefined), "");

	const withEstimate = buildTaskLine({ text: "Round trip", due: "", priority: 2, estimate: "2.5" });
	check("reparsed estimate", parse(withEstimate).estimate, 2.5);
}

// ------------------------------------------------------ editing a task

console.log("\nEditing a task");
{
	const edit = (raw: string, text: string, due: string, priority: number, estimate = "") =>
		rewriteTaskBody(raw, { text, due, priority, estimate });

	check("changes the due date",
		edit("Read chapter 5 📅 2026-08-01", "Read chapter 5", "2026-09-15", 2),
		"Read chapter 5 📅 2026-09-15");

	check("adds a priority that was not there",
		edit("Read chapter 5 📅 2026-08-01", "Read chapter 5", "2026-08-01", 5),
		"Read chapter 5 🔺 📅 2026-08-01");

	check("clearing the date removes the token",
		edit("Read chapter 5 📅 2026-08-01 ⏫", "Read chapter 5", "", 4),
		"Read chapter 5 ⏫");

	// The dialog has no field for these, so losing them would be silent damage.
	check("keeps recurrence",
		edit("Water plants 🔁 every week 📅 2026-08-01", "Water plants", "2026-08-08", 2),
		"Water plants 🔁 every week 📅 2026-08-08");
	check("keeps scheduled and start dates",
		edit("Essay ⏳ 2026-08-02 🛫 2026-08-01 📅 2026-08-10", "Essay", "2026-08-12", 2),
		"Essay ⏳ 2026-08-02 🛫 2026-08-01 📅 2026-08-12");
	check("keeps the created date",
		edit("Thing ➕ 2026-07-01 📅 2026-08-01", "Thing", "2026-08-02", 2),
		"Thing ➕ 2026-07-01 📅 2026-08-02");

	// A file written in one dialect must not be converted to the other.
	check("keeps the Dataview dialect",
		edit("Notes [due:: 2026-08-01] [priority:: high]", "Notes", "2026-09-01", 4),
		"Notes [priority:: high] [due:: 2026-09-01]");
	check("keeps the emoji dialect",
		edit("Notes 📅 2026-08-01 ⏫", "Notes", "2026-09-01", 4),
		"Notes ⏫ 📅 2026-09-01");

	check("tags in the text survive",
		edit("Revise #maths #exam 📅 2026-08-01", "Revise #maths #exam", "2026-08-05", 2),
		"Revise #maths #exam 📅 2026-08-05");

	check("dayNumToInput round-trips", dayNumToInput(parseDate("2026-11-21")), "2026-11-21");
	check("dayNumToInput handles no date", dayNumToInput(undefined), "");

	// Whatever the editor writes, the parser must read back.
	const rewritten = edit("Old text 🔁 every week 📅 2026-08-01 🔽", "New text", "2026-12-24", 5);
	const reparsed = parse(`- [ ] ${rewritten}`);
	check("reparsed text", reparsed.text, "New text");
	check("reparsed due", reparsed.due, parseDate("2026-12-24"));
	check("reparsed priority", reparsed.priority, 5);
	check("reparsed recurrence", reparsed.recurrence, "every week");

	// Estimate is a dialog-owned field, so it is set or cleared directly —
	// unlike recurrence above, it is never blindly carried across.
	check("sets an estimate that was not there",
		edit("Read chapter 5 📅 2026-08-01", "Read chapter 5", "2026-08-01", 2, "3"),
		"Read chapter 5 📅 2026-08-01 ⏱️ 3h");
	check("changes an existing estimate",
		edit("Lab report ⏱️ 2h", "Lab report", "", 2, "5"),
		"Lab report ⏱️ 5h");
	check("clearing the estimate removes the token",
		edit("Lab report ⏱️ 2h", "Lab report", "", 2, ""),
		"Lab report");
	check("keeps the Dataview dialect for estimate",
		edit("Notes [due:: 2026-08-01] [estimate:: 2]", "Notes", "2026-08-01", 2, "3"),
		"Notes [due:: 2026-08-01] [estimate:: 3]");
	// The dialect can be signalled by the estimate field alone, with no due or
	// priority present to detect it from.
	check("detects the Dataview dialect from estimate alone",
		edit("Notes [estimate:: 2]", "Notes", "", 2, "3"),
		"Notes [estimate:: 3]");
}

// ---------------------------------------------------------------- capacity

console.log("\nCapacity");
{
	const T = today();
	const withEstimate = (hours: number | undefined): CleanViewTask =>
		({ ...parse("- [ ] X"), estimate: hours });

	{
		// A week away, an 8-hour day committed to fixed things (16h/day free),
		// 20 hours of estimated work against 7 × 16 = 112 available.
		const rows = [withEstimate(12), withEstimate(8)];
		const r = computeCapacity(T, T + 7, { sleep: 8 }, rows);
		check("daysLeft", r.daysLeft, 7);
		check("hoursPerDay", r.hoursPerDay, 16);
		check("availableHours", r.availableHours, 112);
		check("estimatedHours", r.estimatedHours, 20);
		check("unestimatedCount", r.unestimatedCount, 0);
		check("percent", Math.round(r.percent * 100) / 100, Math.round((20 / 112) * 10000) / 100);
	}

	// No budget at all means the whole day is free.
	check("zero budget gives 24 hours a day", computeCapacity(T, T + 1, {}, []).hoursPerDay, 24);

	// A budget summing past 24 hours cannot leave negative capacity.
	check(
		"an over-committed budget clamps to zero, not negative",
		computeCapacity(T, T + 1, { sleep: 10, transport: 6, meals: 4, social: 6, leisure: 4 }, []).hoursPerDay,
		0,
	);

	// A deadline that has already passed is zero days, not a negative count
	// that would otherwise flip the whole calculation's sign.
	check("a past deadline gives zero days left, not negative", computeCapacity(T, T - 5, {}, []).daysLeft, 0);

	// Zero available hours with no estimated work is "nothing to do, nothing to
	// do it in" — 0%, not a NaN from 0/0.
	check("zero available and zero estimated is 0%, not NaN", computeCapacity(T, T, {}, []).percent, 0);

	// Zero available hours with real estimated work is a genuine impossibility,
	// not a divide-by-zero accident — Infinity is the honest answer.
	check(
		"zero available hours with real work is Infinity, not NaN",
		computeCapacity(T, T, {}, [withEstimate(5)]).percent,
		Infinity,
	);

	// Tasks with no estimate are counted separately, never treated as zero cost.
	{
		const rows = [withEstimate(4), withEstimate(undefined), withEstimate(undefined)];
		const r = computeCapacity(T, T + 10, { sleep: 8 }, rows);
		check("unestimated tasks are counted, not folded into the total", r.unestimatedCount, 2);
		check("unestimated tasks contribute nothing to the hour total", r.estimatedHours, 4);
	}

	check("normalizeBudget keeps finite numbers", normalizeBudget({ sleep: 8, transport: "3" }), { sleep: 8, transport: 3 });
	check("normalizeBudget drops non-numeric values", normalizeBudget({ sleep: 8, note: "not a number" }), { sleep: 8 });
	check("normalizeBudget handles a missing budget", normalizeBudget(undefined), {});
	check("normalizeBudget rejects a non-object", normalizeBudget("nope"), {});
}

// -------------------------------------------------------------- board

console.log("\nBoard");
{
	const T = today();
	const withDue = (due: number | undefined): CleanViewTask => ({ ...parse("- [ ] X"), due });

	// Boundaries: yesterday, today, the edges of each week, and just past them.
	check("due yesterday -> overdue", COLUMNS.find((c) => c.matches(T - 1, T))?.id, "overdue");
	check("due today -> this week", COLUMNS.find((c) => c.matches(T, T))?.id, "this-week");
	check("due in 6 days -> this week", COLUMNS.find((c) => c.matches(T + 6, T))?.id, "this-week");
	check("due in 7 days -> next week", COLUMNS.find((c) => c.matches(T + 7, T))?.id, "next-week");
	check("due in 13 days -> next week", COLUMNS.find((c) => c.matches(T + 13, T))?.id, "next-week");
	check("due in 14 days -> later", COLUMNS.find((c) => c.matches(T + 14, T))?.id, "later");
	check("due in 90 days -> later", COLUMNS.find((c) => c.matches(T + 90, T))?.id, "later");
	check("no due date -> no-date", COLUMNS.find((c) => c.matches(undefined, T))?.id, "no-date");

	// dropDue per column, including the clearing case.
	check("dropDue overdue", columnById("overdue").dropDue(T), T - 1);
	check("dropDue this-week", columnById("this-week").dropDue(T), T);
	check("dropDue next-week", columnById("next-week").dropDue(T), T + 7);
	check("dropDue later", columnById("later").dropDue(T), T + 14);
	check("dropDue no-date clears the date", columnById("no-date").dropDue(T), undefined);

	// Every row lands in exactly one bucket — none silently dropped, none
	// double-counted.
	const rows = [withDue(T - 3), withDue(T), withDue(T + 6), withDue(T + 7), withDue(T + 20), withDue(undefined)];
	const buckets = bucketRows(rows, T);
	check("all five columns are present, even when empty", [...buckets.keys()].length, 5);
	const total = [...buckets.values()].reduce((sum, r) => sum + r.length, 0);
	check("every row lands in exactly one column", total, rows.length);
	check("overdue bucket", buckets.get("overdue")?.length, 1);
	check("this-week bucket", buckets.get("this-week")?.length, 2);
	check("next-week bucket", buckets.get("next-week")?.length, 1);
	check("later bucket", buckets.get("later")?.length, 1);
	check("no-date bucket", buckets.get("no-date")?.length, 1);
}

// ------------------------------------------------------------- benchmark

console.log("\nPerformance");
{
	const SIZE = 20_000;
	const lines: string[] = [];
	for (let i = 0; i < SIZE; i++) {
		const due = formatISO(T - 200 + (i % 400));
		const prio = ["🔺", "⏫", "🔼", "", "🔽"][i % 5];
		const state = i % 3 === 0 ? "x" : " ";
		lines.push(`- [${state}] Task number ${i} 📅 ${due} ${prio} #topic${i % 20}`);
	}

	const parseStart = performance.now();
	const big: CleanViewTask[] = [];
	for (let i = 0; i < SIZE; i++) {
		const status = i % 3 === 0 ? "x" : " ";
		const t = parseTaskLine(lines[i], listItem(i, status), `School/Subject${i % 50}.md`, `Subject${i % 50}`, `School/Subject${i % 50}`);
		if (t) big.push(t);
	}
	const parseMs = performance.now() - parseStart;
	check("all parsed", big.length, SIZE);
	console.log(`  parse:  ${SIZE} tasks in ${parseMs.toFixed(0)} ms  (${(parseMs / SIZE * 1000).toFixed(1)} µs/task)`);

	const predicate = compileFilter({ done: false, due: { to: "today" } }, "tasks")!;
	const sorter = compileSort(["priority desc", "due asc"], "tasks")!;

	// Warm up, then measure the steady-state cost of one dashboard refresh.
	for (let i = 0; i < 3; i++) big.filter((t) => predicate(t as Row));

	const queryStart = performance.now();
	const ROUNDS = 20;
	let lastCount = 0;
	for (let round = 0; round < ROUNDS; round++) {
		const hits = big.filter((t) => predicate(t as Row));
		hits.sort((a, b) => sorter(a as Row, b as Row));
		lastCount = hits.length;
	}
	const queryMs = (performance.now() - queryStart) / ROUNDS;
	console.log(`  query:  ${lastCount} of ${SIZE} matched + sorted in ${queryMs.toFixed(2)} ms`);
	ok("one query stays under 16 ms (a single frame)", queryMs < 16);
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
