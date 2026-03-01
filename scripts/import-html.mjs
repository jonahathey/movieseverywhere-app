#!/usr/bin/env node
/**
 * Import movie titles from saved HTML pages (Movies Anywhere & YouTube).
 * - Parses alt/title attributes from the HTML
 * - Matches against existing movies.json entries
 * - Adds the digital source to existing entries
 * - Creates new entries via TMDB for titles not yet in the library
 *
 * Usage: node scripts/import-html.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const MOVIES_PATH = resolve(ROOT, 'data/movies.json');
const CONFIG_PATH = resolve(ROOT, 'data/config.json');
const MA_HTML = resolve(ROOT, 'import/MoviesAnywhere.html');
const YT_HTML = resolve(ROOT, 'import/YouTube.html');

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
const API_KEY = config.tmdbApiKey;
const TMDB_BASE = 'https://api.themoviedb.org/3';

// ---- helpers ----

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function decodeHtmlEntities(str) {
  return str
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

/** Normalise a title for fuzzy matching */
function norm(t) {
  return t
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/\s*\((?:unrated|theatrical|extended|director'?s?\s*cut|extended edition|extended version|\d{4})\)/gi, '')
    .replace(/^marvel studios['']?\s*/i, '')
    .replace(/^disney['']?s?\s*/i, '')
    .replace(/^dr\.\s*seuss['']?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- HTML parsers ----

function parseMoviesAnywhere(html) {
  // alt="MovieTitle" — skip known non-movie alts
  const skip = new Set(['add profile', 'web - my movies legal studios texts']);
  const re = /alt="([^"]+)"/g;
  const titles = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = decodeHtmlEntities(m[1]).trim();
    if (!raw || skip.has(raw.toLowerCase())) continue;
    titles.add(raw);
  }
  return [...titles];
}

function parseYouTube(html) {
  // <span ... class="style-scope ytd-grid-movie-renderer" title="MovieTitle" ...>
  const re = /class="style-scope ytd-grid-movie-renderer"\s+title="([^"]*)"/g;
  const titles = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = decodeHtmlEntities(m[1]).trim();
    if (!raw) continue;
    titles.add(raw);
  }
  return [...titles];
}

// ---- TMDB ----

async function tmdbSearch(title, year) {
  const params = new URLSearchParams({ api_key: API_KEY, query: title, ...(year ? { year: String(year) } : {}) });
  const resp = await fetch(`${TMDB_BASE}/search/movie?${params}`);
  if (!resp.ok) throw new Error(`TMDB search ${resp.status}`);
  return resp.json();
}

async function tmdbDetails(id) {
  const params = new URLSearchParams({ api_key: API_KEY, append_to_response: 'credits' });
  const resp = await fetch(`${TMDB_BASE}/movie/${id}?${params}`);
  if (!resp.ok) throw new Error(`TMDB details ${resp.status}`);
  return resp.json();
}

function pickBest(results, year) {
  if (!results.length) return null;
  if (year) {
    const ym = results.find(r => parseInt((r.release_date || '').split('-')[0], 10) === year);
    if (ym) return ym;
  }
  return results[0];
}

function buildEntry(detail, source) {
  const director = (detail.credits?.crew || []).find(c => c.job === 'Director');
  return {
    tmdbId: detail.id,
    title: detail.title,
    releaseDate: detail.release_date || '',
    overview: detail.overview || '',
    posterPath: detail.poster_path || '',
    genres: (detail.genres || []).map(g => g.name),
    director: director ? director.name : '',
    cast: (detail.credits?.cast || []).slice(0, 3).map(c => c.name),
    rating: 0,
    tags: [],
    customTags: {},
    formats: { physical: [], digital: [source] },
    digitalQuality: [],
  };
}

// ---- title matching ----

/** Try to extract a year from parenthetical, e.g. "Gravity (2013)" */
function extractYear(raw) {
  const m = raw.match(/\((\d{4})\)/);
  return m ? parseInt(m[1], 10) : 0;
}

function findExisting(rawTitle, byTmdbId, byNorm) {
  const n = norm(rawTitle);
  return byNorm.get(n) || null;
}

// ---- main ----

