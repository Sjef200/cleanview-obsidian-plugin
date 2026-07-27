/**
 * DEV ONLY — never bundled into the plugin.
 *
 * Obsidian augments HTMLElement with helpers like `createDiv` and `addClass`.
 * The view layer uses them because they are the platform idiom, which means the
 * views cannot render in a plain browser without them. This adds just enough of
 * that surface for `preview/` to exercise the real view code.
 *
 * The chart layer deliberately avoids these helpers and needs no shim.
 */

interface ElOptions {
	cls?: string | string[];
	text?: string;
	type?: string;
	attr?: Record<string, string>;
}

function applyOptions(el: HTMLElement, options?: ElOptions): HTMLElement {
	if (!options) return el;
	if (options.cls) {
		const classes = Array.isArray(options.cls) ? options.cls : options.cls.split(/\s+/);
		el.classList.add(...classes.filter(Boolean));
	}
	if (options.text !== undefined) el.textContent = options.text;
	if (options.type) el.setAttribute("type", options.type);
	if (options.attr) {
		for (const [key, value] of Object.entries(options.attr)) el.setAttribute(key, value);
	}
	return el;
}

export function installObsidianShim(): void {
	const proto = HTMLElement.prototype as unknown as Record<string, unknown>;

	proto.createEl = function (tag: string, options?: ElOptions) {
		const el = document.createElement(tag);
		applyOptions(el, options);
		(this as unknown as HTMLElement).appendChild(el);
		return el;
	};
	proto.createDiv = function (options?: ElOptions) {
		return (this as unknown as { createEl: (t: string, o?: ElOptions) => HTMLElement })
			.createEl("div", options);
	};
	proto.createSpan = function (options?: ElOptions) {
		return (this as unknown as { createEl: (t: string, o?: ElOptions) => HTMLElement })
			.createEl("span", options);
	};
	proto.empty = function () {
		(this as unknown as HTMLElement).replaceChildren();
	};
	proto.addClass = function (...classes: string[]) {
		(this as unknown as HTMLElement).classList.add(...classes);
	};
	proto.removeClass = function (...classes: string[]) {
		(this as unknown as HTMLElement).classList.remove(...classes);
	};
	proto.toggleClass = function (classes: string, on: boolean) {
		(this as unknown as HTMLElement).classList.toggle(classes, on);
	};
	proto.setText = function (text: string) {
		(this as unknown as HTMLElement).textContent = text;
	};
	proto.setAttr = function (name: string, value: string) {
		(this as unknown as HTMLElement).setAttribute(name, value);
	};

	// Obsidian also exposes detached-element constructors as globals. The chart
	// layer uses these, so the preview must provide them to exercise real code.
	const globals = globalThis as unknown as Record<string, unknown>;

	globals.createEl = (tag: string, options?: ElOptions) =>
		applyOptions(document.createElement(tag), options);
	globals.createDiv = (options?: ElOptions) =>
		applyOptions(document.createElement("div"), options);
	globals.createSpan = (options?: ElOptions) =>
		applyOptions(document.createElement("span"), options);

	globals.createSvg = (tag: string, options?: ElOptions) => {
		const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
		if (options?.cls) {
			const classes = Array.isArray(options.cls) ? options.cls : options.cls.split(/\s+/);
			el.setAttribute("class", classes.filter(Boolean).join(" "));
		}
		if (options?.attr) {
			for (const [key, value] of Object.entries(options.attr)) el.setAttribute(key, value);
		}
		return el;
	};
}
