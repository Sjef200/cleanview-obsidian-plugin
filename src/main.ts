/**
 * CleanView — fast, local dashboards for Obsidian.
 *
 * The plugin makes no network requests, evaluates no user-supplied JavaScript,
 * and touches no Node APIs (so it runs on mobile). The only writes it performs
 * are single-line checkbox toggles you explicitly click.
 */

import {
	ButtonComponent,
	type MarkdownPostProcessorContext,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	type SettingDefinitionItem,
	TFile,
	TFolder,
} from "obsidian";
import { CleanViewBlock } from "./block";
import { VaultIndex } from "./core/index";
import { BlockBuilderModal } from "./ui/block-builder";

interface CleanViewSettings {
	/** Rebuild the whole index at startup instead of trusting incremental updates. */
	rebuildOnStart: boolean;
}

const DEFAULT_SETTINGS: CleanViewSettings = {
	rebuildOnStart: true,
};

export default class CleanViewPlugin extends Plugin {
	index!: VaultIndex;
	settings: CleanViewSettings = DEFAULT_SETTINGS;
	private midnightTimer: number | null = null;
	private builtAfterCacheResolved = false;

	async onload(): Promise<void> {
		// loadData() is typed `any`; narrow it before merging so a corrupt or
		// hand-edited data.json cannot smuggle unexpected values into settings.
		const stored = (await this.loadData()) as Partial<CleanViewSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
		this.index = new VaultIndex(this.app);

		this.registerMarkdownCodeBlockProcessor(
			"cleanview",
			(source: string, el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
				ctx.addChild(new CleanViewBlock(el, this.app, this.index, source, ctx.sourcePath));
			},
		);

		this.registerVaultEvents();
		this.addSettingTab(new CleanViewSettingTab(this));
		this.addCommands();

		// Waiting for layout-ready keeps startup off the critical path.
		this.app.workspace.onLayoutReady(() => {
			void this.index.build();
		});

		// `onLayoutReady` means the workspace is ready, NOT that the metadata
		// cache is populated. On a cold start with a large vault Obsidian is
		// still indexing, `getFileCache()` returns null for files it has not
		// reached, and every note looks task-free. Rebuild once Obsidian
		// reports the cache resolved.
		//
		// "resolved" also fires after later edits, so this rebuilds only the
		// first time; incremental updates handle everything after that.
		this.registerEvent(
			this.app.metadataCache.on("resolved", () => {
				if (this.builtAfterCacheResolved) return;
				this.builtAfterCacheResolved = true;
				void this.index.build();
			}),
		);

		this.scheduleMidnightRefresh();
	}

	onunload(): void {
		if (this.midnightTimer !== null) window.clearTimeout(this.midnightTimer);
		this.midnightTimer = null;
		this.index.dispose();
	}

	/**
	 * Re-renders every block just after midnight.
	 *
	 * Countdowns and `overdue` filters are relative to today's date, so a
	 * dashboard left open overnight would keep showing yesterday's numbers until
	 * something in the vault happened to change.
	 */
	private scheduleMidnightRefresh(): void {
		const now = new Date();
		const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 5);
		const delay = midnight.getTime() - now.getTime();