async function main() {
  console.log('Reading HTML files...');
  const maHtml = readFileSync(MA_HTML, 'utf-8');
  const ytHtml = readFileSync(YT_HTML, 'utf-8');

  const maTitles = parseMoviesAnywhere(maHtml);
  const ytTitles = parseYouTube(ytHtml);
  console.log(`Movies Anywhere: ${maTitles.length} titles`);
  console.log(`YouTube: ${ytTitles.length} titles\n`);

  const movies = JSON.parse(readFileSync(MOVIES_PATH, 'utf-8'));
  const byTmdbId = new Map(movies.map(m => [m.tmdbId, m]));
  const byNorm = new Map();
  movies.forEach(m => byNorm.set(norm(m.title), m));

  // Build combined work list: [ { rawTitle, source, year } ]
  const work = [];
  maTitles.forEach(t => work.push({ rawTitle: t, source: 'Movies Anywhere', year: extractYear(t) }));
  ytTitles.forEach(t => work.push({ rawTitle: t, source: 'YouTube', year: extractYear(t) }));

  let added = 0, updated = 0, skipped = 0, failed = 0;
  const failures = [];
  // Track what we've already processed so we don't hit TMDB twice for same title
  const processedNorm = new Map(); // norm -> movie entry

  for (let i = 0; i < work.length; i++) {
    const { rawTitle, source, year } = work[i];
    const progress = `[${i + 1}/${work.length}]`;
    const cleanedTitle = norm(rawTitle);

    // 1. Check existing library
    let existing = findExisting(rawTitle, byTmdbId, byNorm);

    // 2. Check if we've already added it in this run
    if (!existing && processedNorm.has(cleanedTitle)) {
      existing = processedNorm.get(cleanedTitle);
    }

    if (existing) {
      if (!existing.formats) existing.formats = { physical: [], digital: [] };
      if (!existing.formats.digital) existing.formats.digital = [];
      if (!existing.formats.digital.includes(source)) {
        existing.formats.digital.push(source);
        console.log(`${progress} ✓ Updated "${existing.title}" — added ${source}`);
        updated++;
      } else {
        console.log(`${progress} — "${existing.title}" already has ${source}`);
        skipped++;
      }
      continue;
    }

    // 3. Search TMDB
    try {
      await sleep(80);
      const searchTitle = rawTitle
        .replace(/\s*\((?:Unrated|Theatrical|Extended|Director'?s?\s*Cut|Extended Edition|Extended Version|\d{4})\)/gi, '')
        .replace(/^Marvel Studios['']?\s*/i, '')
        .replace(/^Disney['']?s?\s*/i, '')
        .replace(/^Dr\.\s*Seuss['']?\s*/i, '')
        .trim();

      let result = await tmdbSearch(searchTitle, year);
      let best = pickBest(result.results || [], year);

      if (!best && year) {
        result = await tmdbSearch(searchTitle, 0);
        best = pickBest(result.results || [], year);
      }

      if (!best) {
        console.log(`${progress} ✗ NOT FOUND: "${rawTitle}"`);
        failures.push({ title: rawTitle, source });
        failed++;
        continue;
      }

      await sleep(80);
      const detail = await tmdbDetails(best.id);

      // Check again by tmdb ID (different title spelling)
      if (byTmdbId.has(detail.id)) {
        const ex = byTmdbId.get(detail.id);
        if (!ex.formats.digital.includes(source)) {
          ex.formats.digital.push(source);
          console.log(`${progress} ✓ Updated "${ex.title}" (TMDB match) — added ${source}`);
          updated++;
        } else {
          console.log(`${progress} — "${ex.title}" already has ${source} (TMDB match)`);
          skipped++;
        }
        processedNorm.set(cleanedTitle, ex);
        continue;
      }

      const entry = buildEntry(detail, source);
      movies.push(entry);
      byTmdbId.set(entry.tmdbId, entry);
      byNorm.set(norm(entry.title), entry);
      processedNorm.set(cleanedTitle, entry);
      console.log(`${progress} ✚ Added "${entry.title}" (TMDB ${entry.tmdbId}) [${source}]`);
      added++;
    } catch (err) {
      console.log(`${progress} ✗ ERROR "${rawTitle}": ${err.message}`);
      failures.push({ title: rawTitle, source });
      failed++;
    }
  }

  writeFileSync(MOVIES_PATH, JSON.stringify(movies, null, 2) + '\n', 'utf-8');

  console.log(`\n========== DONE ==========`);
  console.log(`Added:   ${added}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped} (already had source)`);
  console.log(`Failed:  ${failed}`);
  if (failures.length) {
    console.log(`\nFailed titles:`);
    failures.forEach(f => console.log(`  - [${f.source}] ${f.title}`));
  }
  console.log(`\nTotal movies in library: ${movies.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
