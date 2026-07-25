/**
 * Browser harness: renders the three chart forms with realistic data so they
 * can be looked at, in both light and dark, at several widths.
 */
import { installObsidianShim } from "./obsidian-shim";
installObsidianShim();

import { renderBar, renderDonut, renderLine, type Datum } from "../src/charts/charts";
import { Tooltip } from "../src/charts/svg";
import { renderCountdown } from "../src/views/countdown-view";
import { today } from "../src/core/dates";

const format = (n: number) => (Number.isInteger(n) ? n.toLocaleString("nb-NO") : n.toFixed(1));
const tooltip = new Tooltip();

const byFolder: Datum[] = [
	{ label: "Skole/Matematikk R2", value: 23 },
	{ label: "Skole/Historie", value: 17 },
	{ label: "Skole/Norsk", value: 12 },
	{ label: "Prosjekter", value: 8 },
	{ label: "Kilder", value: 5 },
	{ label: "Logg", value: 2 },
];

const overTime: Datum[] = Array.from({ length: 28 }, (_, i) => ({
	label: `07-${String(i + 1).padStart(2, "0")}`,
	value: Math.round(12 + 10 * Math.sin(i / 3) + (i % 5) * 2),
	sortKey: i,
}));

const byPriority: Datum[] = [
	{ label: "Høyest", value: 4 },
	{ label: "Høy", value: 11 },
	{ label: "Normal", value: 28 },
	{ label: "Lav", value: 7 },
	{ label: "Lavest", value: 3 },
];

function mount(id: string, kind: string, data: Datum[], width: number, title?: string) {
	const host = document.getElementById(id);
	if (!host) return;
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("class", "puls-svg");
	host.appendChild(svg);
	if (kind === "bar") renderBar(host, svg, data, width, tooltip, format);
	else if (kind === "line") renderLine(host, svg, data, width, tooltip, format);
	else renderDonut(host, svg, data, width, tooltip, format, title);
}

for (const theme of ["light", "dark"]) {
	mount(`${theme}-bar`, "bar", byFolder, 420);
	mount(`${theme}-line`, "line", overTime, 460);
	mount(`${theme}-donut`, "donut", byPriority, 420, "oppgaver");
	// Narrow column, to check label fitting and overflow.
	mount(`${theme}-narrow`, "bar", byFolder, 260);
}

// --- countdown cards, exercising the real view code -----------------------

const day = 86_400_000;
function goal(name: string, daysOut: number, taskCount = 0, openTaskCount = 0) {
	const deadline = new Date((today() + daysOut) * day);
	return {
		path: `Mål/${name}.md`, name, folder: "Mål",
		mtime: Date.now(), ctime: Date.now(), size: 0,
		frontmatter: {
			type: "mål",
			frist: deadline,
			startet: new Date((today() - 40) * day),
		},
		tags: [], taskCount, openTaskCount,
	};
}

const goals = [
	goal("Eksamen R2", 119, 7, 3),
	goal("Særemne norsk", 101, 5, 5),
	goal("Kapittelprøve", 9),
	goal("Innlevering historie", 0),
	goal("Gruppeoppgave", -4),
];

const ctx = {
	app: { vault: { getFileByPath: () => null }, workspace: { getLeaf: () => ({ openFile: () => {} }) } },
	component: {},
	sourcePath: "preview",
} as never;

for (const theme of ["light", "dark"]) {
	const host = document.getElementById(`${theme}-countdown`);
	if (!host) continue;
	renderCountdown(
		host,
		{ rows: goals as never, groups: null, total: goals.length },
		{ view: "countdown", source: "files", date: "frist", start: "startet" } as never,
		ctx,
	);
}
