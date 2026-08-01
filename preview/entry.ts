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

// --- every remaining view, built from the real render functions ------------

import { renderTasks } from "../src/views/task-view";
import { renderTable } from "../src/views/table-view";
import { renderStat } from "../src/views/stat-view";
import { renderText } from "../src/views/text-view";
import { parseTaskLine } from "../src/core/task-parser";
import { formatISO, today } from "../src/core/dates";
import { compileSort } from "../src/query/sort";
import { groupRows } from "../src/query/sort";

const T = today();

function task(line: string, file: string, folder: string, n: number) {
	const status = /\[(.)\]/.exec(line)?.[1] ?? " ";
	return parseTaskLine(
		line,
		{ position: { start: { line: n, col: 0, offset: 0 }, end: { line: n, col: 0, offset: 0 } }, parent: -1, task: status } as never,
		`${folder}/${file}.md`, file, folder,
	)!;
}

const demoTasks = [
	task(`- [ ] Integration by parts 📅 ${formatISO(T - 2)} ⏫ ⏱️ 3h #maths`, "Mathematics", "School", 1),
	task(`- [ ] Read Hobsbawm, chapters 4-6 📅 ${formatISO(T)} 🔺 ⏱️ 2h`, "History", "School", 2),
	task(`- [ ] Find three primary sources 📅 ${formatISO(T + 3)} ⏱️ 1,5h`, "History", "School", 3),
	task(`- [ ] Spectroscopy report 📅 ${formatISO(T + 5)} ⏫`, "Lab work", "School", 4),
	task(`- [ ] Grammar exercises 🔁 every week 📅 ${formatISO(T + 8)} 🔽`, "Norwegian", "School", 5),
	task(`- [ ] Presentation notes [due:: ${formatISO(T + 9)}] [priority:: high] [estimate:: 4]`, "Norwegian", "School", 6),
	task(`- [x] Titration write-up ✅ ${formatISO(T - 1)}`, "Lab work", "School", 7),
	task(`- [ ] Book the lab`, "Lab work", "School", 8),
];

const demoFiles = [
	{ path: "School/Mathematics.md", name: "Mathematics", folder: "School", mtime: Date.now() - 6e5,
	  ctime: 0, size: 0, frontmatter: { status: "in progress" }, tags: ["maths"], taskCount: 7, openTaskCount: 5 },
	{ path: "School/History.md", name: "History", folder: "School", mtime: Date.now() - 864e5,
	  ctime: 0, size: 0, frontmatter: { status: "drafting" }, tags: [], taskCount: 5, openTaskCount: 4 },
	{ path: "School/Norwegian.md", name: "Norwegian", folder: "School", mtime: Date.now() - 3 * 864e5,
	  ctime: 0, size: 0, frontmatter: { status: "reading" }, tags: [], taskCount: 3, openTaskCount: 3 },
	{ path: "School/Lab work.md", name: "Lab work", folder: "School", mtime: Date.now() - 7 * 864e5,
	  ctime: 0, size: 0, frontmatter: { status: "waiting" }, tags: [], taskCount: 3, openTaskCount: 2 },
];

const fakeIndex = { stats: () => ({ files: 26, tasks: 18, openTasks: 14 }) } as never;
const priorityOrder = compileSort(["priority desc", "due asc"], "tasks")!;

function mountViews(prefix: string) {
	const put = (id: string, fn: (el: HTMLElement) => void) => {
		const host = document.getElementById(`${prefix}-${id}`);
		if (host) fn(host);
	};

	put("text", (el) =>
		renderText(el, { format: "{date} · week {week} · {open} open tasks in {notes} notes" }, fakeIndex));

	put("tasks", (el) => {
		const rows = [...demoTasks].filter((t) => !t.done).sort(priorityOrder);
		renderTasks(el, { rows: rows as never, groups: null, total: rows.length },
			{ view: "tasks", source: "tasks", title: "Open tasks", show: ["due", "priority", "estimate", "file"] } as never, ctx);
	});

	put("grouped", (el) => {
		const rows = demoTasks.filter((t) => !t.done) as never[];
		renderTasks(el, { rows, groups: groupRows(rows, "file", "tasks"), total: rows.length },
			{ view: "tasks", source: "tasks", title: "Grouped by note", group: "file" } as never, ctx);
	});

	put("table", (el) =>
		renderTable(el, { rows: demoFiles as never, groups: null, total: demoFiles.length },
			{ view: "table", source: "files", title: "Notes",
			  columns: [
				{ field: "name", label: "Note", link: true },
				{ field: "status", label: "Status" },
				{ field: "openTasks", label: "Open", format: "number" },
				{ field: "mtimeMs", label: "Edited", format: "relative-ms" },
			  ] } as never, ctx));

	put("stat", (el) => {
		renderStat(el, { rows: demoTasks.filter((t) => !t.done) as never, groups: null, total: 7 },
			{ view: "stat", source: "tasks", title: "Open tasks", value: "count" } as never);
		renderStat(el, { rows: demoTasks.filter((t) => t.done) as never, groups: null, total: 1 },
			{ view: "stat", source: "tasks", title: "Done this week", value: "count", goal: 5 } as never);
	});
}

for (const theme of ["light", "dark"]) mountViews(theme);

// --- minimal styling for the Modal/Setting stubs above -----------------
const previewModalCss = document.createElement("style");
previewModalCss.textContent = `
.cleanview-preview-modal-overlay {
	position: fixed; inset: 0; background: rgba(0,0,0,.5);
	display: flex; align-items: center; justify-content: center; z-index: 1000;
}
.cleanview-preview-modal-box {
	background: var(--background-primary, #fff); color: var(--text-normal, #222);
	border-radius: 8px; padding: 20px; min-width: 320px; max-width: 90vw;
	box-shadow: 0 8px 30px rgba(0,0,0,.3); font-family: system-ui, sans-serif;
}
.cleanview-preview-modal-title { font-weight: 600; font-size: 16px; margin-bottom: 12px; }
.cleanview-preview-setting { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 8px 0; }
.cleanview-preview-setting-name { font-weight: 500; }
.cleanview-preview-setting-desc { font-size: 12px; opacity: .7; }
.cleanview-preview-setting-control input, .cleanview-preview-setting-control select { padding: 4px 6px; }
.cleanview-preview-setting-control button { padding: 4px 10px; margin-left: 6px; cursor: pointer; }
.cleanview-preview-setting-control button.mod-cta { background: #4a7dfc; color: #fff; border: none; border-radius: 4px; }
`;
document.head.appendChild(previewModalCss);
