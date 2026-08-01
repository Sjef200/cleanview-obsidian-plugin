/**
 * DEV ONLY — stands in for the `obsidian` module in the browser preview.
 *
 * Only the handful of runtime values the view layer actually imports need to
 * exist. Everything else Obsidian exports is type-only and disappears at build
 * time, so it needs no stub.
 */

export const MarkdownRenderer = {
	// The preview renders plain text rather than markdown; link syntax showing
	// through is acceptable here and keeps the stub honest about what it is.
	async render(
		_app: unknown,
		markdown: string,
		el: HTMLElement,
		_sourcePath: string,
		_component: unknown,
	): Promise<void> {
		el.textContent = markdown;
	},
};

export class TFile {}
export class TFolder {}
export class Component {}
export class MarkdownRenderChild {}

export class Notice {
	constructor(message: string) {
		console.info("[Notice]", message);
	}
}

export function parseYaml(): unknown {
	throw new Error("parseYaml er ikke tilgjengelig i forhåndsvisningen");
}

export function getAllTags(): string[] {
	return [];
}

export function setIcon(el: HTMLElement, icon: string): void {
	el.textContent = icon === "pencil" ? "✎" : icon;
}

/**
 * Functional enough to actually click through in the preview, not just avoid
 * a build error: dialogs (TaskModal, BlockBuilderModal) are reachable by
 * clicking a task or the edit pencil, so `open`/`close` need to really show
 * and remove content rather than no-op.
 */
export class Modal {
	titleEl: HTMLElement;
	contentEl: HTMLElement;
	private overlay: HTMLElement | null = null;

	constructor(protected app: unknown) {
		this.titleEl = document.createElement("div");
		this.titleEl.className = "cleanview-preview-modal-title";
		this.contentEl = document.createElement("div");
		this.contentEl.className = "cleanview-preview-modal-content";
	}

	open(): void {
		// Obsidian's real Modal.open() calls the subclass's onOpen() as part of
		// its own lifecycle; a stub that only builds the shell never populates
		// contentEl, so every dialog would render empty.
		(this as unknown as { onOpen?: () => void }).onOpen?.();

		this.overlay = document.createElement("div");
		this.overlay.className = "cleanview-preview-modal-overlay";
		const box = document.createElement("div");
		box.className = "cleanview-preview-modal-box";
		box.append(this.titleEl, this.contentEl);
		this.overlay.appendChild(box);
		this.overlay.addEventListener("click", (event) => {
			if (event.target === this.overlay) this.close();
		});
		document.body.appendChild(this.overlay);
	}

	close(): void {
		(this as unknown as { onClose?: () => void }).onClose?.();
		this.overlay?.remove();
		this.overlay = null;
	}
}

interface TextLike {
	inputEl: HTMLInputElement;
	setPlaceholder(text: string): TextLike;
	setValue(value: string): TextLike;
	onChange(cb: (value: string) => void): TextLike;
}

interface DropdownLike {
	addOptions(options: Record<string, string>): DropdownLike;
	setValue(value: string): DropdownLike;
	onChange(cb: (value: string) => void): DropdownLike;
}

interface ButtonLike {
	setButtonText(text: string): ButtonLike;
	setCta(): ButtonLike;
	onClick(cb: () => void): ButtonLike;
}

/** Covers the subset of Setting used by TaskModal and BlockBuilderModal. */
export class Setting {
	settingEl: HTMLElement;
	controlEl: HTMLElement;
	private nameEl: HTMLElement;
	private descEl: HTMLElement;

	constructor(containerEl: HTMLElement) {
		this.settingEl = document.createElement("div");
		this.settingEl.className = "cleanview-preview-setting";
		const info = document.createElement("div");
		this.nameEl = document.createElement("div");
		this.nameEl.className = "cleanview-preview-setting-name";
		this.descEl = document.createElement("div");
		this.descEl.className = "cleanview-preview-setting-desc";
		info.append(this.nameEl, this.descEl);
		this.controlEl = document.createElement("div");
		this.controlEl.className = "cleanview-preview-setting-control";
		this.settingEl.append(info, this.controlEl);
		containerEl.appendChild(this.settingEl);
	}

	setName(text: string): this {
		this.nameEl.textContent = text;
		return this;
	}

	setDesc(text: string): this {
		this.descEl.textContent = text;
		return this;
	}

	setHeading(): this {
		this.settingEl.classList.add("is-heading");
		return this;
	}

	addText(cb: (text: TextLike) => void): this {
		const inputEl = document.createElement("input");
		inputEl.type = "text";
		const component: TextLike = {
			inputEl,
			setPlaceholder: (text) => {
				inputEl.placeholder = text;
				return component;
			},
			setValue: (value) => {
				inputEl.value = value;
				return component;
			},
			onChange: (fn) => {
				inputEl.addEventListener("input", () => fn(inputEl.value));
				return component;
			},
		};
		this.controlEl.appendChild(inputEl);
		cb(component);
		return this;
	}

	addDropdown(cb: (dropdown: DropdownLike) => void): this {
		const selectEl = document.createElement("select");
		const component: DropdownLike = {
			addOptions: (options) => {
				for (const [value, label] of Object.entries(options)) {
					const option = document.createElement("option");
					option.value = value;
					option.textContent = label;
					selectEl.appendChild(option);
				}
				return component;
			},
			setValue: (value) => {
				selectEl.value = value;
				return component;
			},
			onChange: (fn) => {
				selectEl.addEventListener("change", () => fn(selectEl.value));
				return component;
			},
		};
		this.controlEl.appendChild(selectEl);
		cb(component);
		return this;
	}

	addToggle(cb: (toggle: { setValue(v: boolean): unknown; onChange(fn: (v: boolean) => void): unknown }) => void): this {
		const inputEl = document.createElement("input");
		inputEl.type = "checkbox";
		const component = {
			setValue: (value: boolean) => {
				inputEl.checked = value;
				return component;
			},
			onChange: (fn: (v: boolean) => void) => {
				inputEl.addEventListener("change", () => fn(inputEl.checked));
				return component;
			},
		};
		this.controlEl.appendChild(inputEl);
		cb(component);
		return this;
	}

	addButton(cb: (button: ButtonLike) => void): this {
		const buttonEl = document.createElement("button");
		const component: ButtonLike = {
			setButtonText: (text) => {
				buttonEl.textContent = text;
				return component;
			},
			setCta: () => {
				buttonEl.classList.add("mod-cta");
				return component;
			},
			onClick: (fn) => {
				buttonEl.addEventListener("click", fn);
				return component;
			},
		};
		this.controlEl.appendChild(buttonEl);
		cb(component);
		return this;
	}
}
