# Screenshots

Working folder for the community directory listing. The directory has its own
upload fields — these files are not referenced from the plugin README, and
nothing here ships in a release.

| Field | Size | Slots |
|---|---|---|
| Screenshots | 1200 x 800 (3:2) | up to 5 |
| Mobile screenshots | 900 x 1600 (9:16) | up to 5 |

macOS screenshots are Retina and almost never match those ratios, and an
iPhone screen is roughly 9:19.5. `resize.sh` scales each image to *cover* the
target box and crops from the centre, so nothing is stretched:

    ./resize.sh desktop raw/*.png     # -> out/, 1200x800
    ./resize.sh mobile  raw/phone.png # -> out/, 900x1600

Upload what lands in `out/`. Originals are left untouched.

## What to capture

1. Top of a dashboard — date line, countdown cards, tasks due now
2. A bar chart and a donut chart together
3. The New dashboard block dialog, with the live preview visible
4. Mobile: the same dashboard in portrait

Shoot against demo content rather than personal notes, and prefer dark theme —
the directory renders on a dark background.
