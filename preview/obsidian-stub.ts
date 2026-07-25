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
