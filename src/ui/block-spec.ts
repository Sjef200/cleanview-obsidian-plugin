/**
 * The shape of a block the builder can produce, and the code that renders it.
 *
 * Deliberately free of Obsidian imports so it can be tested in plain Node: a
 * builder that emits a block the plugin itself rejects would be embarrassing,
 * and that is exactly what these tests rule out.
 */

export type ViewChoice = "tasks" | "table" | "stat" | "chart" | "countdown";

export interface BuilderState {
	view: ViewChoice;
	title: string;
	/** "" means the whole vault. */
	folder: string;
	/** "" means no tag filter. */
	tag: string;
	status: "open" | "done" | "all";
	due: "any" | "overdue" | "today" | "week" | "month" | "none";
	group: "none" | "file" | "folder" | "priority";
	chartType: "bar" | "line" | "donut";
	by: "folder" | "priority" | "due" | "status";
	measure: "openTasks" | "allTasks" | "notes";
}

export const DEFAULT_STATE: BuilderState = {
	view: "tasks",
	title: "",
	folder: "",
	tag: "",
	status: "open",
	due: "any",
	group: "none",
	chartType: "bar",
	by: "folder",
	measure: "openTasks",
};

const DUE_FILTER: Record<BuilderState["due"], string | null> = {
	any: null,
	overdue: "overdue",
	today: "{ to: today }",
	week: "{ to: today+7d }",
	month: "{ to: today+1m }",
	none: "none",
};

/**
 * Renders the block. Pure, so the preview and the inserted text can never
 * disagree, and so it can be tested outside Obsidian.
 */
export function buildBlock(state: BuilderState): string {
	const lines: string[] = ["```cleanview"];
	const push = (line: string) => lines.push(line);

	push(`view: ${state.view}`);
	if (state.view === "chart") push(`type: ${state.chartType}`);
	if (state.title.trim()) push(`title: ${state.title.trim()}`);
	if (state.folder) push(`from: ${state.folder}`);

	// Notes are the natural subject for these two; everything else counts tasks.
	const overNotes = state.view === "table" || state.view === "countdown"
		|| (state.view === "stat" && state.measure === "notes");
	if (overNotes) push("source: files");

	const filters: string[] = [];
	if (!overNotes) {
		if (state.status === "open") filters.push("  done: false");
		else if (state.status === "done") filters.push("  done: true");

		const due = DUE_FILTER[state.due];
		if (due) filters.push(`  due: ${due}`);
	}
	if (state.tag.trim()) {
		filters.push(`  tags: { has: ${state.tag.trim().replace(/^#/, "")} }`);
	}
	if (filters.length > 0) {
		push("filter:");
		for (const line of filters) push(line);
	}

	switch (state.view) {
		case "tasks":
			push("sort: [priority desc, due asc]");
			if (state.group !== "none") push(`group: ${state.group}`);
			break;
		case "table":
			push("sort: [mtime desc]");
			push("limit: 15");
			break;
		case "stat":
			// The measure is already expressed by `source` and the done filter,
			// so the aggregate itself is always a count.
			push("value: count");
			break;
		case "chart":
			push(`by: ${state.by}`);
			push("value: count");
			break;
		case "countdown":
			push("sort: [due asc]");
			break;
	}

	push("```");
	return lines.join("\n") + "\n";
}

/** Everything the dialog can express, expressed as YAML keys it may emit. */
const DUE_FROM_FILTER: Record<string, BuilderState["due"]> = {
	"overdue": "overdue",
	"{ to: today }": "today",
	"{ to: today+7d }": "week",
	"{ to: today+1m }": "month",
	"none": "none",
};

/**
 * Reads a block back into dialog state, or returns null if the dialog could
 * not reproduce it exactly.
 *
 * The check is a round trip rather than a list of rules: whatever this function
 * guesses is fed straight back through `buildBlock`, and the result must match
 * the original character for character. Anything hand-tuned — an operator the
 * dialog does not offer, a custom column list, an extra key — fails that
 * comparison, and the caller then leaves the block alone instead of silently
 * rewriting it into something simpler.
 */
export function toBuilderState(block: string): BuilderState | null {
	const lines = block.trim().split("\n");
	if (lines[0] !== "```cleanview" || lines[lines.length - 1] !== "```") return null;

	// Absence is meaningful when reading: no `done:` line means the block asks
	// for both states, whereas the dialog's own default is "not done". Starting
	// from the dialog default would invent a filter the block does not have.
	const state: BuilderState = { ...DEFAULT_STATE, status: "all" };
	const body = lines.slice(1, -1);

	let inFilter = false;
	for (const line of body) {
		if (line.startsWith("  ")) {
			if (!inFilter) return null;
			const entry = line.trim();
			if (entry === "done: false") state.status = "open";
			else if (entry === "done: true") state.status = "done";
			else if (entry.startsWith("due: ")) {
				const due = DUE_FROM_FILTER[entry.slice(5)];
				if (!due) return null;
				state.due = due;
			} else if (entry.startsWith("tags: { has: ")) {
				state.tag = entry.slice(13, -2);
			} else return null;
			continue;
		}
		inFilter = false;

		const [key, ...rest] = line.split(": ");
		const value = rest.join(": ");
		switch (key) {
			case "view": state.view = value as ViewChoice; break;
			case "type": state.chartType = value as BuilderState["chartType"]; break;
			case "title": state.title = value; break;
			case "from": state.folder = value; break;
			case "by": state.by = value as BuilderState["by"]; break;
			case "group": state.group = value as BuilderState["group"]; break;
			case "filter:": case "filter": inFilter = true; break;
			// Emitted unconditionally by buildBlock; carries no dialog state.
			case "source": case "sort": case "value": case "limit": break;
			default: return null;
		}
		if (line === "filter:") inFilter = true;
	}

	// `source: files` on a stat block is the only trace of "count notes".
	if (state.view === "stat" && body.includes("source: files")) {
		state.measure = "notes";
		state.status = "all";
	}

	return buildBlock(state).trim() === block.trim() ? state : null;
}
