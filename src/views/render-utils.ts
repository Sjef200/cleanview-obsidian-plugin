/**
 * Shared rendering helpers.
 *
 * Everything here builds DOM directly. There is no virtual DOM and no template
 * string being parsed into HTML, which also means no path by which note content
 * could be interpreted as markup.
 */

import { type App, MarkdownRenderer, type Component, type TFile } from "obsidian";

export function sectionHeader(parent: HTMLElement, title: string | undefined): void {
	if (!title) return;
	parent.createDiv({ cls: "cleanview-title", text: title });
}

export function emptyState(parent: HTMLElement, message: string): void {
	parent.createDiv({ cls: "cleanview-empty", text: message });
}

export function errorState(parent: HTMLElement, message: string): void {
	const box = parent.createDiv({ cls: "cleanview-error" });
	box.createSpan({ cls: "cleanview-error-badge", text: "CleanView" });
	box.createSpan({ text: message });
}

/**
 * Renders inline markdown (links, bold, code) into `target`.
 *
 * Task text routinely contains [[wikilinks]], so rendering it as plain text
 * would be a visible regression against Dataview.
 */
export function renderInline(
	app: App,
	component: Component,
	target: HTMLElement,
	markdown: string,
	sourcePath: string,
): void {
	void MarkdownRenderer.render(app, markdown, target, sourcePath, component).then(() => {
		// MarkdownRenderer always wraps output in a <p>; unwrap it so the text
		// sits inline with the checkbox instead of forming its own block.
		const paragraph = target.querySelector(":scope > p");
		if (paragraph && target.childElementCount === 1) {
			while (paragraph.firstChild) target.insertBefore(paragraph.firstChild, paragraph);
			paragraph.remove();
		}
	});
}

/** Opens a file, scrolling to `line` when given. */
export function openFileAt(app: App, path: string, line?: number, newLeaf = false): void {
	const file = app.vault.getFileByPath(path);
	if (!file) return;
	const leaf = app.workspace.getLeaf(newLeaf);
	void leaf.openFile(file as TFile, {
		eState: line !== undefined ? { line, scroll: line } : undefined,
	});
}

/**
 * Renders a capped list with a button to reveal the rest.
 *
 * Dashboards routinely match hundreds of rows while only the first handful are
 * ever read. Capping keeps the initial paint small; the button makes the
 * omission visible instead of silently truncating.
 */
export function renderCapped<T>(
	parent: HTMLElement,
	items: readonly T[],
	cap: number,
	renderItem: (item: T, container: HTMLElement) => void,
): void {
	const visible = Math.min(cap, items.length);
	for (let i = 0; i < visible; i++) renderItem(items[i], parent);

	if (items.length <= cap) return;

	const remaining = items.length - cap;
	const more = parent.createEl("button", {
		cls: "cleanview-more",
		text: `Show ${remaining} more`,
	});
	more.addEventListener("click", () => {
		more.remove();
		for (let i = visible; i < items.length; i++) renderItem(items[i], parent);
	});
}

export function truncated(total: number, shown: number): string | null {
	if (total <= shown) return null;
	return `Showing ${shown} of ${total}`;
}
