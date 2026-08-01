# The CleanView guide

This is the walkthrough — click by click, no YAML required until you actually
want it. If you've used Notion, the shape will feel familiar: you pick what
you want from a dialog, and CleanView writes the underlying text for you.

For every field name, filter operator and view type, see the
[block reference](README.md#block-reference) in the README instead. This
guide is about the four things you'll actually do, in the order you'll do
them.

## What you're building

A dashboard is a live view over the tasks and notes you already have — not a
separate database you fill in twice. You'll end up with something like:

> **Due this week**
> ☐ Read chapter 5 — *High* · in 3 days
> ☐ Book the lab — *no due date*
>
> **Open tasks by folder**
> ▇▇▇▇▇▇▇▇▇▇▇▇ School/Mathematics 23
> ▇▇▇▇▇▇▇▇ School/History 17

Everything on it comes from checkbox lines and note properties you write the
normal way. The dashboard just reads them.

## Step 1 — Add a task with a due date

Dashboards that filter by date need tasks that *have* a date. This is the
fastest way to add one:

1. Put your cursor in a note.
2. Open the command palette (`Cmd/Ctrl + P`) and run
   **CleanView: Add task**.
3. Fill in three things:
   - **Task** — what needs doing
   - **Due** — click **Today**, **Tomorrow**, or **In a week**, or pick a date
   - **Priority** — optional
4. Press **Add**, or just hit **Enter** from the task field.

The dialog shows you the exact line it's about to write, so nothing is
hidden:

```
- [ ] Read chapter 5 📅 2026-08-07
```

You never have to type that yourself — this is what the dialog produces.

## Step 2 — Build your first dashboard block

1. Put the cursor where the dashboard should go.
2. Run **CleanView: New dashboard block**.
3. Pick from the dropdowns:
   - **Show** → `Tasks`
   - **Status** → `Not done`
   - **Due** → `Within 7 days`
   - **Folder** → whichever one you want, or leave it as `Whole vault`
4. Watch the preview at the bottom of the dialog update as you choose —
   that preview text is exactly what gets inserted.
5. Press **Insert**.

A live task list appears, filtered to what you just chose. Add a task that
matches, and it shows up on its own — no refresh, nothing to re-run.

## Step 3 — Change anything without touching text

This is the part that makes CleanView behave like an app instead of a text
format:

- **Click a task's text** anywhere in a dashboard → the same three-field
  editor from Step 1 opens, pre-filled with that task's current values.
  Change the due date, press **Save**, and the line in the source note
  updates itself.
- **Hover any block and click the pencil** in the corner → the block-builder
  dialog reopens with your current settings already selected. Change
  "Within 7 days" to "Overdue", press **Save**, done.

Between these two, the common editing tasks — reschedule something, adjust a
filter — never require opening the note and hand-editing a line.

One honest limit: the edit button only appears on blocks the dialog can
fully reproduce. If you've hand-written something the dialog doesn't offer
(a filter operator, a custom column list), CleanView leaves it as text
rather than silently simplifying it when you click edit.

## Step 4 — A tour of the other blocks

**New dashboard block** covers five of them directly — pick a different
**Show** value and the rest of the dialog adapts:

| Show | What it does |
|---|---|
| Tasks | A filtered, sortable, groupable list |
| Chart | Bars, a line over time, or a donut |
| A single number | One figure, with an optional goal bar |
| Countdown to a date | Days remaining to a deadline in a note's properties |
| Table of notes | Notes and their properties, as rows |

Three more exist as one-click **command palette insert commands** — they
drop in a working starter block, and for the common case that's all you
need:

| Command | Inserts |
|---|---|
| **CleanView: Insert live text line** | A line that fills in today's date, the week number, or your open-task count |
| **CleanView: Insert capacity check** | Compares your open tasks' time estimates against the hours you actually have before a deadline |
| **CleanView: Insert task list** / **Insert chart** | Quick starting templates for those two, as an alternative to the full dialog |

The capacity check is the one place you'll want to type a couple of numbers
by hand — your own daily budget for sleep, commute, meals, and so on — since
that's a personal number no dialog can guess for you. Everything else in it
is computed.

## When you want more control

Every block is plain text underneath — nothing is locked away in a format
only the dialog understands. If you want a filter the dialog doesn't offer,
or a table with specific columns, edit the block directly; the
[block reference](README.md#block-reference) documents every key. The dialog
covers the common cases quickly; the text underneath covers everything else.

## Command palette cheat sheet

| Command | What it's for |
|---|---|
| CleanView: New dashboard block | Build any block from dropdowns |
| CleanView: Add task | Add a task with a due date and priority |
| CleanView: Insert live text line | A self-updating date/count line |
| CleanView: Insert capacity check | "Do I have enough time" starter block |
| CleanView: Insert task list | Quick task-list starter block |
| CleanView: Insert chart | Quick chart starter block |
| CleanView: Rebuild index | Force a full re-scan of the vault |
