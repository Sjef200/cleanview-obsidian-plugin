/**
 * A small dialog that writes a block for you.
 *
 * Deliberately narrow. A builder exposing every option would be a fifteen-field
 * form, which is slower to operate than typing the YAML it replaces — so this
 * covers the common cases in five controls and always shows the block it will
 * insert. Anything unusual is edited as text afterwards, and the live preview
 * is what teaches the syntax needed to do that.
 */

import { type App, Modal, Setting, TFolder } from "obsidian";
import { type BuilderState, DEFAULT_STATE, type ViewChoice, buildBlock } from "./block-spec";

export class BlockBuilderModal extends Modal {
	private state: BuilderState;
	private preview!: HTMLElement;
	private controls!: HTMLElement;

	constructor(
		app: App,
		private readonly onInsert: (block: string) => void,
		initial?: BuilderState,
	) {
		super(app);
		this.state = { ...(initial ?? DEFAULT_STATE) };
		this.editing = initial !== undefined;
	}

	private readonly editing: boolean;

	onOpen(): void {
		this.titleEl.setText(this.editing ? "Edit block" : "New dashboard block");
		const { contentEl } = this;
		contentEl.addClass("cleanview-builder");

		new Setting(contentEl)
			.setName("Show")
			.setDesc("What this block displays.")
			.addDropdown((d) =>
				d
					.addOptions({
						tasks: "Tasks",
						chart: "Chart",
						stat: "A single number",
						countdown: "Countdown to a date",
						table: "Table of notes",
					})
					.setValue(this.state.view)
					.onChange((value) => {
						this.state.view = value as ViewChoice;
						this.renderControls();
						this.renderPreview();
					}),
			);

		new Setting(contentEl)
			.setName("Title")
			.setDesc("Optional heading above the block.")
			.addText((t) =>
				t
					.setPlaceholder("Leave empty for none")
					.setValue(this.state.title)
					.onChange((value) => {
						this.state.title = value;
						this.renderPreview();
					}),
			);

		// Everything below depends on the chosen view.
		this.controls = contentEl.createDiv();
		this.renderControls();

		contentEl.createEl("p", {
			cls: "cleanview-builder-hint",
			text: "This is what will be inserted. You can edit it afterwards — every option lives in the text.",
		});
		this.preview = contentEl.createEl("pre", { cls: "cleanview-builder-preview" });
		this.renderPreview();

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(this.editing ? "Save" : "Insert")
					.setCta()
					.onClick(() => {
						this.onInsert(buildBlock(this.state));
						this.close();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private renderControls(): void {
		this.controls.empty();
		const view = this.state.view;

		if (view === "tasks" || view === "chart" || view === "stat") {
			this.addStatusControl(view);
		}

		if (view === "tasks") {
			new Setting(this.controls)
				.setName("Due")
				.addDropdown((d) =>
					d
						.addOptions({
							any: "Any time",
							overdue: "Overdue",
							today: "Today or earlier",
							week: "Within 7 days",
							month: "Within a month",
							none: "No due date",
						})
						.setValue(this.state.due)
						.onChange((value) => {
							this.state.due = value as BuilderState["due"];
							this.renderPreview();
						}),
				);

			new Setting(this.controls)
				.setName("Group by")
				.addDropdown((d) =>
					d
						.addOptions({ none: "Nothing", file: "Note", folder: "Folder", priority: "Priority" })
						.setValue(this.state.group)
						.onChange((value) => {
							this.state.group = value as BuilderState["group"];
							this.renderPreview();
						}),
				);
		}

		if (view === "chart") {
			new Setting(this.controls)
				.setName("Chart type")
				.addDropdown((d) =>
					d
						.addOptions({ bar: "Bars", line: "Line over time", donut: "Donut" })
						.setValue(this.state.chartType)
						.onChange((value) => {
							this.state.chartType = value as BuilderState["chartType"];
							this.renderPreview();
						}),
				);

			new Setting(this.controls)
				.setName("Split by")
				.addDropdown((d) =>
					d
						.addOptions({ folder: "Folder", priority: "Priority", due: "Due date", status: "Status" })
						.setValue(this.state.by)
						.onChange((value) => {
							this.state.by = value as BuilderState["by"];
							this.renderPreview();
						}),
				);
		}

		this.addFolderControl();

		new Setting(this.controls)
			.setName("Tag")
			.setDesc("Optional. Only include items with this tag.")
			.addText((t) =>
				t
					.setPlaceholder("e.g. school")
					.setValue(this.state.tag)
					.onChange((value) => {
						this.state.tag = value;
						this.renderPreview();
					}),
			);
	}

	private addStatusControl(view: ViewChoice): void {
		if (view === "stat") {
			new Setting(this.controls)
				.setName("Count")
				.addDropdown((d) =>
					d
						.addOptions({ openTasks: "Open tasks", allTasks: "All tasks", notes: "Notes" })
						.setValue(this.state.measure)
						.onChange((value) => {
							this.state.measure = value as BuilderState["measure"];
							this.state.status = value === "openTasks" ? "open" : "all";
							this.renderPreview();
						}),
				);
			return;
		}

		new Setting(this.controls)
			.setName("Status")
			.addDropdown((d) =>
				d
					.addOptions({ open: "Not done", done: "Done", all: "Both" })
					.setValue(this.state.status)
					.onChange((value) => {
						this.state.status = value as BuilderState["status"];
						this.renderPreview();
					}),
			);
	}

	/** Lists the vault's real folders, so the scope is picked rather than typed. */
	private addFolderControl(): void {
		const options: Record<string, string> = { "": "Whole vault" };
		const walk = (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					options[child.path] = child.path;
					walk(child);
				}
			}
		};
		walk(this.app.vault.getRoot());

		new Setting(this.controls)
			.setName("Folder")
			.addDropdown((d) =>
				d
					.addOptions(options)
					.setValue(this.state.folder)
					.onChange((value) => {
						this.state.folder = value;
						this.renderPreview();
					}),
			);
	}

	private renderPreview(): void {
		this.preview.setText(buildBlock(this.state));
	}
}
