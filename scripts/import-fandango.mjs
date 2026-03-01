#!/usr/bin/env node
/**
 * Import movie titles from a saved Fandango at Home (Vudu) HTML page.
 * - Parses alt attributes from poster images in the HTML
 * - Matches against existing movies.json entries
 * - Adds "Fandango At Home" as a digital source to existing entries
 * - Creates new entries via TMDB for titles not yet in the library
 *
 * Usage: node scripts/import-fandango.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const MOVIES_PATH = resolve(ROOT, 'data/movies.json');
const CONFIG_PATH = resolve(ROOT, 'data/config.json');
const FANDANGO_HTML = resolve(ROOT, 'import/fandago.html');

const SOURCE = 'Fandango At Home';

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

// ---- HTML parser ----

function parseFandango(html) {
  // Each movie poster lives inside a <div class="contentPosterWrapper"> and has
  // an <img> with an alt attribute containing the movie title.
  const re = /class="contentPosterWrapper"[^>]*>.*?<img[^>]+alt="([^"]+)"/g;
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

function buildEntry(detail) {
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
    formats: { physical: [], digital: [SOURCE] },
    digitalQuality: [],
  };
}

// ---- title matching ----

/** Try to extract a year from parenthetical, e.g. "Passengers (2016)" */
function extractYear(raw) {
  const m = raw.match(/\((\d{4})\)/);
  return m ? parseInt(m[1], 10) : 0;
}

function findExisting(rawTitle, byNorm) {
  const n = norm(rawTitle);
  return byNorm.get(n) || null;
}

// ---- main ----

async function main() {
  console.log('Reading Fandango at Home HTML...');
  const html = readFileSync(FANDANGO_HTML, 'utf-8');

  const titles = parseFandango(html);
  console.log(`Fandango At Home: ${titles.length} titles\n`);

  const movies = JSON.parse(readFileSync(MOVIES_PATH, 'utf-8'));
  const byTmdbId = new Map(movies.map(m => [m.tmdbId, m]));
  const byNorm = new Map();
  movies.forEach(m => byNorm.set(norm(m.title), m));

  let added = 0, updated = 0, skipped = 0, failed = 0;
  const failures = [];
  const processedNorm = new Map(); // norm -> movie entry

  for (let i = 0; i < titles.length; i++) {
    const rawTitle = titles[i];
    const year = extractYear(rawTitle);
    const progress = `[${i + 1}/${titles.length}]`;
    const cleanedTitle = norm(rawTitle);

    // 1. Check existing library
    let existing = findExisting(rawTitle, byNorm);

    // 2. Check if we've already added it in this run
    if (!existing && processedNorm.has(cleanedTitle)) {
      existing = processedNorm.get(cleanedTitle);
    }

    if (existing) {
      if (!existing.formats) existing.formats = { physical: [], digital: [] };
      if (!existing.formats.digital) existing.formats.digital = [];
      if (!existing.formats.digital.includes(SOURCE)) {
        existing.formats.digital.push(SOURCE);
        console.log(`${progress} ✓ Updated "${existing.title}" — added ${SOURCE}`);
        updated++;
      } else {
        console.log(`${progress} — "${existing.title}" already has ${SOURCE}`);
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
        failures.push(rawTitle);
        failed++;
        continue;
      }

      await sleep(80);
      const detail = await tmdbDetails(best.id);

      // Check again by tmdb ID (different title spelling)
      if (byTmdbId.has(detail.id)) {
        const ex = byTmdbId.get(detail.id);
        if (!ex.formats) ex.formats = { physical: [], digital: [] };
        if (!ex.formats.digital) ex.formats.digital = [];
        if (!ex.formats.digital.includes(SOURCE)) {
          ex.formats.digital.push(SOURCE);
          console.log(`${progress} ✓ Updated "${ex.title}" (TMDB match) — added ${SOURCE}`);
          updated++;
        } else {
          console.log(`${progress} — "${ex.title}" already has ${SOURCE} (TMDB match)`);
          skipped++;
        }
        processedNorm.set(cleanedTitle, ex);
        continue;
      }

      const entry = buildEntry(detail);
      movies.push(entry);
      byTmdbId.set(entry.tmdbId, entry);
      byNorm.set(norm(entry.title), entry);
      processedNorm.set(cleanedTitle, entry);
      console.log(`${progress} ✚ Added "${entry.title}" (TMDB ${entry.tmdbId}) [${SOURCE}]`);
      added++;
    } catch (err) {
      console.log(`${progress} ✗ ERROR "${rawTitle}": ${err.message}`);
      failures.push(rawTitle);
      failed++;
    }
  }

  writeFileSync(MOVIES_PATH, JSON.stringify(movies, null, 2) + '\n', 'utf-8');

  console.log(`\n========== DONE ==========`);
  console.log(`Added:   ${added}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped} (already had ${SOURCE})`);
  console.log(`Failed:  ${failed}`);
  if (failures.length) {
    console.log(`\nFailed titles:`);
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log(`\nTotal movies in library: ${movies.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
