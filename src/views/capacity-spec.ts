/**
 * The arithmetic behind the capacity view. Pure — no Obsidian imports — so it
 * is covered by the plain-Node test suite, matching the split already used by
 * block-spec.ts (calculation) vs block-builder.ts (DOM) and task-spec.ts vs
 * task-modal.ts.
 *
 *   view: capacity
 *   until: 2026-11-21
 *   budget: { sleep: 8, transport: 3, meals: 2, social: 4, leisure: 4 }
 *
 * The number this produces is a ratio, not a promise: "your estimated work is
 * 78% of the time you have left," never a fabricated "you're short by 6.2
 * hours." Estimates are guesses, and the honest framing says so — see
 * `unestimatedCount` below, which the view surfaces as a visible caveat
 * rather than silently treating unestimated tasks as zero-cost.
 */

import type { CleanViewTask } from "../core/types";

export interface CapacityResult {
	daysLeft: number;
	/** 24 minus the committed budget, clamped to [0, 24]. */
	hoursPerDay: number;
	availableHours: number;
	estimatedHours: number;
	/** Matched tasks with no estimate at all — not counted as zero, just absent. */
	unestimatedCount: number;
	/**
	 * estimatedHours / availableHours × 100. `Infinity` when there is real
	 * estimated work but zero available hours — a genuine "impossible" state,
	 * not a divide-by-zero accident. 0 when both are zero (nothing to do,
	 * nothing to do it in — not a NaN).
	 */
	percent: number;
}

export function computeCapacity(
	today: number,
	until: number,
	budget: Record<string, number>,
	rows: readonly CleanViewTask[],
): CapacityResult {
	const daysLeft = Math.max(0, until - today);

	const committed = Object.values(budget).reduce((sum, hours) => sum + hours, 0);
	const hoursPerDay = Math.max(0, Math.min(24, 24 - committed));
	const availableHours = hoursPerDay * daysLeft;

	let estimatedHours = 0;
	let unestimatedCount = 0;
	for (const row of rows) {
		if (row.estimate === undefined) unestimatedCount++;
		else estimatedHours += row.estimate;
	}

	const percent =
		availableHours > 0 ? (estimatedHours / availableHours) * 100 : estimatedHours > 0 ? Infinity : 0;

	return { daysLeft, hoursPerDay, availableHours, estimatedHours, unestimatedCount, percent };
}

/**
 * Coerces the `budget:` YAML mapping into finite numbers, dropping anything
 * that is not one — a typo'd value should not silently poison the whole
 * calculation with a NaN that propagates into every downstream figure.
 */
export function normalizeBudget(raw: unknown): Record<string, number> {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
	const out: Record<string, number> = {};
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		const hours = Number(value);
		if (Number.isFinite(hours)) out[key] = hours;
	}
	return out;
}
