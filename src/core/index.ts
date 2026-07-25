/**
 * The vault index.
 *
 * Design notes, since this is where the speed comes from:
 *
 *  1. Obsidian already parses every note into `metadataCache` — frontmatter,
 *     tags, and list items with their checkbox state and line positions. We
 *     read that instead of parsing markdown ourselves, so indexing costs no
 *     file I/O for anything except task *text*.
 *
 *  2. Only files that the cache says contain checkboxes are ever read from
 *     disk. A vault of 5000 notes where 200 have tasks does 200 reads, not 5000.
 *
 *  3. `metadataCache.on("changed")` hands us the new file content as an
 *     argument. Re-indexing an edited file therefore does zero I/O too.
 *
 *  4. Updates are per-file. Editing one note re-parses that one note and bumps
 *     a revision counter; it never rebuilds the vault.
 */

import { type App, type CachedMetadata, type TFile, TFolder, getAllTags } from "obsidian";
import type { CleanViewFile, CleanViewTask } from "./types";
import { parseTaskLine } from "./task-parser";

export type IndexListener = (changedPaths: ReadonlySet<string> | null) => void;

export class VaultIndex {
	private readonly app: App;

	private readonly files = new Map<string, CleanViewFile>();
	private readonly tasksByFile = new Map<string, CleanViewTask[]>();

	/** Flattened task list, rebuilt lazily after any change. */
	private flatTasks: CleanViewTask[] | null = null;
	private flatFiles: CleanViewFile[] | null = null;

	private readonly listeners = new Set<IndexListener>();
	private pendingPaths = new Set<string>();
	private notifyHandle: number | null = null;

	/** Bumped on every committed change; blocks use it to skip redundant renders. */
	revision = 0;
	ready = false;

	constructor(app: App) {
		this.app = app;
	}

	// ---------------------------------------------------------------- queries

	allTasks(): readonly CleanViewTask[] {
		if (this.flatTasks === null) {
			const out: CleanViewTask[] = [];
			for (const tasks of this.tasksByFile.values()) {
				for (const task of tasks) out.push(task);
			}
			this.flatTasks = out;
		}
		return this.flatTasks;
	}

	allFiles(): readonly CleanViewFile[] {
		if (this.flatFiles === null) this.flatFiles = [...this.files.values()];
		return this.flatFiles;
	}

	stats(): { files: number; tasks: number; openTasks: number } {
		let openTasks = 0;
		for (const task of this.allTasks()) if (!task.done) openTasks++;
		return { files: this.files.size, tasks: this.allTasks().length, openTasks };
	}

	// ------------------------------------------------------------ build/update

	/**
	 * Builds the whole index, yielding to the event loop between chunks so the
	 * UI stays responsive on large vaults.
	 */
	async build(): Promise<void> {
		this.files.clear();
		this.tasksByFile.clear();

		const markdownFiles = this.app.vault.getMarkdownFiles();
		const CHUNK = 200;

		for (let i = 0; i < markdownFiles.length; i += CHUNK) {
			const chunk = markdownFiles.slice(i, i + CHUNK);
			await Promise.all(chunk.map((file) => this.indexFile(file)));
			if (i + CHUNK < markdownFiles.length) await yieldToEventLoop();
		}

		this.invalidate();
		this.ready = true;
		this.revision++;
		this.notifyNow(null);
	}