		this.midnightTimer = window.setTimeout(() => {
			this.index.touchAll();
			this.scheduleMidnightRefresh();
		}, delay);
	}

	private registerVaultEvents(): void {
		// `changed` hands us the new content, so re-indexing an edit costs no I/O.
		this.registerEvent(
			this.app.metadataCache.on("changed", (file, data, cache) => {
				void this.index.updateFile(file, data, cache);
			}),
		);

		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.index.removeFile(file.path);
			}),
		);

		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				this.index.removeFile(oldPath);
				if (file instanceof TFile && file.extension === "md") {
					void this.index.updateFile(file);
				} else if (file instanceof TFolder) {
					// Every descendant's path changed, so their index entries are stale.
					void this.index.updateFolder(file);
				}
			}),
		);
	}

	private addCommands(): void {
		this.addCommand({
			id: "rebuild-index",
			name: "Rebuild index",
			callback: async () => {
				const started = performance.now();
				await this.index.build();
				const elapsed = Math.round(performance.now() - started);
				const stats = this.index.stats();
				new Notice(
					`CleanView: indexed ${stats.files} notes and ${stats.tasks} tasks in ${elapsed} ms`,
					5000,
				);
			},
		});

		this.addCommand({
			id: "new-block",
			name: "New dashboard block",
			editorCallback: (editor) => {
				new BlockBuilderModal(this.app, (block) => editor.replaceSelection(block)).open();
			},
		});

		this.addCommand({
			id: "insert-task-block",
			name: "Insert task list",
			editorCallback: (editor) => {
				editor.replaceSelection(
					[
						"```cleanview",
						"view: tasks",
						"title: Due today",
						"filter:",
						"  done: false",
						"  due: { to: today }",
						"sort: [priority desc, due asc]",
						"```",
						"",
					].join("\n"),
				);
			},
		});

		this.addCommand({
			id: "insert-chart-block",
			name: "Insert chart",
			editorCallback: (editor) => {
				editor.replaceSelection(
					[
						"```cleanview",
						"view: chart",
						"type: bar",
						"title: Open tasks by folder",
						"filter:",
						"  done: false",
						"by: folder",
						"value: count",
						"```",
						"",
					].join("\n"),
				);
			},
		});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

const PRIVACY_NOTE =
	"CleanView makes no network requests, downloads nothing, and never executes " +
	"JavaScript from your notes. Block configuration is data, not code.";

class CleanViewSettingTab extends PluginSettingTab {
	constructor(private readonly plugin: CleanViewPlugin) {
		super(plugin.app, plugin);
	}

	/**
	 * The declarative tab, used on Obsidian 1.13 and later.
	 *
	 * Describing the settings as data rather than building them by hand is what
	 * lets Obsidian index them for its settings search. `display()` below stays
	 * as the fallback for older versions — Obsidian ignores it whenever this
	 * returns a non-empty array.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const stats = this.plugin.index.stats();

		return [
			{
				name: "Index",
				desc: this.plugin.index.ready
					? `${stats.files} notes, ${stats.tasks} tasks (${stats.openTasks} open).`
					: "Building…",
				action: (el) => {
					new ButtonComponent(el).setButtonText("Rebuild").onClick(async () => {
						await this.plugin.index.build();
						// Re-read the definitions so the counts above refresh.
						this.update();
					});
				},
			},
			{
				name: "Build index at startup",
				desc:
					"Reads the whole vault when Obsidian starts. Turn this off only if startup feels " +
					"slow on a very large vault; the index is then built when you first open a dashboard.",
				control: { type: "toggle", key: "rebuildOnStart" },
			},
			{
				name: "Privacy",
				desc: PRIVACY_NOTE,
			},
		];
	}

	/** Binds a control `key` to the plugin's settings object. */
	getControlValue(key: string): unknown {
		if (key === "rebuildOnStart") return this.plugin.settings.rebuildOnStart;
		return undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key === "rebuildOnStart") {
			this.plugin.settings.rebuildOnStart = Boolean(value);
			await this.plugin.saveSettings();
		}
	}

	/** Fallback for Obsidian older than 1.13.0, which has no declarative tab. */
	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const stats = this.plugin.index.stats();
		new Setting(containerEl)
			.setName("Index")
			.setDesc(
				this.plugin.index.ready
					? `${stats.files} notes, ${stats.tasks} tasks (${stats.openTasks} open).`
					: "Building…",
			)
			.addButton((button) =>
				button.setButtonText("Rebuild").onClick(async () => {
					await this.plugin.index.build();
					this.display();
				}),
			);

		new Setting(containerEl)
			.setName("Build index at startup")
			.setDesc(
				"Reads the whole vault when Obsidian starts. Turn this off only if startup feels " +
					"slow on a very large vault; the index is then built when you first open a dashboard.",
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.rebuildOnStart).onChange(async (value) => {
					this.plugin.settings.rebuildOnStart = value;
					await this.plugin.saveSettings();
				}),
			);

		// Obsidian's review guidelines ask for setHeading() rather than a raw
		// heading element, so section headers match the rest of the settings UI.
		new Setting(containerEl).setName("Privacy").setHeading();

		containerEl.createEl("p", { cls: "cleanview-about", text: PRIVACY_NOTE });
	}
}
