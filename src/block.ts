/**
 * One rendered ```puls block.
 *
 * Re-render policy, which is most of why dashboards stay responsive:
 *
 *   - A change only re-renders blocks whose `from:` scope contains the changed
 *     path. Editing a note in Skole/ leaves a Prosjekter/ block untouched.
 *   - Blocks scrolled out of view are marked dirty instead of redrawn, and
 *     catch up when they scroll back in.
 *   - The config is parsed and the query compiled once, at load.
 */

import { type App, MarkdownRenderChild } from "obsidian";
import type { VaultIndex } from "./core/index";
import { CompiledQuery, ConfigError, parseConfig } from "./query/query";
import type { BlockConfig } from "./query/query";
import { type ChartHandle, renderChart } from "./views/chart-view";
import { errorState } from "./views/render-utils";
import { renderCountdown } from "./views/countdown-view";
import { renderStat } from "./views/stat-view";
import { renderTable } from "./views/table-view";
import { renderTasks } from "./views/task-view";
import { renderText } from "./views/text-view";

export class PulsBlock extends MarkdownRenderChild {
	private config: BlockConfig | null = null;
	private query: CompiledQuery | null = null;
	private unsubscribe: (() => void) | null = null;
	private chart: ChartHandle | null = null;
	private observer: IntersectionObserver | null = null;

	private visible = true;
	private dirty = false;
	private renderedRevision = -1;

	constructor(
		containerEl: HTMLElement,
		private readonly app: App,
		private readonly index: VaultIndex,
		private readonly source: string,
		private readonly sourcePath: string,
	) {
		super(containerEl);
	}

	onload(): void {
		this.containerEl.addClass("puls-block");

		try {
			this.config = parseConfig(this.source);
			this.query = new CompiledQuery(this.config);
		} catch (error) {
			const message = error instanceof ConfigError
				? error.message
				: `Uventet feil: ${(error as Error).message}`;
			errorState(this.containerEl, message);
			return;
		}

		this.unsubscribe = this.index.subscribe((changedPaths) => this.onIndexChange(changedPaths));
		this.watchVisibility();
		this.render();
	}

	onunload(): void {
		this.unsubscribe?.();
		this.unsubscribe = null;
		this.observer?.disconnect();
		this.observer = null;
		this.chart?.dispose();
		this.chart = null;
	}

	private watchVisibility(): void {
		this.observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					this.visible = entry.isIntersecting;
					if (this.visible && this.dirty) this.render();
				}
			},
			// Start rendering slightly before the block scrolls into view.
			{ rootMargin: "200px" },
		);
		this.observer.observe(this.containerEl);
	}

	private onIndexChange(changedPaths: ReadonlySet<string> | null): void {
		if (!this.query) return;
		if (this.renderedRevision === this.index.revision) return;

		if (changedPaths) {
			let relevant = false;
			for (const path of changedPaths) {
				if (this.query.touches(path)) {
					relevant = true;
					break;
				}
			}
			if (!relevant) {
				// Still record the revision: nothing we display can have changed.
				this.renderedRevision = this.index.revision;
				return;
			}
		}

		if (!this.visible) {
			this.dirty = true;
			return;
		}
		this.render();
	}

	private render(): void {
		if (!this.config || !this.query) return;

		this.dirty = false;
		this.renderedRevision = this.index.revision;

		this.chart?.dispose();
		this.chart = null;
		this.containerEl.empty();

		if (!this.index.ready) {
			this.containerEl.createDiv({ cls: "puls-empty", text: "Building index…" });
			// build() notifies every listener when it finishes, so no polling.
			this.renderedRevision = -1;
			return;
		}

		try {
			const result = this.query.run(this.index);
			const ctx = { app: this.app, component: this, sourcePath: this.sourcePath };

			switch (this.config.view) {
				case "tasks":
					renderTasks(this.containerEl, result, this.config, ctx);
					break;
				case "table":
					renderTable(this.containerEl, result, this.config, ctx);
					break;
				case "stat":
					renderStat(this.containerEl, result, this.config);
					break;
				case "countdown":
					renderCountdown(this.containerEl, result, this.config, ctx);
					break;
				case "chart":
					this.chart = renderChart(this.containerEl, result, this.config, ctx);
					break;
				case "text":
					renderText(this.containerEl, this.config, this.index);
					break;
			}
		} catch (error) {
			console.error("Puls: render failed", error);
			errorState(this.containerEl, `Could not render this block: ${(error as Error).message}`);
		}
	}
}
