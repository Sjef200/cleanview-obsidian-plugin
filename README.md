# CleanView

Fast, fully local dashboards for [Obsidian](https://obsidian.md). Task lists,
tables, key figures, countdowns and hand-drawn SVG charts, in a ` ```cleanview `
code block.

It reads the task syntax you already use — both the Tasks plugin's emoji
shorthand and Dataview's inline fields — so it drops into an existing vault
without rewriting anything.

```cleanview
view: tasks
title: Due today
filter:
  done: false
  due: { to: today }
sort: [priority desc, due asc]
```

## How it works

Four design choices account for most of its behaviour:

1. **It reuses Obsidian's `metadataCache`** rather than building a second index
   of its own. Frontmatter, tags and checkbox state are already parsed and in
   memory, so CleanView reads that structure instead of parsing markdown again.
2. **It only reads files that actually contain tasks.** The cache reports which
   files have checkboxes before anything is read from disk. A vault of 5000
   notes where 200 contain tasks performs 200 reads, not 5000.
3. **Editing costs no I/O.** `metadataCache.on("changed")` passes the new file
   contents as an argument, so re-indexing an edited note reads nothing.
4. **Nothing is interpreted per row.** Filters and sorts compile to closures
   once, when the block loads, instead of being walked as configuration for
   every task on every refresh.

`npm test` measures the query layer on 20 000 synthetic tasks:

| Operation | Time |
|---|---|
| Parse all 20 000 tasks (full re-index) | ~30 ms |
| Filter + sort (one dashboard refresh) | ~1.9 ms |

A frame is 16 ms, so a block can be redrawn several times per frame.

These are CleanView's own figures on its own benchmark, measured in Node rather
than inside Obsidian. They are not a comparison against any other plugin — no
such comparison has been run — and your vault will differ. Run `npm test`
yourself to see the numbers on your machine.

On top of that, a block only re-renders when a change is **relevant** to it: a
block scoped with `from: School` ignores edits under `Projects/`, and blocks
scrolled out of view are marked stale and catch up when they scroll back in.

## Safety

- **No network access.** No telemetry, no update check, no CDN.
- **No `eval`.** Block configuration is data, not code, including the dynamic
  date and counter placeholders — so nothing in a note can execute.
- **No dependencies.** `package.json` contains build tooling only; nothing from
  npm ends up in `main.js`. The charts are hand-written SVG.
- **No Node APIs**, so it runs on iOS and Android.
- **Writes only when you click.** The single write operation is toggling a
  checkbox, and it verifies the target line still matches what was indexed
  before changing anything.

### What it reads

CleanView enumerates every markdown file in the vault. That is inherent to what
it does — a dashboard asking "show me all overdue tasks" has to consider every
note that could contain one. Concretely:

- It lists all markdown files and reads their cached metadata (frontmatter,
  tags, checkbox positions), which Obsidian has already parsed.
- It reads file *contents* only for files the cache reports as containing
  checkboxes, because task text is not held in the metadata cache.
- Nothing read is stored anywhere outside memory, and nothing leaves the device.

Release assets carry [GitHub build provenance attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations),
so you can verify `main.js` was built by CI from this repository rather than
uploaded by hand.

## Requirements

Obsidian 1.13.0 or later. Older versions can install release 0.1.7, which
Obsidian selects automatically via `versions.json`.

## Installation

Not yet in the community plugin browser. To install manually, copy `main.js`,
`manifest.json` and `styles.css` from a
[release](../../releases) into `<vault>/.obsidian/plugins/cleanview/`, then enable
the plugin in *Settings → Community plugins*.

## Block reference

Every block starts with ` ```cleanview ` and contains YAML.

### Common keys

| Key | Meaning |
|---|---|
| `view` | `tasks`, `table`, `stat`, `chart`, `countdown`, `text` |
| `title` | Heading above the block |
| `source` | `tasks` (default) or `files` |
| `from` | Restrict to folders: `from: School` or `from: [School, Projects]` |
| `filter` | See below |
| `sort` | `[priority desc, due asc]` |
| `group` | `file`, `folder`, `due`, `priority`, `status`, `tags` |
| `limit` | Maximum rows |

### Filters

A bare value means equality. An object means operators.

```yaml
filter:
  done: false                        # equals
  due: { to: today }                 # on or before today
  due: { from: today, to: today+7d } # range
  due: overdue                       # keyword: overdue, today, week, none, future
  tags: { has: [school, exam] }      # has at least one
  text: { matches: chapter }         # contains
  status: { not: "-" }               # not equal
```

Operators: `is`/`eq`, `not`/`ne`, `before`/`lt`, `after`/`gt`, `from`/`gte`/`min`,
`to`/`lte`/`max`, `has`/`in`, `matches`/`contains`, `exists`.

Date expressions: `today`, `tomorrow`, `yesterday`, `2026-11-21`, `today+7d`,
`today-2w`, `today+1m`.

### Task fields

`text`, `done`, `status`, `priority`, `due`, `scheduled`, `start`, `created`,
`completedOn`, `recurrence`, `tags`, `path`, `file`, `folder`, `line`.

Both metadata dialects are read, so you do not have to pick one:

```markdown
- [ ] Read chapter 5 📅 2026-09-15 ⏫ 🔁 every week   # Tasks plugin
- [ ] Read chapter 5 [due:: 2026-09-15] [priority:: high]   # Dataview
```

### Note fields

`name`, `path`, `folder`, `tags`, `size`, `tasks`, `openTasks`, `mtime`, `ctime`.
Anything else is looked up in frontmatter, so `status: reading` filters on the
note's own `status` key. Frontmatter dates work whether Obsidian parsed them
into a `Date` or left them as a string.

### Views

```yaml
view: stat
title: Open tasks
filter: { done: false }
value: count          # count, sum:field, avg:field, min:field, max:field, distinct:field
goal: 20              # optional progress bar
```

```yaml
view: chart
type: bar             # bar, line, donut
by: folder
value: count
filter: { done: false }
```

```yaml
view: countdown
filter: { type: goal }
date: due             # optional; auto-detected from common key names
sort: [due asc]
```

```yaml
view: table
source: files
columns:
  - { field: name, label: Note, link: true }
  - { field: page, label: Progress, format: progress, max: totalPages }
sort: [mtime desc]
limit: 12
```

Column formats: `auto`, `text`, `number`, `date`, `relative`, `relative-ms`,
`bool`, `tags`, `progress`, `markdown`.

```yaml
view: text
format: "{date} · week {week} · {open} open tasks"
```

Placeholders: `{date}`, `{date:iso}`, `{weekday}`, `{week}`, `{year}`, `{open}`,
`{tasks}`, `{notes}`.

## Chart colours

Chart chrome — surface, gridlines, text — is inherited from your Obsidian theme
through its CSS variables, so charts look native under any theme.

Series colours are **not** inherited. They are a fixed palette validated for
colour-vision deficiency against both a light and a dark surface. A theme author
has never checked their accent colours for that, and a chart whose categories
cannot be told apart is worse than one that ignores the theme. Every chart also
carries a *Show values* toggle, since three of the light-mode series colours sit
below 3:1 contrast against the surface.

Dates and numbers are formatted with `Intl` using the runtime locale, so they
follow the reader's language without the plugin shipping translations.

## Development

```bash
npm install
npm run dev      # esbuild in watch mode
npm run build    # type-check + minified build
npm test         # 58 assertions plus a performance measurement, in plain Node
npm run preview  # chart and countdown harness at http://localhost:4599
```

`preview/` renders every chart type and the countdown cards, in light and dark,
in an ordinary browser without starting Obsidian. The chart layer deliberately
uses only standard DOM APIs so that what you see there is the same code that
runs in the plugin; the view layer needs a small shim for Obsidian's element
helpers, which lives in `preview/obsidian-shim.ts` and is never bundled.

Everything under `src/core` and `src/query` is free of Obsidian runtime
dependencies — types only — which is what lets `npm test` run in Node.

## Licence

MIT
