/**
 * Minimal SVG toolkit. No dependencies, no innerHTML.
 *
 * Charts are drawn at real pixel size rather than scaled through a viewBox, so
 * text stays at its intended size and stroke widths stay crisp. A ResizeObserver
 * redraws on width changes.
 *
 * This module and `charts.ts` use only standard DOM APIs — never Obsidian's
 * `createDiv`/`addClass` element extensions. That keeps the drawing layer
 * runnable in a plain browser, which is what makes `preview/` a real test of
 * this code rather than a lookalike.
 */

const NS = "http://www.w3.org/2000/svg";

export function svgEl<K extends keyof SVGElementTagNameMap>(
	parent: Element,
	tag: K,
	attrs?: Record<string, string | number>,
): SVGElementTagNameMap[K] {
	const el = document.createElementNS(NS, tag);
	if (attrs) {
		for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
	}
	parent.appendChild(el);
	return el;
}

export interface Box {
	width: number;
	height: number;
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export function plotArea(box: Box): { x: number; y: number; w: number; h: number } {
	return {
		x: box.left,
		y: box.top,
		w: Math.max(1, box.width - box.left - box.right),
		h: Math.max(1, box.height - box.top - box.bottom),
	};
}

/**
 * Picks axis ticks at 1/2/5 x 10^n, so labels read as round numbers.
 */
export function niceTicks(max: number, target = 4): number[] {
	if (!Number.isFinite(max) || max <= 0) return [0];
	const rough = max / target;
	const magnitude = 10 ** Math.floor(Math.log10(rough));
	const normalized = rough / magnitude;
	const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;

	const ticks: number[] = [];
	for (let value = 0; value <= max + step * 0.001; value += step) ticks.push(value);
	return ticks;
}

/** Rounded rect path with a square baseline edge, per the mark spec. */
export function barPath(
	x: number, y: number, w: number, h: number, radius: number, horizontal: boolean,
): string {
	const r = Math.max(0, Math.min(radius, horizontal ? w : h, (horizontal ? h : w) / 2));
	if (r === 0) return `M${x} ${y}h${w}v${h}h${-w}Z`;

	if (horizontal) {
		// Rounded on the right (the data end), square on the left (the baseline).
		return `M${x} ${y}h${w - r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - r)}Z`;
	}
	// Rounded on top, square at the bottom.
	return `M${x} ${y + r}a${r} ${r} 0 0 1 ${r} ${-r}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - r}h${-w}Z`;
}

export function linePath(points: Array<{ x: number; y: number }>): string {
	if (points.length === 0) return "";
	let d = `M${points[0].x} ${points[0].y}`;
	for (let i = 1; i < points.length; i++) d += `L${points[i].x} ${points[i].y}`;
	return d;
}

export function arcPath(
	cx: number, cy: number, outer: number, inner: number, from: number, to: number,
): string {
	const large = to - from > Math.PI ? 1 : 0;
	const x1 = cx + outer * Math.cos(from);
	const y1 = cy + outer * Math.sin(from);
	const x2 = cx + outer * Math.cos(to);
	const y2 = cy + outer * Math.sin(to);
	const x3 = cx + inner * Math.cos(to);
	const y3 = cy + inner * Math.sin(to);
	const x4 = cx + inner * Math.cos(from);
	const y4 = cy + inner * Math.sin(from);
	return [
		`M${x1} ${y1}`,
		`A${outer} ${outer} 0 ${large} 1 ${x2} ${y2}`,
		`L${x3} ${y3}`,
		`A${inner} ${inner} 0 ${large} 0 ${x4} ${y4}`,
		"Z",
	].join(" ");
}

/**
 * A single tooltip element reused across every chart on the page.
 *
 * Creating one node per data point would be the obvious approach and the wrong
 * one: a dashboard with several hundred marks would pay for hundreds of idle
 * DOM nodes.
 */
export class Tooltip {
	private el: HTMLElement | null = null;

	show(host: HTMLElement, x: number, y: number, lines: string[]): void {
		if (!this.el) {
			this.el = document.createElement("div");
			this.el.className = "cleanview-tooltip";
		}
		// The coordinates are relative to `host`, so the tooltip has to live
		// inside it. A shared Tooltip instance moves between hosts rather than
		// staying parented to whichever chart happened to use it first.
		if (this.el.parentElement !== host) host.appendChild(this.el);

		const children = lines.map((line, i) => {
			const div = document.createElement("div");
			div.className = i === 0 ? "cleanview-tooltip-head" : "cleanview-tooltip-line";
			div.textContent = line;
			return div;
		});
		this.el.replaceChildren(...children);

		this.el.style.left = `${x}px`;
		this.el.style.top = `${y}px`;
		this.el.classList.add("is-visible");
	}

	hide(): void {
		this.el?.classList.remove("is-visible");
	}

	destroy(): void {
		this.el?.remove();
		this.el = null;
	}
}

/**
 * Calls `render` with the element's current width, and again when it changes.
 * Returns a disposer.
 */
export function onWidth(el: HTMLElement, render: (width: number) => void): () => void {
	let last = -1;
	let frame: number | null = null;

	const run = () => {
		frame = null;
		const width = Math.max(240, Math.floor(el.clientWidth));
		// Sub-pixel jitter from scrollbars should not trigger a redraw.
		if (Math.abs(width - last) < 4) return;
		last = width;
		render(width);
	};

	const observer = new ResizeObserver(() => {
		if (frame !== null) return;
		frame = window.requestAnimationFrame(run);
	});
	observer.observe(el);
	run();

	return () => {
		observer.disconnect();
		if (frame !== null) window.cancelAnimationFrame(frame);
	};
}
