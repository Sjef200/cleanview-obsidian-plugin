/**
 * Block configuration: parse once, run many times.
 *
 * A `CompiledQuery` holds closures, not config data. Re-running it after a
 * vault change costs one filter pass and one sort, with no YAML parsing and no
 * config interpretation.
 */

import { parseYaml } from "obsidian";
import type { VaultIndex } from "../core/index";
import type { Row, Source } from "./fields";
import { type Predicate, compileFilter } from "./filter";
import { type Comparator, type Group, compileSort, groupRows } from "./sort";

export type ViewKind = "tasks" | "table" | "stat" | "chart" | "text" | "countdown";

export interface BlockConfig {
	view: ViewKind;
	title?: string;
	source: Source;
	from?: string[];
	filter?: unknown;
	sort?: unknown;
	group?: unknown;
	limit?: number;
	columns?: unknown;
	show?: string[];
	/** stat */
	value?: string;
	suffix?: string;
	prefix?: string;
	goal?: number;
	/** chart */
	type?: string;
	by?: string;
	/** text */
	format?: string;
	[key: string]: unknown;
}

export class ConfigError extends Error {}

const VIEW_ALIASES: Record<string, ViewKind> = {
	tasks: "tasks", oppgaver: "tasks", task: "tasks",
	table: "table", tabell: "table",
	stat: "stat", nøkkeltall: "stat", tall: "stat", kpi: "stat",
	chart: "chart", graf: "chart", diagram: "chart",
	text: "text", tekst: "text",
	countdown: "countdown", nedtelling: "countdown", frist: "countdown",
};

export function parseConfig(yaml: string): BlockConfig {
	let raw: unknown;
	try {
		raw = yaml.trim() ? parseYaml(yaml) : {};
	} catch (error) {
		throw new ConfigError(`Kunne ikke lese oppsettet: ${(error as Error).message}`);
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		throw new ConfigError("Oppsettet må være nøkkel/verdi-par, for eksempel `view: tasks`.");
	}

	const config = raw as Record<string, unknown>;
	const viewName = String(config.view ?? config.visning ?? "").toLowerCase();
	const view = VIEW_ALIASES[viewName];
	if (!view) {
		throw new ConfigError(
			`Ukjent visning "${config.view ?? ""}". Gyldige valg: tasks, table, stat, chart, countdown, text.`,
		);
	}

	// Charts and stats read tasks unless told otherwise; tables read files.
	const explicitSource = String(config.source ?? config.kilde ?? "").toLowerCase();
	const source: Source =
		explicitSource === "files" || explicitSource === "filer" || explicitSource === "notes"
			? "files"
			: explicitSource === "tasks" || explicitSource === "oppgaver"
				? "tasks"
				: view === "table" || view === "countdown"
					? "files"
					: "tasks";

	const from = normalizeFrom(config.from ?? config.fra);

	return {
		...config,
		view,
		source,
		from,
		title: config.title !== undefined ? String(config.title) : config.tittel !== undefined ? String(config.tittel) : undefined,
		filter: config.filter ?? config.filtrer,
		sort: config.sort ?? config.sorter,
		group: config.group ?? config.grupper,
		limit: toNumber(config.limit ?? config.grense),
	};
}

function normalizeFrom(value: unknown): string[] | undefined {
	if (value === undefined || value === null) return undefined;
	const list = (Array.isArray(value) ? value : [value])
		.map((entry) => String(entry).trim().replace(/^\/+|\/+$/g, ""))
		.filter((entry) => entry.length > 0);
	return list.length > 0 ? list : undefined;
}

function toNumber(value: unknown): number | undefined {
	if (value === undefined || value === null) return undefined;
	const n = Number(value);
	return Number.isFinite(n) ? n : undefined;
}

export interface QueryResult {
	rows: Row[];
	groups: Group[] | null;
	/** Rows matched before `limit` was applied. */
	total: number;
}

export class CompiledQuery {
	private readonly predicate: Predicate | null;
	private readonly comparator: Comparator | null;
	private readonly folderPrefixes: string[] | null;

	constructor(private readonly config: BlockConfig) {
		this.predicate = compileFilter(config.filter, config.source);
		this.comparator = compileSort(config.sort, config.source);
		this.folderPrefixes = config.from?.map((f) => `${f}/`) ?? null;
	}

	/** True when a change to `path` could affect this query's result. */
	touches(path: string): boolean {
		if (!this.folderPrefixes) return true;
		return this.folderPrefixes.some((prefix) => path.startsWith(prefix));
	}

	run(index: VaultIndex): QueryResult {
		const all: readonly Row[] =
			this.config.source === "tasks" ? index.allTasks() : index.allFiles();

		const rows: Row[] = [];
		for (const row of all) {
			if (this.folderPrefixes && !this.inScope(row)) continue;
			if (this.predicate && !this.predicate(row)) continue;
			rows.push(row);
		}

		if (this.comparator) rows.sort(this.comparator);

		const total = rows.length;
		const limited =
			this.config.limit !== undefined && rows.length > this.config.limit
				? rows.slice(0, this.config.limit)
				: rows;

		return { rows: limited, groups: groupRows(limited, this.config.group, this.config.source), total };
	}

	private inScope(row: Row): boolean {
		const path = (row as { path: string }).path;
		if (!this.folderPrefixes) return true;
		for (const prefix of this.folderPrefixes) {
			// A bare folder name also matches the folder note itself.
			if (path.startsWith(prefix) || path === prefix.slice(0, -1)) return true;
		}
		return false;
	}
}
