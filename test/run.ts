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
import type { PulsTask } from "../src/core/types";
import type { Row } from "../src/query/fields";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
	const a = JSON.stringify(actual);
	const b = JSON.stringify(expected);
	if (a === b) {
		passed++;
	} else {
		failed++;
		console.log(`  FAIL  ${name}\n          fikk:      ${a}\n          forventet: ${b}`);
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

function parse(line: string, lineNo = 0): PulsTask {
	const status = /\[(.)\]/.exec(line)?.[1] ?? " ";
	const task = parseTaskLine(line, listItem(lineNo, status), "Skole/Matte.md", "Matte", "Skole");
	if (!task) throw new Error(`kunne ikke parse: ${line}`);
	return task;
}

// ---------------------------------------------------------------- dates

console.log("\nDatoer");
check("parseDate gyldig", parseDate("2026-07-11"), Date.UTC(2026, 6, 11) / 86_400_000);
check("parseDate avviser 31. februar", parseDate("2026-02-31"), undefined);
check("parseDate avviser tull", parseDate("i går"), undefined);
check("formatISO er invers", formatISO(parseDate("2026-03-01")!), "2026-03-01");

const base = parseDate("2026-07-11")!;
check("today+7d", resolveDateExpr("today+7d", base), base + 7);
check("today-2w", resolveDateExpr("today-2w", base), base - 14);
check("norsk 'i dag'", resolveDateExpr("i dag", base), base);
check("norsk 'i morgen'", resolveDateExpr("i morgen", base), base + 1);
check("mellomrom tolereres", resolveDateExpr("today + 7d", base), base + 7);
check("månedshopp krysser årsskifte", formatISO(resolveDateExpr("2026-11-30+2m", base)!), "2027-01-30");
check("absolutt dato", resolveDateExpr("2026-01-05", base), parseDate("2026-01-05"));
check("ugyldig uttrykk", resolveDateExpr("neste tirsdag", base), undefined);

// ------------------------------------------------------------ task parsing

console.log("\nOppgaveparsing (Tasks-dialekt)");
{
	const t = parse("- [ ] Les kapittel 5 📅 2026-07-14 ⏫ #skole");
	check("tekst renset", t.text, "Les kapittel 5 #skole");
	check("frist", t.due, parseDate("2026-07-14"));
	check("prioritet høy", t.priority, 4);
	check("tagg", t.tags, ["skole"]);
	check("ikke fullført", t.done, false);
}
{
	const t = parse("- [x] Innlevering ✅ 2026-07-10 📅 2026-07-09");
	check("fullført", t.done, true);
	check("fullførtdato", t.completedOn, parseDate("2026-07-10"));
	check("frist beholdes", t.due, parseDate("2026-07-09"));
	check("tekst uten metadata", t.text, "Innlevering");
}
{
	const t = parse("    - [ ] Underoppgave 🔁 every week 🔺");
	check("gjentakelse", t.recurrence, "every week");
	check("prioritet høyest", t.priority, 5);
	check("dybde fra innrykk", t.depth, 2);
}

console.log("\nOppgaveparsing (Dataview-dialekt)");
{
	const t = parse("- [ ] Skriv notat [due:: 2026-08-01] [priority:: high]");
	check("inline frist", t.due, parseDate("2026-08-01"));
	check("inline prioritet", t.priority, 4);
	check("tekst renset", t.text, "Skriv notat");
}
{
	const t = parse("- [ ] Møte (frist:: 2026-09-15) med (sted:: skolen)");
	check("norsk feltnavn frist", t.due, parseDate("2026-09-15"));
	ok("ukjent felt beholdes i teksten", t.text.includes("sted:: skolen"));
}
{
	const t = parse("- [/] Påbegynt oppgave");
	check("egendefinert status regnes som gjort", t.done, true);
	check("statustegn bevart", t.status, "/");
}
{
	const t = parse("- [ ] Ren oppgave uten noe");
	check("ingen frist", t.due, undefined);
	check("standardprioritet", t.priority, 2);
}

// -------------------------------------------------- the actual dashboard

console.log("\nDashbordspørringene dine");

const T = today();
const tasks: PulsTask[] = [
	parse("- [ ] Forfalt lekse 📅 " + formatISO(T - 3) + " ⏫"),
	parse("- [ ] Innlevering i dag 📅 " + formatISO(T)),
	parse("- [ ] Prøve om 3 dager 📅 " + formatISO(T + 3) + " 🔺"),
	parse("- [ ] Om 10 dager 📅 " + formatISO(T + 10)),
	parse("- [ ] Uten frist"),
	parse("- [x] Ferdig 📅 " + formatISO(T - 1)),
];

// "Dagens oppgaver": !completed AND (due = today OR due < today)
{
	const predicate = compileFilter({ done: false, due: { to: "today" } }, "tasks")!;
	const hits = tasks.filter((t) => predicate(t as Row));
	check("dagens oppgaver: antall", hits.length, 2);
	ok("utelater fullført", !hits.some((t) => t.done));
	ok("utelater fremtidige", !hits.some((t) => (t.due ?? 0) > T));
	ok("utelater uten frist", !hits.some((t) => t.due === undefined));

	const sorter = compileSort(["priority desc", "due asc"], "tasks")!;
	hits.sort((a, b) => sorter(a as Row, b as Row));
	check("sortert: prioritet først", hits[0].text, "Forfalt lekse");
}

// "Alle åpne oppgaver"
{
	const predicate = compileFilter({ done: false }, "tasks")!;
	check("alle åpne", tasks.filter((t) => predicate(t as Row)).length, 5);
}

// "Neste 7 dager": due >= today AND due <= today + 7d
{
	const predicate = compileFilter({ done: false, due: { from: "today", to: "today+7d" } }, "tasks")!;
	const hits = tasks.filter((t) => predicate(t as Row));
	check("neste 7 dager: antall", hits.length, 2);
	ok("dag 10 utelatt", !hits.some((t) => t.text.includes("10 dager")));
}

// Overdue keyword
{
	const predicate = compileFilter({ done: false, due: "overdue" }, "tasks")!;
	const hits = tasks.filter((t) => predicate(t as Row));
	check("forfalt", hits.map((t) => t.text), ["Forfalt lekse"]);
}

console.log("\nAggregater");
{
	const count = compileAggregator("count", "tasks");
	check("count", count(tasks as Row[]), 6);
	const maxDue = compileAggregator("max:due", "tasks");
	check("max:due", maxDue(tasks as Row[]), T + 10);
	const distinct = compileAggregator("distinct:priority", "tasks");
	check("distinct:priority", distinct(tasks as Row[]), 3);
}

// ---------------------------------------------------------------- sorting

console.log("\nSortering");
{
	const sorter = compileSort("due asc", "tasks")!;
	const sorted = [...tasks].sort((a, b) => sorter(a as Row, b as Row));
	check("uten frist havner sist", sorted[sorted.length - 1].text, "Uten frist");

	const desc = compileSort("due desc", "tasks")!;
	const sortedDesc = [...tasks].sort((a, b) => desc(a as Row, b as Row));
	check("uten frist havner sist også synkende", sortedDesc[sortedDesc.length - 1].text, "Uten frist");
}

// --------------------------------------------- goals & frontmatter dates

console.log("\nMål og frontmatter-datoer");
{
	// Obsidian's YAML parser turns an unquoted `frist: 2026-11-21` into a Date,
	// but a quoted one stays a string. Both must behave identically.
	const asDate = new Date(Date.UTC(2026, 10, 21));
	check("Date-objekt", coerceDayNum(asDate), parseDate("2026-11-21"));
	check("ISO-streng", coerceDayNum("2026-11-21"), parseDate("2026-11-21"));
	check("dagnummer passerer gjennom", coerceDayNum(20279), 20279);
	check("tomt felt", coerceDayNum(undefined), undefined);
	check("ugyldig Date", coerceDayNum(new Date("tull")), undefined);

	const goals = [
		{ path: "Mål/Eksamen.md", name: "Eksamen R2", folder: "Mål", mtime: 0, ctime: 0, size: 0,
			frontmatter: { type: "mål", frist: new Date(Date.UTC(2026, 10, 21)) }, tags: [], taskCount: 5, openTaskCount: 2 },
		{ path: "Mål/Innlevering.md", name: "Særemne", folder: "Mål", mtime: 0, ctime: 0, size: 0,
			frontmatter: { type: "mål", frist: new Date(Date.UTC(2026, 10, 3)) }, tags: [], taskCount: 0, openTaskCount: 0 },
		{ path: "Mål/Fjern.md", name: "Fagbrev", folder: "Mål", mtime: 0, ctime: 0, size: 0,
			frontmatter: { type: "mål", frist: new Date(Date.UTC(2027, 4, 1)) }, tags: [], taskCount: 0, openTaskCount: 0 },
		{ path: "Mål/Utenfrist.md", name: "Uten frist", folder: "Mål", mtime: 0, ctime: 0, size: 0,
			frontmatter: { type: "mål" }, tags: [], taskCount: 0, openTaskCount: 0 },
	] as unknown as Row[];

	// Chronological, not alphabetical by weekday name.
	const byDeadline = compileSort("frist asc", "files")!;
	const sorted = [...goals].sort(byDeadline);
	check(
		"frontmatter-datoer sorterer kronologisk",
		sorted.map((g) => (g as { name: string }).name),
		["Særemne", "Eksamen R2", "Fagbrev", "Uten frist"],
	);

	// A date expression against a frontmatter field whose name we cannot know
	// at compile time.
	const inNovember = compileFilter(
		{ type: "mål", frist: { from: "2026-11-01", to: "2026-11-30" } },
		"files",
	)!;
	check(
		"intervall på frontmatter-dato",
		goals.filter((g) => inNovember(g)).map((g) => (g as { name: string }).name),
		["Eksamen R2", "Særemne"],
	);

	const overdue = compileFilter({ frist: "overdue" }, "files")!;
	check("forfalt-nøkkelord på frontmatter", goals.filter((g) => overdue(g)).length, 0);

	// A plain string field must not be hijacked by the date machinery.
	const notADate = compileFilter({ type: "mål" }, "files")!;
	check("tekstfelt uberørt", goals.filter((g) => notADate(g)).length, 4);
}

// ------------------------------------------------------------- benchmark

console.log("\nYtelse");
{
	const SIZE = 20_000;
	const lines: string[] = [];
	for (let i = 0; i < SIZE; i++) {
		const due = formatISO(T - 200 + (i % 400));
		const prio = ["🔺", "⏫", "🔼", "", "🔽"][i % 5];
		const state = i % 3 === 0 ? "x" : " ";
		lines.push(`- [${state}] Oppgave nummer ${i} 📅 ${due} ${prio} #emne${i % 20}`);
	}

	const parseStart = performance.now();
	const big: PulsTask[] = [];
	for (let i = 0; i < SIZE; i++) {
		const status = i % 3 === 0 ? "x" : " ";
		const t = parseTaskLine(lines[i], listItem(i, status), `Skole/Fag${i % 50}.md`, `Fag${i % 50}`, `Skole/Fag${i % 50}`);
		if (t) big.push(t);
	}
	const parseMs = performance.now() - parseStart;
	check("alle ble parset", big.length, SIZE);
	console.log(`  parsing:  ${SIZE} oppgaver på ${parseMs.toFixed(0)} ms  (${(parseMs / SIZE * 1000).toFixed(1)} µs/oppgave)`);

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
	console.log(`  spørring: ${lastCount} treff av ${SIZE} + sortering på ${queryMs.toFixed(2)} ms`);
	ok("en spørring holder seg under 16 ms (én skjermoppdatering)", queryMs < 16);
}

console.log(`\n${passed} bestått, ${failed} feilet\n`);
process.exit(failed === 0 ? 0 : 1);
