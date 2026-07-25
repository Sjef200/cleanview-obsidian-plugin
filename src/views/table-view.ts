/**
 * Table view over notes or tasks.
 *
 * Columns are declared, not computed by an expression language:
 *
 *   columns:
 *     - { field: name, label: Note, link: true }
 *     - { field: mtime, label: Modified, format: relative }
 *     - { field: page, format: progress, max: totalPages }
 */

import type { CleanViewFile } from "../core/types";
import { formatISO, formatRelativeMs, formatRelativeDay } from "../core/dates";
import type { BlockConfig, QueryResult } from "../query/query";
import { type Row, accessor } from "../query/fields";
import type { ViewContext } from "./task-view";
import { emptyState, openFileAt, renderCapped, renderInline, sectionHeader, truncated } from "./render-utils";

const DEFAULT_CAP = 100;

interface Column {
	label: string;
	get: (row: Row) => unknown;
	format: string;
	link: boolean;
	max?: (row: Row) => unknown;
	align: string;
}

export function renderTable(
	container: HTMLElement,
	result: QueryResult,
	config: BlockConfig,
	ctx: ViewContext,
): void {
	sectionHeader(container, config.title);

	if (result.rows.length === 0) {
		emptyState(container, "No matches.");
		return;
	}

	const columns = buildColumns(config);
	const wrapper = container.createDiv({ cls: "cleanview-table-wrap" });
	const table = wrapper.createEl("table", { cls: "cleanview-table" });

	const headRow = table.createEl("thead").createEl("tr");
	for (const column of columns) {
		const th = headRow.createEl("th", { text: column.label });
		if (column.align !== "left") th.addClass(`cleanview-align-${column.align}`);
	}

	const body = table.createEl("tbody");
	const cap = config.limit ?? DEFAULT_CAP;

	renderCapped(body, result.rows, cap, (row, parent) => {
		const tr = parent.createEl("tr");
		for (const column of columns) renderCell(tr, row, column, ctx);
	});

	const note = truncated(result.total, Math.min(result.rows.length, cap));
	if (note) container.createDiv({ cls: "cleanview-footnote", text: note });
}

function buildColumns(config: BlockConfig): Column[] {
	const source = config.source;
	const raw = config.columns;

	if (!Array.isArray(raw) || raw.length === 0) {
		// Sensible default: identify the row and show when it changed.
		return source === "files"
			? [
					{ label: "Note", get: accessor(source, "name"), format: "text", link: true, align: "left" },
					{ label: "Folder", get: accessor(source, "folder"), format: "text", link: false, align: "left" },
					{ label: "Modified", get: accessor(source, "mtimeMs"), format: "relative-ms", link: false, align: "right" },
				]
			: [
					{ label: "Task", get: accessor(source, "text"), format: "markdown", link: false, align: "left" },
					{ label: "Due", get: accessor(source, "due"), format: "relative", link: false, align: "right" },
					{ label: "Note", get: accessor(source, "file"), format: "text", link: true, align: "left" },
				];
	}

	return raw.map((entry): Column => {
		if (typeof entry === "string") {
			const [field, label] = entry.split(/\s+as\s+/i);
			return {
				label: label?.trim() ?? prettify(field),
				get: accessor(source, field.trim()),
				format: inferFormat(field.trim()),
				link: field.trim() === "name" || field.trim() === "file",
				align: "left",
			};
		}

		const spec = entry as Record<string, unknown>;
		const field = String(spec.field ?? "");
		const format = String(spec.format ?? spec.format ?? inferFormat(field));
		return {
			label: String(spec.label ?? prettify(field)),
			get: accessor(source, field),
			format,
			link: spec.link === true || (spec.link === undefined && (field === "name" || field === "file")),
			max: spec.max !== undefined ? accessor(source, String(spec.max)) : undefined,
			align: String(spec.align ?? (format === "number" || format === "relative" || format === "relative-ms" ? "right" : "left")),
		};
	});
}

function inferFormat(field: string): string {
	if (field === "mtimeMs" || field === "ctimeMs") return "relative-ms";
	if (["due", "scheduled", "start", "created", "completedOn", "mtime", "ctime", "modified"].includes(field)) {
		return "relative";
	}
	if (field === "done" || field === "completed") return "bool";
	if (field === "tags") return "tags";
	return "auto";
}

function prettify(field: string): string {
	const bare = field.replace(/^(file|fm)\./, "");
	return bare.charAt(0).toUpperCase() + bare.slice(1);
}

function renderCell(tr: HTMLElement, row: Row, column: Column, ctx: ViewContext): void {
	const td = tr.createEl("td");
	if (column.align !== "left") td.addClass(`cleanview-align-${column.align}`);

	const value = column.get(row);

	if (column.format === "progress") {
		renderProgress(td, value, column.max?.(row));
		return;
	}

	if (value === undefined || value === null || value === "") {
		td.createSpan({ cls: "cleanview-muted", text: "—" });
		return;
	}

	switch (column.format) {
		case "relative":
			if (typeof value === "number") {
				td.setAttr("title", formatISO(value));
				td.setText(formatRelativeDay(value));
			} else td.setText(String(value));
			return;
		case "relative-ms":
			if (typeof value === "number") td.setText(formatRelativeMs(value));
			else td.setText(String(value));
			return;
		case "date":
			td.setText(typeof value === "number" ? formatISO(value) : String(value));
			return;
		case "bool":
			td.setText(value ? "✓" : "—");
			return;
		case "tags":
			if (Array.isArray(value)) {
				for (const tag of value) td.createSpan({ cls: "cleanview-chip", text: `#${tag}` });
			} else td.setText(String(value));
			return;
		case "number":
			td.setText(typeof value === "number" ? formatNumber(value) : String(value));
			return;
		case "markdown":
			renderInline(ctx.app, ctx.component, td, String(value), ctx.sourcePath);
			return;
	}

	if (column.link) {
		const path = (row as CleanViewFile).path ?? (row as { path: string }).path;
		const link = td.createSpan({ cls: "cleanview-link", text: String(value) });
		link.setAttr("role", "link");
		link.setAttr("tabindex", "0");
		const open = (event: Event) => {
			event.preventDefault();
			openFileAt(ctx.app, path, (row as { line?: number }).line);
		};
		link.addEventListener("click", open);
		link.addEventListener("keydown", (event) => {
			if (event.key === "Enter") open(event);
		});
		return;
	}

	if (typeof value === "number") {
		td.setText(formatNumber(value));
		return;
	}

	// Frontmatter values are frequently [[links]], so render them as markdown.
	const text = Array.isArray(value) ? value.join(", ") : String(value);
	if (text.includes("[[")) renderInline(ctx.app, ctx.component, td, text, ctx.sourcePath);
	else td.setText(text);
}

function renderProgress(td: HTMLElement, value: unknown, max: unknown): void {
	const current = Number(value);
	const total = Number(max);
	if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
		td.createSpan({ cls: "cleanview-muted", text: "—" });
		return;
	}
	const percent = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
	const wrap = td.createDiv({ cls: "cleanview-progress" });
	const bar = wrap.createDiv({ cls: "cleanview-progress-bar" });
	bar.style.setProperty("--cleanview-progress", `${percent}%`);
	wrap.createSpan({ cls: "cleanview-progress-label", text: `${percent} %` });
}

export function formatNumber(value: number): string {
	if (Number.isInteger(value)) return value.toLocaleString();
	return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
