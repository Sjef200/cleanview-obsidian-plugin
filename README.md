# Puls

Raske, live dashbord i Obsidian. Skrevet for å erstatte Dataview + Tasks + Tracker
+ Meta Bind-stakken i et oppsett der Dataview ble for treg.

## Hvorfor dette er raskere enn Dataview

Dataview bygger og vedlikeholder sin **egen** indeks over hele vaulten, parallelt
med den Obsidian allerede har, og kjører hver spørring på nytt gjennom en
tolket spørrespråk-motor når noe endrer seg.

Puls gjør fire ting annerledes:

1. **Gjenbruker Obsidians `metadataCache`.** Frontmatter, tagger og
   avkrysningsbokser er allerede parset og ligger i minnet. Puls leser den
   strukturen i stedet for å parse markdown på nytt.
2. **Leser bare filer som faktisk har oppgaver.** Cachen forteller hvilke filer
   som inneholder avkrysningsbokser før noe leses fra disk. En vault med 5000
   notater der 200 har oppgaver gjør 200 lesinger, ikke 5000.
3. **Null I/O ved redigering.** `metadataCache.on("changed")` gir innholdet i
   fila som argument, så reindeksering av et redigert notat leser ingenting.
4. **Ingen tolkning per rad.** Filtre og sorteringer kompileres til lukkede
   funksjoner én gang når blokken lastes.

Målt på 20 000 oppgaver (`npm test`):

| Operasjon | Tid |
|---|---|
| Parse alle 20 000 oppgaver (full reindeksering) | ~29 ms |
| Filtrer + sorter (én dashbord-oppdatering) | ~1,8 ms |

En skjermoppdatering er 16 ms, så en dashbord-blokk kan tegnes om flere ganger
per frame.

I tillegg tegnes en blokk **bare** om når endringen faktisk angår den: en blokk
med `from: Skole` ignorerer endringer i `Prosjekter/`, og blokker utenfor
skjermen merkes som utdaterte og tas igjen når du scroller til dem.

## Trygghet

- **Ingen nettverkskall.** Ingen telemetri, ingen oppdateringssjekk, ingen CDN.
- **Ingen `eval`.** Oppsettet er data, ikke kode. Dette erstatter blant annet
  `$= dv.date(...)` uten å måtte skru på Dataviews JavaScript-queries.
- **Ingen avhengigheter.** `package.json` har kun byggeverktøy. Ingenting fra
  npm havner i `main.js` — grafene er håndskrevet SVG.
- **Ingen Node-API-er**, så plugin-en virker på iPhone og iPad.
- **Skriver bare når du klikker.** Eneste skriveoperasjon er å krysse av en
  oppgave, og den verifiserer at linja fortsatt ser ut som den den indekserte
  før den endrer noe.

## Blokkoppsett

Alle blokker starter med ` ```puls ` og inneholder YAML.

### Felles nøkler

| Nøkkel | Betydning |
|---|---|
| `view` | `tasks`, `table`, `stat`, `chart`, `text` |
| `title` | Overskrift over blokken |
| `source` | `tasks` (standard) eller `files` |
| `from` | Begrens til mappe(r): `from: Skole` eller `from: [Skole, Prosjekter]` |
| `filter` | Se under |
| `sort` | `[priority desc, due asc]` |
| `group` | `file`, `folder`, `due`, `priority`, `status`, `tags` |
| `limit` | Maks antall rader |

### Filtre

Verdi alene betyr «er lik». Objekt betyr operatorer.

```yaml
filter:
  done: false                        # er lik
  due: { to: today }                 # på eller før i dag
  due: { from: today, to: today+7d } # intervall
  due: overdue                       # nøkkelord: overdue, today, week, none, future
  tags: { has: [skole, prøve] }      # har minst én
  text: { matches: kapittel }        # inneholder
  status: { not: "-" }               # ikke lik
```

Operatorer: `is`/`eq`, `not`/`ne`, `before`/`lt`, `after`/`gt`, `from`/`gte`/`min`,
`to`/`lte`/`max`, `has`/`in`, `matches`/`contains`, `exists`.

Datouttrykk: `today`, `i dag`, `i morgen`, `2026-07-11`, `today+7d`, `today-2w`,
`today+1m`.

### Oppgavefelter

`text`, `done`, `status`, `priority`, `due`, `scheduled`, `start`, `created`,
`completedOn`, `recurrence`, `tags`, `path`, `file`, `folder`, `line`.

Både Tasks-dialekten (`📅 2026-07-11 ⏫ 🔁 every week`) og Dataview-dialekten
(`[due:: 2026-07-11] [priority:: high]`) leses. Du trenger ikke velge.

### Notatfelter

`name`, `path`, `folder`, `tags`, `size`, `tasks`, `openTasks`, `mtime`, `ctime`.
Alt annet slås opp i frontmatter, så `status: leser` filtrerer direkte på
frontmatter-feltet `status`.

### Eksempler

```yaml
view: stat
title: Åpne oppgaver
filter: { done: false }
value: count          # count, sum:felt, avg:felt, min:felt, max:felt, distinct:felt
goal: 20              # valgfri måloppnåelse
```

```yaml
view: chart
type: bar             # bar, line, donut
by: folder
value: count
filter: { done: false }
```

```yaml
view: table
source: files
columns:
  - { field: name, label: Notat, link: true }
  - { field: gjeldendeSide, label: Fremdrift, format: progress, max: totalSider }
sort: [mtime desc]
limit: 12
```

Kolonneformater: `auto`, `text`, `number`, `date`, `relative`, `relative-ms`,
`bool`, `tags`, `progress`, `markdown`.

```yaml
view: text
format: "{dato} · uke {uke} · {åpne} åpne oppgaver"
```

Plassholdere: `{dato}`, `{dato:iso}`, `{ukedag}`, `{uke}`, `{år}`, `{åpne}`,
`{oppgaver}`, `{notater}`.

## Farger i grafene

Kromet (bakgrunn, rutenett, tekst) arves fra Obsidian-temaet ditt via
CSS-variabler, så grafene ser innfødte ut uansett tema.

Seriefargene arves **ikke**. De er en fast palett som er validert for
fargeblindhet mot både lys og mørk bakgrunn. En temaforfatter har aldri sjekket
aksentfargene sine for det, og et diagram der kategoriene ikke kan skilles fra
hverandre er verre enn ett som ignorerer temaet. Hver graf har også en
«Vis tall»-knapp, siden tre av lysmodus-fargene ligger under 3:1 kontrast mot
bakgrunnen.

## Utvikling

```bash
npm install
npm run dev      # esbuild i watch-modus
npm run build    # typesjekk + minifisert build
npm test         # 49 tester + ytelsesmåling, kjører i Node
```

`preview/index.html` tegner alle graftypene i lyst og mørkt tema i en vanlig
nettleser, uten å starte Obsidian. Graflaget bruker bare standard DOM-API-er
nettopp derfor — det som vises der er den samme koden som kjører i plugin-en.

```bash
python3 -m http.server 4599
# åpne http://localhost:4599/.obsidian/plugins/puls/preview/index.html
```
