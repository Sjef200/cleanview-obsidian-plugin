/**
 * Renders a `board` block: five columns computed from `due`, not a status
 * field someone has to keep in sync by hand. Dragging a card between columns
 * reschedules the task — it writes a new due date, which is the one action a
 * generic status kanban has no equivalent for.
 *
 *   view: board
 *   title: This week's work
 *   filter: { done: false }
 */

import { Menu, setIcon } from "obsidian";
import type { App } from "obsidian";
import { today } from "../core/dates";
import { PRIORITY_LABELS, PRIORITY_NONE } from "../core/types";
import type { CleanViewTask } from "../core/types";
import { toggleTaskInFile, updateTaskInFile } from "../core/writeback";
import type { BlockConfig, QueryResult } from "../query/query";
import { type ColumnDef, COLUMNS, bucketRows } from "./board-spec";
import { emptyState, openFileAt, renderCapped, renderInline, sectionHeader } from "./render-utils";
import { openTaskEditor, type ViewContext } from "./task-view";
import { dayNumToInput, hoursToInput, rewriteTaskBody } from "../ui/task-spec";

/** Columns are compact, so a tighter per-column cap than the task list's 50. */
const DEFAULT_CAP = 30;

export function renderBoard(
	container: HTMLElement,
	result: QueryResult,
	config: BlockConfig,
	ctx: ViewContext,
): void {
	sectionHeader(container, config.title);

	const rows = result.rows as CleanViewTask[];
	if (rows.length === 0) {
		emptyState(container, "No tasks match this filter.");
		return;
	}

	const buckets = bucketRows(rows, today());
	const cap = config.limit ?? DEFAULT_CAP;
	const board = container.createDiv({ cls: "cleanview-board" });

	// Scoped to this render call: which card is mid-drag, and which column it
	// started in. A closure rather than a module-level variable, so two board
	// blocks on the same page never interfere with each other's drag state.
	let dragged: { task: CleanViewTask; from: ColumnDef["id"] } | null = null;

	for (const column of COLUMNS) {
		const colRows = buckets.get(column.id) ?? [];
		const colEl = board.createDiv({ cls: "cleanview-board-column" });

		const head = colEl.createDiv({ cls: "cleanview-board-column-head" });
		head.createSpan({ cls: "cleanview-board-column-label", text: column.label });
		head.createSpan({ cls: "cleanview-count", text: String(colRows.length) });
		const hours = colRows.reduce((sum, row) => sum + (row.estimate ?? 0), 0);
		if (hours > 0) head.createSpan({ cls: "cleanview-board-column-hours", text: `${hours}h` });

		const list = colEl.createDiv({ cls: "cleanview-board-cards" });

		// A drop anywhere in the column counts — there is no persisted manual
		// order for cards to land at a specific position within one.
		colEl.addEventListener("dragover", (event) => {
			if (!dragged) return;
			event.preventDefault();
			if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
			colEl.addClass("is-drag-over");
		});
		colEl.addEventListener("dragleave", (event) => {
			if (event.target === colEl) colEl.removeClass("is-drag-over");
		});
		colEl.addEventListener("drop", (event) => {
			event.preventDefault();
			colEl.removeClass("is-drag-over");
			if (dragged && dragged.from !== column.id) moveTask(ctx.app, dragged.task, column);
			dragged = null;
		});

		renderCapped(list, colRows, cap, (task, parent) =>
			renderCard(parent, task, column, ctx, {
				onDragStart: (t) => {
					dragged = { task: t, from: column.id };
				},
				onDragEnd: () => {
					dragged = null;
				},
			}),
		);
	}
}

interface DragHooks {
	onDragStart(task: CleanViewTask): void;
	onDragEnd(): void;
}

function renderCard(
	parent: HTMLElement,
	task: CleanViewTask,
	column: ColumnDef,
	ctx: ViewContext,
	hooks: DragHooks,
): void {
	const card = parent.createDiv({ cls: "cleanview-board-card" });
	if (task.done) card.addClass("is-done");

	// Drag-and-drop is desktop-only in practice — mobile Safari and Chrome
	// Android do not fire native HTML5 drag events reliably — but the card
	// stays draggable everywhere; mobile visitors simply never start one.
	card.draggable = true;
	card.addEventListener("dragstart", (event) => {
		card.addClass("is-dragging");
		event.dataTransfer?.setData("text/plain", `${task.path}:${task.line}`);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
		hooks.onDragStart(task);
	});
	card.addEventListener("dragend", () => {
		card.removeClass("is-dragging");
		hooks.onDragEnd();
	});

	const top = card.createDiv({ cls: "cleanview-board-card-top" });

	const checkbox = top.createEl("input", { type: "checkbox", cls: "cleanview-check" });
	checkbox.checked = task.done;
	checkbox.setAttr("aria-label", task.done ? "Mark as not done" : "Mark as done");
	checkbox.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		checkbox.checked = !task.done;
		card.toggleClass("is-done", !task.done);
		void toggleTaskInFile(ctx.app, task);
	});

	const text = top.createDiv({ cls: "cleanview-task-text is-editable" });
	renderInline(ctx.app, ctx.component, text, task.text || "(empty task)", ctx.sourcePath);
	text.setAttr("role", "button");
	text.setAttr("tabindex", "0");
	const edit = (event: Event) => {
		if ((event.target as HTMLElement).closest("a")) return;
		event.preventDefault();
		openTaskEditor(task, ctx);
	};
	text.addEventListener("click", edit);
	text.addEventListener("keydown", (event) => {
		if (event.key === "Enter") edit(event);
	});

	// Present on every platform, not only mobile: dragging has no keyboard
	// equivalent, so a mouse-only reschedule action would leave keyboard users
	// on desktop with no way to move a card either.
	const moveBtn = card.createEl("button", { cls: "cleanview-board-move" });
	setIcon(moveBtn, "move");
	moveBtn.setAttr("aria-label", "Move to another column");
	moveBtn.addEventListener("click", (event) => {
		event.stopPropagation();
		const menu = new Menu();
		for (const target of COLUMNS) {
			if (target.id === column.id) continue;
			menu.addItem((item) =>
				item.setTitle(target.label).onClick(() => moveTask(ctx.app, task, target)),
			);
		}
		menu.showAtMouseEvent(event);
	});

	const meta = card.createDiv({ cls: "cleanview-meta" });
	if (task.priority !== PRIORITY_NONE) {
		meta.createSpan({
			cls: `cleanview-chip cleanview-prio cleanview-prio-${task.priority}`,
			text: PRIORITY_LABELS[task.priority] ?? String(task.priority),
		});
	}
	if (task.estimate !== undefined) {
		meta.createSpan({ cls: "cleanview-chip", text: `${task.estimate}h` });
	}
	const link = meta.createSpan({ cls: "cleanview-chip cleanview-file", text: task.fileName });
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

/** Rewrites the task's due date to match the column it was moved into. */
function moveTask(app: App, task: CleanViewTask, column: ColumnDef): void {
	const due = dayNumToInput(column.dropDue(today()));
	const body = rewriteTaskBody(task.raw, {
		text: task.text,
		due,
		priority: task.priority,
		estimate: hoursToInput(task.estimate),
	});
	if (body !== task.raw) void updateTaskInFile(app, task, body);
}