	/** Indexes a single file. `content` skips the read when the caller already has it. */
	async indexFile(file: TFile, content?: string, cache?: CachedMetadata | null): Promise<void> {
		const meta = cache !== undefined ? cache : this.app.metadataCache.getFileCache(file);
		const folder = file.parent?.path ?? "/";

		const listItems = meta?.listItems;
		const hasCheckbox = listItems?.some((item) => item.task !== undefined) ?? false;

		let tasks: CleanViewTask[] = [];
		if (hasCheckbox && listItems) {
			// Only now do we need the actual text, so only now do we read.
			const text = content ?? (await this.app.vault.cachedRead(file));
			const lines = text.split("\n");
			tasks = [];
			for (const item of listItems) {
				if (item.task === undefined) continue;
				const line = lines[item.position.start.line];
				if (line === undefined) continue;
				const task = parseTaskLine(line, item, file.path, file.basename, folder);
				if (task) tasks.push(task);
			}
		}

		if (tasks.length > 0) this.tasksByFile.set(file.path, tasks);
		else this.tasksByFile.delete(file.path);

		const tagSet = meta ? getAllTags(meta) ?? [] : [];
		this.files.set(file.path, {
			path: file.path,
			name: file.basename,
			folder,
			mtime: file.stat.mtime,
			ctime: file.stat.ctime,
			size: file.stat.size,
			frontmatter: (meta?.frontmatter as Record<string, unknown>) ?? {},
			tags: tagSet.map((tag) => tag.replace(/^#/, "").toLowerCase()),
			taskCount: tasks.length,
			openTaskCount: tasks.reduce((n, task) => (task.done ? n : n + 1), 0),
		});
	}

	removeFile(path: string): void {
		this.files.delete(path);
		this.tasksByFile.delete(path);
		this.invalidate();
		this.queueNotify(path);
	}

	/** Re-index one file and schedule a notification. */
	async updateFile(file: TFile, content?: string, cache?: CachedMetadata | null): Promise<void> {
		await this.indexFile(file, content, cache);
		this.invalidate();
		this.queueNotify(file.path);
	}

	/** Re-index every markdown file under a folder, used after a folder rename. */
	async updateFolder(folder: TFolder): Promise<void> {
		const touched: string[] = [];
		const walk = (dir: TFolder) => {
			for (const child of dir.children) {
				if (child instanceof TFolder) walk(child);
				else if ("extension" in child && (child as TFile).extension === "md") {
					touched.push((child as TFile).path);
				}
			}
		};
		walk(folder);

		for (const path of touched) {
			const file = this.app.vault.getFileByPath(path);
			if (file) await this.indexFile(file);
		}
		this.invalidate();
		for (const path of touched) this.pendingPaths.add(path);
		this.queueNotify(null);
	}

	private invalidate(): void {
		this.flatTasks = null;
		this.flatFiles = null;
	}

	/**
	 * Forces every block to re-render without touching the data.
	 *
	 * Used at midnight: a countdown or an "overdue" filter is computed against
	 * today's date, so a dashboard left open overnight would otherwise keep
	 * showing yesterday's numbers until something in the vault changed.
	 */
	touchAll(): void {
		this.revision++;
		this.notifyNow(null);
	}

	// -------------------------------------------------------------- listeners

	subscribe(listener: IndexListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * Coalesces bursts of changes into one notification.
	 *
	 * Typing in a note fires `changed` repeatedly; without this, every keystroke
	 * would re-render every dashboard block on screen.
	 */
	private queueNotify(path: string | null): void {
		if (path) this.pendingPaths.add(path);
		if (this.notifyHandle !== null) return;

		this.notifyHandle = window.setTimeout(() => {
			this.notifyHandle = null;
			const paths = this.pendingPaths;
			this.pendingPaths = new Set();
			this.revision++;
			this.notifyNow(paths.size > 0 ? paths : null);
		}, 120);
	}

	private notifyNow(paths: ReadonlySet<string> | null): void {
		for (const listener of this.listeners) {
			try {
				listener(paths);
			} catch (error) {
				console.error("CleanView: a dashboard block failed while updating", error);
			}
		}
	}

	dispose(): void {
		if (this.notifyHandle !== null) window.clearTimeout(this.notifyHandle);
		this.notifyHandle = null;
		this.listeners.clear();
		this.files.clear();
		this.tasksByFile.clear();
		this.invalidate();
	}
}

function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, 0));
}
