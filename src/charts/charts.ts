/**
 * The three chart forms, drawn by hand in SVG.
 *
 * Colour discipline (see the project README for the reasoning):
 *   - Chart *chrome* — surface, gridlines, ink — inherits the user's Obsidian
 *     theme through CSS variables, so charts look native under any theme.
 *   - *Series* colours come from a fixed palette validated for colour-vision
 *     deficiency in both light and dark mode. Theme accent colours are not used
 *     for data, because a theme author never checked them for that.
 *   - Text always wears text tokens, never a series colour.
 */

import { type Box, Tooltip, arcPath, barPath, linePath, niceTicks, plotArea, svgEl } from "./svg";

export interface Datum {
	label: string;
	value: number;
	/** Numeric key for ordered axes (day numbers for time series). */
	sortKey?: number;
	/** Optional richer label for tooltips. */
	detail?: string;
}

/** Max donut segments before the tail folds into "Other". */
const DONUT_MAX = 6;

const CSS = {
	surface: "var(--cleanview-surface)",
	grid: "var(--cleanview-grid)",
	muted: "var(--cleanview-muted)",
	ink: "var(--cleanview-ink)",
	series: (i: number) => `var(--cleanview-series-${(i % 8) + 1})`,
};

// ---------------------------------------------------------------- horizontal bar

/**
 * Horizontal bars: the right default for dashboards, because category names are
 * text of unpredictable length and horizontal bars read them without rotating
 * labels or clipping them.
 */
export function renderBar(
	host: HTMLElement,
	svg: SVGSVGElement,
	data: Datum[],
	width: number,
	tooltip: Tooltip,
	formatValue: (n: number) => string,
): number {
	const ROW = 26;
	const THICK = 18; // <= 24px per the mark spec, leaving air in the band.
	const labelWidth = Math.min(180, Math.max(80, Math.round(width * 0.3)));
	const valueWidth = 56;

	const box: Box = {
		width,
		height: data.length * ROW + 8,
		top: 4, right: valueWidth, bottom: 4, left: labelWidth + 12,
	};
	const area = plotArea(box);
	svg.setAttribute("width", String(width));
	svg.setAttribute("height", String(box.height));

	const max = Math.max(...data.map((d) => d.value), 0);
	if (max <= 0) return box.height;

	data.forEach((datum, i) => {
		const y = box.top + i * ROW;
		const barY = y + (ROW - THICK) / 2;
		const w = Math.max(2, (datum.value / max) * area.w);

		const label = svgEl(svg, "text", {
			x: labelWidth, y: y + ROW / 2, fill: CSS.muted,
			"text-anchor": "end", "dominant-baseline": "central", class: "cleanview-axis-text",
		});
		label.textContent = datum.label;
		fitText(label, labelWidth - 4);

		const mark = svgEl(svg, "path", {
			d: barPath(area.x, barY, w, THICK, 4, true),
			fill: CSS.series(0), class: "cleanview-mark",
		});

		const value = svgEl(svg, "text", {
			x: area.x + w + 8, y: y + ROW / 2, fill: CSS.muted,
			"dominant-baseline": "central", class: "cleanview-axis-text cleanview-tabular",
		});
		value.textContent = formatValue(datum.value);

		// Full-row hit target, so hovering the label works too.
		const hit = svgEl(svg, "rect", {
			x: 0, y, width, height: ROW, fill: "transparent", class: "cleanview-hit",
		});
		bindTooltip(
			hit, host, tooltip,
			() => [datum.label, `${formatValue(datum.value)}${datum.detail ? ` · ${datum.detail}` : ""}`],
			mark,
		);
	});

	return box.height;
}

// -------------------------------------------------------------------- line

