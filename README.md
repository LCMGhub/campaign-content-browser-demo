# Campaign Content Browser (Demo)

Static demo of the **Campaign Content Browser** dashboard. It mirrors the internal Domo app UI and behavior, but runs entirely in the browser with **synthetic mock data** — no Domo account, datasets, or API keys required.

## Live preview

After you publish to GitHub, enable **Pages** (see below) and open your site URL. Locally, open `index.html` with any static server (or use the commands below).

## Quick start (local)

```bash
# From this folder
npx --yes serve .
# Then open http://localhost:3000
```

Or with Python:

```bash
python -m http.server 8080
# Open http://localhost:8080
```

## How to use the demo

1. **Select a client** — State University, Liberal Arts College, or Community College.
2. Optionally filter by **Academic Years** and **Program Solutions**.
3. Switch **Emails** vs **Landing Pages**.
4. Search and pick a **Content Name** to preview HTML on the right.

All names, copy, and HTML are fictional placeholders for portfolio / GitHub use.

## Publish to GitHub Pages

### Option A — This folder is the repository root

1. Create a new GitHub repository and push the contents of `campaign-content-browser-demo/` to it.
2. Wait for the **Deploy demo to GitHub Pages** workflow to finish (creates the `gh-pages` branch).
3. **Settings → Pages → Build and deployment → Source**: **Deploy from a branch** → branch **`gh-pages`**, folder **`/ (root)`** → Save.
4. Open `https://YOUR_USERNAME.github.io/campaign-content-browser-demo/`.

### Option B — Demo lives in a subfolder of a monorepo

Use **Settings → Pages → Deploy from branch** and set the folder to `/campaign-content-browser-demo`, or adjust the workflow `path` filter.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Shell layout and help modal |
| `app.css` | Styles (matches internal dashboard) |
| `app.js` | Filter logic, preview, list UI |
| `mock-data.js` | Synthetic clients and content rows |

## Relationship to the Domo app

The parent project (`Campaign Content Browser (Internal)`) uses Domo `domo.get` and a mapped dataset. This demo reuses the same UI code path with `CCB_DEMO_DATA` instead of live API calls.

## License

Use and adapt for your portfolio. Replace mock branding and copy before any production use.
