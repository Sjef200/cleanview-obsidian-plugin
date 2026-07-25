/**
 * The only code in the plugin that modifies your notes.
 *
 * Two safety rules govern everything here:
 *
 *   1. Never write a line we cannot re-identify. The index can lag behind an
 *      edit made in another pane, and a stale line number would otherwise tick
 *      the wrong task. Every write re-reads the file and verifies the target
 *      line still looks like the task we indexed before touching it.
 *
 *   2. Change exactly one line. `Vault.process` gives us an atomic
 *      read-modify-write, so a dashboard click can never clobber concurrent
 *      edits elsewhere in the same file.
 */

import { type App, Notice, TFile } from "obsidian";
import type { PulsTask } from "./types";
import { formatISO, today } from "./dates";

const CHECKBOX = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(]\s*)/;
const DONE_DATE = /\s*✅\s*\d{4}-\d{2}-\d{2}/u;

export async function toggleTaskInFile(app: App, task: PulsTask): Promise<void> {
	const file = app.vault.getFileByPath(task.path);
	if (!(file instanceof TFile)) {
		new Notice(`Puls: fant ikke «${task.path}»`);
		return;
	}

	let failure: string | null = null;

	await app.vault.process(file, (data) => {
		const lines = data.split("\n");
		const index = locateTask(lines, task);

		if (index === null) {
			failure = "Oppgaven har flyttet seg siden siden ble tegnet. Ingenting ble endret.";
			return data;
		}

		lines[index] = toggleLine(lines[index]);
		return lines.join("\n");
	});

	if (failure) new Notice(`Puls: ${failure}`, 6000);
}

/**
 * Finds the task's current line.
 *
 * Tries the indexed line number first, then searches nearby lines for an
 * identical checkbox line. Returns null when the match is ambiguous or absent,
 * which is treated as "do nothing".
 */
function locateTask(lines: string[], task: PulsTask): number | null {
	const expected = task.raw.trim();

	if (matchesTask(lines[task.line], expected)) return task.line;

	// The file was edited above this task; look for it in a small window before
	// giving up. A wider search risks matching a genuine duplicate elsewhere.
	const WINDOW = 25;
	const candidates: number[] = [];
	for (let offset = 1; offset <= WINDOW; offset++) {
		for (const index of [task.line - offset, task.line + offset]) {
			if (index < 0 || index >= lines.length) continue;
			if (matchesTask(lines[index], expected)) candidates.push(index);
		}
		// Stop at the first distance that yields a hit, so the nearest wins.
		if (candidates.length > 0) break;
	}

	return candidates.length === 1 ? candidates[0] : null;
}

function matchesTask(line: string | undefined, expectedBody: string): boolean {
	if (line === undefined) return false;
	const match = CHECKBOX.exec(line);
	if (!match) return false;
	return line.slice(match[0].length).trim() === expectedBody;
}

function toggleLine(line: string): string {
	const match = CHECKBOX.exec(line);
	if (!match) return line;

	const wasDone = match[2] !== " ";
	const body = line.slice(match[0].length);

	if (wasDone) {
		// Un-completing removes the completion date, matching Tasks' behaviour.
		const cleaned = body.replace(DONE_DATE, "").trimEnd();
		return `${match[1]} ${match[3]}${cleaned}`;
	}

	const withoutStaleDate = body.replace(DONE_DATE, "").trimEnd();
	return `${match[1]}x${match[3]}${withoutStaleDate} ✅ ${formatISO(today())}`;
}
