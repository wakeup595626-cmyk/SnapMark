# SnapMark

[中文](README.md) | English

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-2ea44f)](https://wakeup595626-cmyk.github.io/SnapMark/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Local first](https://img.shields.io/badge/privacy-local--first-2563eb)](#privacy)
[![Static site](https://img.shields.io/badge/build-none%20required-f7df1e)](index.html)

SnapMark is a browser-based batch annotation tool for screenshots and similar images. Add a
name, student ID, class, or any custom field, apply consistent styling, and export
correctly named files in one ZIP. Images and roster data stay in the browser; the hosted
page only loads its own static assets.

![SnapMark interface](docs/screenshot.png)

## Highlights

- Guided four-step flow: import images, enter text, adjust style, export.
- Batch generation from Excel or CSV rosters, including two workflows: one base image for
  every person, or one imported image per person.
- Template variables generated from roster columns, plus live output filename preview.
- Position, font, weight, alignment, colour, background bar, outline, and shadow controls.
- Seeded randomness for font size, position, opacity, colour, and typeface across a batch.
- ZIP export with progress, output limits, undo/redo, reusable style presets, and local
  settings persistence.

## Quick start

Use the [hosted version](https://wakeup595626-cmyk.github.io/SnapMark/), open `index.html`
directly after downloading the repository, or serve the folder locally:

```bash
python -m http.server 8080
# then open http://localhost:8080
```

No build step or runtime dependency installation is required. The vendored browser
libraries are already included under `vendor/`.

## Batch workflow

1. Add one base image or several screenshots.
2. Turn on roster mode and import `.xlsx`, `.xls`, `.csv`, or tabular text pasted from Excel.
3. Map name, student ID, and class columns if automatic detection needs help.
4. Edit the text and filename templates; any extra roster column can be used as a variable.
5. Review the generated count and export the ZIP.

## Styling and reproducibility

Text can be placed with a nine-position grid or dragged directly on the preview. Batch
randomisation lowers the repeated-template look while remaining reproducible: the same
seed and the same roster produce the same result, and the seed can be changed or restored.

## Privacy and data boundaries

- Images and roster data are processed in browser memory and are not uploaded.
- The online build only requests its own HTML, CSS, JavaScript, and static files from
  `vendor/`.
- `localStorage` stores preferences only, not image data.
- Closing the tab releases the in-memory image data.

See [README.md](README.md) for the complete Chinese guide and troubleshooting notes.

## Development and verification

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

The repository also contains focused Playwright checks for batch mode, custom positioning,
the wizard, file:// usage, and the desktop export path. Use a static server on port 8765 for
the tests that require one.

## License

[MIT](LICENSE). The software licence does not grant rights to personal photos, certificates,
signatures, roster data, or other content supplied by users.
