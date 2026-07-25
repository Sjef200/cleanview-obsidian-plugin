/**
 * Task list view.
 *
 * Checkboxes are live: ticking one rewrites the source line in the note, which
 * fires the metadata cache change event, which re-renders every dashboard block
 * that depends on it. No manual refresh anywhere.
 */

import type { App, Component } from "obsidian";
import type { PulsTask } from "../core/types";
import { PRIORITY_LABELS, PRIORITY_NONE } from "../core/types";
import { formatISO, formatRelativeDay, today } from "../core/dates";
import type { BlockConfig, QueryResult } from "../query/query";
import type { Group } from "../query/sort";
import { emptyState, openFileAt, renderCapped, renderInline, sectionHeader } from "./render-utils";
import { toggleTaskInFile } from "../core/writeback";

const DEFAULT_CAP = 50;

export interface ViewContext {
	app: App;
	component: Component;
	sourcePath: string;
}

export function renderTasks(
	container: HTMLElement,
	result: QueryResult,
	config: BlockConfig,
	ctx: ViewContext,
): void {
	sectionHeader(container, config.title);

	if (result.rows.length === 0) {
		emptyState(container, "No tasks match this filter.");
		return;
	}

	const show = new Set((config.show ?? ["due", "priority", "file"]).map((s) => String(s)));
	const cap = config.limit ?? DEFAULT_CAP;

	if (result.groups) {
		for (const group of result.groups) {
			renderGroup(container, group, show, cap, ctx);
		}
	} else {
		const list = container.createDiv({ cls: "puls-tasks" });
		renderCapped(list, result.rows as PulsTask[], cap, (task, parent) =>
			renderTask(parent, task, show, ctx),
		);
	}
}

function renderGroup(
	container: HTMLElement,
	group: Group,
	show: Set<string>,
	cap: number,
	ctx: ViewContext,
): void {
	const section = container.createDiv({ cls: "puls-group" });
	const heading = section.createDiv({ cls: "puls-group-head" });
	heading.createSpan({ cls: "puls-group-label", text: group.label });
	heading.createSpan({ cls: "puls-count", text: String(group.rows.length) });

	const list = section.createDiv({ cls: "puls-tasks" });
	renderCapped(list, group.rows as PulsTask[], cap, (task, parent) =>
		renderTask(parent, task, show, ctx),
	);
}

function renderTask(
	parent: HTMLElement,
	task: PulsTask,
	show: Set<string>,
	ctx: ViewContext,
): void {
	const row = parent.createDiv({ cls: "puls-task" });
	if (task.done) row.addClass("is-done");

	const checkbox = row.createEl("input", { type: "checkbox", cls: "puls-check" });
	checkbox.checked = task.done;
	checkbox.setAttr("aria-label", task.done ? "Mark as not done" : "Mark as done");
	checkbox.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		// Optimistic: flip immediately, let the re-index confirm.
		checkbox.checked = !task.done;
		row.toggleClass("is-done", !task.done);
		void toggleTaskInFile(ctx.app, task);
	});

	const body = row.createDiv({ cls: "puls-task-body" });
	const text = body.createDiv({ cls: "puls-task-text" });
	renderInline(ctx.app, ctx.component, text, task.text || "(empty task)", ctx.sourcePath);

	const meta = body.createDiv({ cls: "puls-meta" });

	if (show.has("priority") && task.priority !== PRIORITY_NONE) {
		meta.createSpan({
			cls: `puls-chip puls-prio puls-prio-${task.priority}`,
			text: PRIORITY_LABELS[task.priority] ?? String(task.priority),
		});
	}

	if (show.has("due") && task.due !== undefined) {
		const overdue = !task.done && task.due < today();
		const chip = meta.createSpan({
			cls: `puls-chip puls-due${overdue ? " is-overdue" : ""}`,
			text: formatRelativeDay(task.due),
		});
		chip.setAttr("title", formatISO(task.due));
	}

	if (show.has("scheduled") && task.scheduled !== undefined) {
		meta.createSpan({ cls: "puls-chip", text: `scheduled ${formatRelativeDay(task.scheduled)}` });
	}

	if (show.has("file")) {
		const link = meta.createSpan({ cls: "puls-chip puls-file", text: task.fileName });
		link.setAttr("role", "link");
		link.setAttr("tabindex", "0");
		const open = (event: Event) => {
			event.preventDefault();
			openFileAt(ctx.app, task.path, task.line);
		};
		link.addEventListener("click", open);
		link.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") open(event);
		});
	}
}
