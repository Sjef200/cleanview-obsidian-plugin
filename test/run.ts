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
