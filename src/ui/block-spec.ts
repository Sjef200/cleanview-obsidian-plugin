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
