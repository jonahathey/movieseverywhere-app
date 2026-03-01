# Movies Everywhere

A personal movie collection tracker with a poster-grid UI. Catalog your physical and digital movie library, browse it with sorting, filtering, and search, and pull metadata from [TMDB](https://www.themoviedb.org/).

Fully static — no backend, no database. Everything lives in a single JSON file.

![MIT License](https://img.shields.io/badge/license-MIT-blue)

## Features

- **Poster grid** — responsive layout that adapts from mobile to desktop
- **Detail view** — full-screen overlay on mobile, modal on desktop with poster, credits, genres, overview, and format badges
- **Physical & digital formats** — track VCD, DVD, Blu-Ray, UHD Blu-Ray, 3D, Apple TV, YouTube, Google Play, Fandango At Home, Prime Video, Movies Anywhere, Plex, and more
- **Digital quality tracking** — flag titles as UHD, HD, SD, or 3D
- **TMDB integration** — search for movies, auto-fill metadata (title, release date, overview, genres, director, cast, poster)
- **Sorting** — by release date, alphabetical, or star rating
- **Filtering** — by format, physical/digital category, or custom fields
- **Search** — instant filter across title, director, cast, genres, and tags
- **Star ratings** — half-star precision (0–5)
- **Tags & custom fields** — user-defined labels configured in `data/config.json`
- **Import scripts** — bulk-import from Apple TV CSV, Fandango At Home HTML, Movies Anywhere / YouTube HTML, and Letterboxd ratings
- **Poster download** — batch-download posters from TMDB for local hosting
- **Dark theme** — Bootstrap 5 dark mode with a glassmorphism-style header

## Getting Started

### Prerequisites

- A modern web browser
- A local web server (e.g. `npx serve`, VS Code Live Server, Python `http.server`)
- [Node.js](https://nodejs.org/) (v18+) — only needed for import scripts
- `curl` and `jq` — only needed for the poster download script
- A free [TMDB API key](https://www.themoviedb.org/settings/api) — needed for TMDB search and import scripts

### Setup

1. **Clone the repo**

   ```bash
   git clone https://github.com/KevDoy/movieseverywhere-app.git
   cd movieseverywhere-app
   ```

2. **Add your TMDB API key**

   Open `data/config.json` and replace the placeholder:

   ```json
   {
     "tmdbApiKey": "YOUR_REAL_KEY",
     "posterMode": "local",
     "tmdbImageBase": "https://image.tmdb.org/t/p/w500",
     "customFields": []
   }
   ```

3. **Start a local server**

   ```bash
   npx serve .
   ```

4. **Open the app**

   Visit `http://localhost:3000` (or whichever port your server uses).

## Usage

### Managing Movies

Navigate to the **Manage** page (`manage.html`) to add, edit, or delete movies.

1. Type a title in the **Search TMDB** field — matching results appear as you type
2. Select a result to auto-fill title, release date, overview, genres, director, cast, and poster
3. Check the **formats** you own (physical and/or digital)
4. Set a **star rating** and add optional **tags**
5. Click **Add Movie**
6. Click **Save / Download JSON** to export `movies.json`

Place the downloaded `movies.json` in the `data/` folder (replacing the existing file) to update your library.

### Configuration

Edit `data/config.json` to customise the app:

| Field | Description |
|---|---|
| `tmdbApiKey` | Your TMDB v3 API key |
| `posterMode` | `"local"` (serve from `posters/`) or `"remote"` (load from TMDB CDN) |
| `tmdbImageBase` | Base URL for TMDB poster images |
| `customFields` | Array of custom boolean field names (e.g. `["Watched", "Wishlist"]`) |

### Downloading Posters

To host posters locally instead of loading them from TMDB on every page view:

```bash
./download_posters.sh
```

This reads `data/movies.json`, downloads each poster to `posters/{tmdbId}.jpg`, and skips any that already exist. Requires `curl` and `jq`.

Set `posterMode` to `"local"` in `data/config.json` to use the downloaded files.

## Import Scripts

Bulk-import titles from external services. All scripts read your TMDB API key from `data/config.json` and update `data/movies.json`.

### Apple TV

Import from an Apple TV purchase history CSV export:

```bash
node scripts/import-appletv.mjs /path/to/appletv-import.csv
```

### Fandango At Home (Vudu)

Save your Fandango At Home library page as HTML, place it at `import/fandago.html`, then run:

```bash
node scripts/import-fandango.mjs
```

### Movies Anywhere & YouTube

Save your library pages as HTML at `import/MoviesAnywhere.html` and `import/YouTube.html`, then run:

```bash
node scripts/import-html.mjs
```

### Letterboxd Ratings

Import star ratings from a Letterboxd CSV export. Only updates existing entries — does not add new titles.

Place your Letterboxd `ratings.csv` at `letterboxd/ratings.csv`, then run:

```bash
node scripts/import-letterboxd-ratings.mjs
```

## Project Structure

```
├── index.html                  Main library view
├── manage.html                 Add / edit / delete movies
├── data/
│   ├── config.json             App configuration & TMDB key
│   └── movies.json             Movie collection data
├── assets/
│   ├── css/style.css           Custom styles
│   ├── js/app.js               Library UI logic
│   ├── js/manage.js            Manage page logic
│   └── logos/                  Format & branding SVGs
├── posters/                    Locally cached poster images
├── scripts/
│   ├── import-appletv.mjs      Apple TV CSV importer
│   ├── import-fandango.mjs     Fandango At Home HTML importer
│   ├── import-html.mjs         Movies Anywhere / YouTube importer
│   └── import-letterboxd-ratings.mjs  Letterboxd ratings importer
└── download_posters.sh         Batch poster downloader
```

## License

[MIT](LICENSE) © 2026 KevDoy
