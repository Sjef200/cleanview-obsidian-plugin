/**
 * Browser harness: renders the three chart forms with realistic data so they
 * can be looked at, in both light and dark, at several widths.
 */
import { installObsidianShim } from "./obsidian-shim";
installObsidianShim();

import { renderBar, renderDonut, renderLine, type Datum } from "../src/charts/charts";
import { Tooltip, onWidth } from "../src/charts/svg";
import { renderCountdown } from "../src/views/countdown-view";
import { today } from "../src/core/dates";

const format = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1));
const tooltip = new Tooltip();

const byFolder: Datum[] = [
	{ label: "School/Mathematics", value: 23 },
	{ label: "School/History", value: 17 },
	{ label: "School/Norwegian", value: 12 },
	{ label: "Projects", value: 8 },
	{ label: "Sources", value: 5 },
	{ label: "Log", value: 2 },
];

const overTime: Datum[] = Array.from({ length: 28 }, (_, i) => ({
	label: `07-${String(i + 1).padStart(2, "0")}`,
	value: Math.round(12 + 10 * Math.sin(i / 3) + (i % 5) * 2),
	sortKey: i,
}));

const byPriority: Datum[] = [
	{ label: "Highest", value: 4 },
	{ label: "High", value: 11 },
	{ label: "Normal", value: 28 },
	{ label: "Low", value: 7 },
	{ label: "Lowest", value: 3 },
];

/**
 * Renders through `onWidth`, exactly as the plugin does, so the chart sizes
 * itself from its container instead of a width hardcoded here. Without this the
 * harness never exercises the responsive path at all.
 */
function mount(id: string, kind: string, data: Datum[], title?: string) {
	const host = document.getElementById(id);
	if (!host) return;
	onWidth(host, (width) => {
		host.querySelector("svg")?.remove();
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("class", "cleanview-svg");
		host.insertBefore(svg, host.firstChild);
		if (kind === "bar") renderBar(host, svg, data, width, tooltip, format);
		else if (kind === "line") renderLine(host, svg, data, width, tooltip, format);
		else renderDonut(host, svg, data, width, tooltip, format, title);
	});
}

for (const theme of ["light", "dark"]) {
	mount(`${theme}-bar`, "bar", byFolder);
	mount(`${theme}-line`, "line", overTime);
	mount(`${theme}-donut`, "donut", byPriority, "tasks");
	mount(`${theme}-narrow`, "bar", byFolder);
}

// --- countdown cards, exercising the real view code -----------------------

const day = 86_400_000;
function goal(name: string, daysOut: number, taskCount = 0, openTaskCount = 0) {
	const deadline = new Date((today() + daysOut) * day);
	return {
		path: `Goals/${name}.md`, name, folder: "Goals",
		mtime: Date.now(), ctime: Date.now(), size: 0,
		frontmatter: {
			type: "goal",
			due: deadline,
			started: new Date((today() - 40) * day),
		},
		tags: [], taskCount, openTaskCount,
	};
}

const goals = [
	goal("Exam", 119, 7, 3),
	goal("Essay", 101, 5, 5),
	goal("Chapter test", 9),
	goal("History submission", 0),
	goal("Group project", -4),
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
		{ view: "countdown", source: "files", date: "due", start: "started" } as never,
		ctx,
	);
}

// --- phone column: a fixed 390px viewport, independent of the pane ---------

const phone = document.getElementById("phone-body");
if (phone) {
	for (const [id, kind, data, title] of [
		["phone-bar", "bar", byFolder, undefined],
		["phone-line", "line", overTime, undefined],
		["phone-donut", "donut", byPriority, "tasks"],
	] as Array<[string, string, Datum[], string | undefined]>) {
		const wrap = phone.createDiv({ cls: "cleanview-block" });
		wrap.createEl("h4", { text: id.replace("phone-", "") });
		const holder = wrap.createDiv({ cls: "cleanview-chart" });
		holder.id = id;
		mount(id, kind, data, title);
	}
	const cdHost = phone.createDiv({ cls: "cleanview-block" });
	renderCountdown(
		cdHost,
		{ rows: goals as never, groups: null, total: goals.length },
		{ view: "countdown", source: "files", date: "due", start: "started" } as never,
		ctx,
	);
}