export function renderLine(
	host: HTMLElement,
	svg: SVGSVGElement,
	data: Datum[],
	width: number,
	tooltip: Tooltip,
	formatValue: (n: number) => string,
): number {
	const box: Box = { width, height: 200, top: 12, right: 16, bottom: 26, left: 44 };
	const area = plotArea(box);
	svg.setAttribute("width", String(width));
	svg.setAttribute("height", String(box.height));

	if (data.length === 0) return box.height;

	const max = Math.max(...data.map((d) => d.value), 0);
	const ticks = niceTicks(max);
	const top = ticks[ticks.length - 1] || 1;

	// Gridlines and y labels first, so marks paint over them.
	for (const tick of ticks) {
		const y = area.y + area.h - (tick / top) * area.h;
		svgEl(svg, "line", {
			x1: area.x, y1: y, x2: area.x + area.w, y2: y,
			stroke: CSS.grid, "stroke-width": 1, "shape-rendering": "crispEdges",
		});
		const label = svgEl(svg, "text", {
			x: area.x - 8, y, fill: CSS.muted,
			"text-anchor": "end", "dominant-baseline": "central",
			class: "cleanview-axis-text cleanview-tabular",
		});
		label.textContent = formatValue(tick);
	}

	const xAt = (i: number) =>
		data.length === 1 ? area.x + area.w / 2 : area.x + (i / (data.length - 1)) * area.w;
	const yAt = (value: number) => area.y + area.h - (value / top) * area.h;
	const points = data.map((d, i) => ({ x: xAt(i), y: yAt(d.value) }));

	// Area wash at ~10%, then the line on top.
	const areaPath = `${linePath(points)}L${points[points.length - 1].x} ${area.y + area.h}L${points[0].x} ${area.y + area.h}Z`;
	svgEl(svg, "path", { d: areaPath, fill: CSS.series(0), opacity: 0.1 });
	svgEl(svg, "path", {
		d: linePath(points), fill: "none", stroke: CSS.series(0),
		"stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round",
	});

	// End marker: >= 8px with a 2px surface ring so it stays legible.
	const last = points[points.length - 1];
	svgEl(svg, "circle", {
		cx: last.x, cy: last.y, r: 4,
		fill: CSS.series(0), stroke: CSS.surface, "stroke-width": 2,
	});

	// X labels: first and last always, plus interior ones only if they fit.
	// An interior label must clear a full step from the final label, or the two
	// collide at the right edge.
	const step = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(width / 90))));
	data.forEach((datum, i) => {
		const isEdge = i === 0 || i === data.length - 1;
		if (!isEdge && i % step !== 0) return;
		if (!isEdge && (data.length - 1 - i < step || i < step)) return;
		const label = svgEl(svg, "text", {
			x: xAt(i), y: box.height - 8, fill: CSS.muted,
			"text-anchor": i === 0 ? "start" : i === data.length - 1 ? "end" : "middle",
			class: "cleanview-axis-text",
		});
		label.textContent = datum.label;
	});

	attachCrosshair(host, svg, area, data, points, tooltip, formatValue);
	return box.height;
}

/** Crosshair + tooltip tracking the nearest point. */
function attachCrosshair(
	host: HTMLElement,
	svg: SVGSVGElement,
	area: { x: number; y: number; w: number; h: number },
	data: Datum[],
	points: Array<{ x: number; y: number }>,
	tooltip: Tooltip,
	formatValue: (n: number) => string,
): void {
	const rule = svgEl(svg, "line", {
		y1: area.y, y2: area.y + area.h, stroke: CSS.grid,
		"stroke-width": 1, opacity: 0, "shape-rendering": "crispEdges",
	});
	const dot = svgEl(svg, "circle", {
		r: 4, fill: CSS.series(0), stroke: CSS.surface, "stroke-width": 2, opacity: 0,
	});

	const hit = svgEl(svg, "rect", {
		x: area.x, y: area.y, width: area.w, height: area.h, fill: "transparent",
	});

	hit.addEventListener("pointermove", (event) => {
		const bounds = svg.getBoundingClientRect();
		const x = event.clientX - bounds.left;

		let nearest = 0;
		let bestDistance = Infinity;
		for (let i = 0; i < points.length; i++) {
			const distance = Math.abs(points[i].x - x);
			if (distance < bestDistance) {
				bestDistance = distance;
				nearest = i;
			}
		}

		const point = points[nearest];
		rule.setAttribute("x1", String(point.x));
		rule.setAttribute("x2", String(point.x));
		rule.setAttribute("opacity", "1");
		dot.setAttribute("cx", String(point.x));
		dot.setAttribute("cy", String(point.y));
		dot.setAttribute("opacity", "1");

		const hostBounds = host.getBoundingClientRect();
		tooltip.show(
			host,
			point.x + (bounds.left - hostBounds.left),
			point.y + (bounds.top - hostBounds.top) - 12,
			[data[nearest].label, formatValue(data[nearest].value)],
		);
	});

	hit.addEventListener("pointerleave", () => {
		rule.setAttribute("opacity", "0");
		dot.setAttribute("opacity", "0");
		tooltip.hide();
	});
}

// ------------------------------------------------------------------- donut

