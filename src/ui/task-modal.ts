/**
 * Three fields: what, when, how urgent.
 *
 * The Tasks plugin's editor covers eleven — recurrence, scheduled, start,
 * dependencies, cancelled dates — which is the right shape for managing tasks
 * and the wrong shape for jotting one down. This exists because a dated task is
 * the precondition for every date-filtered dashboard, so getting one in has to
 * be quicker than the dashboard it feeds.
 */

import { type App, Modal, Setting } from "obsidian";
import {
	DEFAULT_TASK,
	type NewTask,
	buildTaskLine,
	shiftInput,
	todayInput,
} from "./task-spec";

export class TaskModal extends Modal {
	private task: NewTask;
	private readonly editing: boolean;
	private preview!: HTMLElement;
	private dueInput!: HTMLInputElement;

	constructor(
		app: App,
		private readonly onSubmit: (task: NewTask) => void,
		initial?: NewTask,
	) {
		super(app);
		this.task = { ...(initial ?? DEFAULT_TASK) };
		this.editing = initial !== undefined;
	}

	onOpen(): void {
		this.titleEl.setText(this.editing ? "Edit task" : "Add task");
		const { contentEl } = this;

		new Setting(contentEl)
			.setName("Task")
			.addText((t) => {
				t.setPlaceholder("What needs doing").setValue(this.task.text).onChange((value) => {
					this.task.text = value;
					this.renderPreview();
				});
				// Typing then Enter should be the whole interaction.
				t.inputEl.addEventListener("keydown", (event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						this.submit();
					}
				});
				window.setTimeout(() => t.inputEl.focus(), 0);
			});

		const dueSetting = new Setting(contentEl).setName("Due").setDesc("Optional.");
		this.dueInput = dueSetting.controlEl.createEl("input", { type: "date" });
		this.dueInput.value = this.task.due;
		this.dueInput.addEventListener("change", () => {
			this.task.due = this.dueInput.value;
			this.renderPreview();
		});

		// Typing a date is slower than naming one, so name the common ones.
		const quick = contentEl.createDiv({ cls: "cleanview-quick-dates" });
		const shortcuts: Array<[string, () => string]> = [
			["Today", () => todayInput()],
			["Tomorrow", () => shiftInput(todayInput(), 1)],
			["In a week", () => shiftInput(todayInput(), 7)],
			["No date", () => ""],
		];
		for (const [label, value] of shortcuts) {
			const button = quick.createEl("button", { text: label, cls: "cleanview-quick-date" });
			button.addEventListener("click", () => {
				this.task.due = value();
				this.dueInput.value = this.task.due;
				this.renderPreview();
			});
		}

		new Setting(contentEl)
			.setName("Priority")
			.addDropdown((d) =>
				d
					.addOptions({ "2": "Normal", "4": "High", "5": "Highest", "1": "Low" })
					.setValue(String(this.task.priority))
					.onChange((value) => {
						this.task.priority = Number(value);
						this.renderPreview();
					}),
			);

		contentEl.createEl("p", {
			cls: "cleanview-builder-hint",
			text: "This is the line that will be inserted.",
		});
		this.preview = contentEl.createEl("pre", { cls: "cleanview-builder-preview" });
		this.renderPreview();

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((b) => b.setButtonText(this.editing ? "Save" : "Add").setCta().onClick(() => this.submit()));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private submit(): void {
		this.onSubmit({ ...this.task });
		this.close();
	}

	private renderPreview(): void {
		// In edit mode the real line is composed by rewriteTaskBody, which also
		// carries across metadata this dialog has no field for. The preview
		// shows the shape rather than pretending to be the final line.
		this.preview.setText(buildTaskLine(this.task));
	}
}