export function renderDonut(
	host: HTMLElement,
	svg: SVGSVGElement,
	rawData: Datum[],
	width: number,
	tooltip: Tooltip,
	formatValue: (n: number) => string,
	centreLabel?: string,
): number {
	// Past six segments, colours stop being distinguishable. Fold the tail
	// rather than inventing a ninth hue.
	const data = foldTail(rawData, DONUT_MAX);
	const total = data.reduce((sum, d) => sum + d.value, 0);

	const size = Math.min(200, width);
	const legendRows = data.length;
	const height = Math.max(size, legendRows * 22 + 8);

	svg.setAttribute("width", String(width));
	svg.setAttribute("height", String(height));

	if (total <= 0) return height;

	const cx = size / 2;
	const cy = height / 2;
	const outer = size / 2 - 4;
	const inner = outer * 0.62;
	// A 2px surface gap expressed as an angle at the outer radius.
	const gap = Math.min(0.06, 2 / outer);

	let angle = -Math.PI / 2;
	data.forEach((datum, i) => {
		const sweep = (datum.value / total) * Math.PI * 2;
		const useGap = sweep > gap * 3;
		const from = angle + (useGap ? gap / 2 : 0);
		const to = angle + sweep - (useGap ? gap / 2 : 0);

		const path = svgEl(svg, "path", {
			d: arcPath(cx, cy, outer, inner, from, to),
			fill: CSS.series(i), class: "cleanview-mark",
		});
		bindTooltip(
			path, host, tooltip,
			() => [datum.label, `${formatValue(datum.value)} · ${Math.round((datum.value / total) * 100)} %`],
			path,
		);

		angle += sweep;
	});

	// Hero number in the hole: ink, never a series colour.
	const totalText = svgEl(svg, "text", {
		x: cx, y: cy - 4, fill: CSS.ink,
		"text-anchor": "middle", "dominant-baseline": "central", class: "cleanview-donut-total",
	});
	totalText.textContent = formatValue(total);

	if (centreLabel) {
		const sub = svgEl(svg, "text", {
			x: cx, y: cy + 14, fill: CSS.muted,
			"text-anchor": "middle", "dominant-baseline": "central", class: "cleanview-axis-text",
		});
		sub.textContent = centreLabel;
		fitText(sub, inner * 1.8);
	}

	// Legend: identity never rests on colour alone.
	const legendX = size + 16;
	const legendTop = (height - legendRows * 22) / 2 + 11;
	data.forEach((datum, i) => {
		const y = legendTop + i * 22;
		svgEl(svg, "rect", {
			x: legendX, y: y - 5, width: 10, height: 10, rx: 3, fill: CSS.series(i),
		});
		const label = svgEl(svg, "text", {
			x: legendX + 18, y, fill: CSS.muted,
			"dominant-baseline": "central", class: "cleanview-axis-text",
		});
		label.textContent = datum.label;
		fitText(label, Math.max(40, width - legendX - 70));

		const value = svgEl(svg, "text", {
			x: width - 4, y, fill: CSS.muted, "text-anchor": "end",
			"dominant-baseline": "central", class: "cleanview-axis-text cleanview-tabular",
		});
		value.textContent = formatValue(datum.value);
	});

	return height;
}

function foldTail(data: Datum[], max: number): Datum[] {
	if (data.length <= max) return data;
	const sorted = [...data].sort((a, b) => b.value - a.value);
	const head = sorted.slice(0, max - 1);
	const tail = sorted.slice(max - 1);
	head.push({
		label: `Other (${tail.length})`,
		value: tail.reduce((sum, d) => sum + d.value, 0),
	});
	return head;
}

// ------------------------------------------------------------------ shared

/**
 * Wires hover feedback for one mark.
 *
 * The highlight is applied in script rather than by a CSS `:hover` rule,
 * because the pointer target is usually a transparent hit rectangle covering
 * the mark — so the mark itself never receives `:hover`, and a sibling selector
 * cannot reach it either (the hit rect is painted last, on top).
 */
function bindTooltip(
	target: SVGElement,
	host: HTMLElement,
	tooltip: Tooltip,
	lines: () => string[],
	mark?: SVGElement,
): void {
	const place = (event: PointerEvent) => {
		const bounds = host.getBoundingClientRect();
		tooltip.show(host, event.clientX - bounds.left, event.clientY - bounds.top - 12, lines());
	};

	target.addEventListener("pointerenter", (event) => {
		host.classList.add("has-active");
		mark?.classList.add("is-active");
		place(event);
	});
	target.addEventListener("pointermove", place);
	target.addEventListener("pointerleave", () => {
		host.classList.remove("has-active");
		mark?.classList.remove("is-active");
		tooltip.hide();
	});
}

/**
 * Trims text to fit, with an ellipsis. Labels are never clipped by the mark:
 * a cropped first character is worse than a shortened word.
 */
function fitText(el: SVGTextElement, maxWidth: number): void {
	const full = el.textContent ?? "";
	if (!full || maxWidth <= 0) return;
	// getComputedTextLength needs the element laid out; it is already appended.
	if (el.getComputedTextLength() <= maxWidth) return;

	let low = 0;
	let high = full.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		el.textContent = `${full.slice(0, mid)}…`;
		if (el.getComputedTextLength() <= maxWidth) low = mid;
		else high = mid - 1;
	}
	el.textContent = low > 0 ? `${full.slice(0, low)}…` : "…";
	el.setAttribute("aria-label", full);
}
