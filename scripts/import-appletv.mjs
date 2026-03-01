#!/usr/bin/env node
/**
 * Import Apple TV titles from CSV into movies.json
 * Usage: node scripts/import-appletv.mjs /path/to/appletv-import.csv
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const CSV_PATH = process.argv[2] || resolve(import.meta.dirname, '../appletv-import.csv');
const MOVIES_PATH = resolve(import.meta.dirname, '../data/movies.json');
const CONFIG_PATH = resolve(import.meta.dirname, '../data/config.json');

const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
const API_KEY = config.tmdbApiKey;
const TMDB_BASE = 'https://api.themoviedb.org/3';

// --------------- helpers ---------------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Strip parenthetical year/version info for cleaner TMDB search */
function cleanTitle(raw) {
  return raw
    .replace(/\s*\((?:Theatrical Version|Unrated|Extended Edition|Extended Director's Cut|Unrated Director's Cut|Extended Version|\d{4})\)/gi, '')
    .replace(/\s*\(Extended version\)/gi, '')
    .replace(/\s*\(Unrated\)/gi, '')
    .trim();
}

/** Parse the Apple TV CSV; returns array of { name, year } */
function parseCsv(csvText) {
  const lines = csvText.split('\n').filter(l => l.trim());
  // Skip header
  const dataLines = lines.slice(1);
  const seen = new Set();
  const results = [];

  for (const line of dataLines) {
    // CSV may have quoted fields with commas inside — use a simple state-machine parser
    const fields = parseCSVLine(line);
    const name = (fields[0] || '').trim();
    const year = parseInt(fields[6], 10) || 0;
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ name, year });
  }
  return results;
}

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else { current += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { fields.push(current); current = ''; }
      else { current += ch; }
    }
  }
  fields.push(current);
  return fields;
}

// --------------- TMDB API ---------------

async function tmdbSearch(title, year) {
  const params = new URLSearchParams({
    api_key: API_KEY,
    query: title,
    ...(year ? { year: String(year) } : {}),
  });
  const url = `${TMDB_BASE}/search/movie?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`TMDB search failed (${resp.status}): ${await resp.text()}`);
  return resp.json();
}

async function tmdbDetails(id) {
  const params = new URLSearchParams({ api_key: API_KEY, append_to_response: 'credits' });
  const url = `${TMDB_BASE}/movie/${id}?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`TMDB details failed (${resp.status}): ${await resp.text()}`);
  return resp.json();
}

function pickBestResult(results, year) {
  if (results.length === 0) return null;
  // If year matches, prefer that
  if (year) {
    const yearMatch = results.find(r => {
      const ry = parseInt((r.release_date || '').split('-')[0], 10);
      return ry === year;
    });
    if (yearMatch) return yearMatch;
  }
  // Otherwise first result (highest relevance)
  return results[0];
}

function buildMovieEntry(detail) {
  const director = (detail.credits?.crew || []).find(c => c.job === 'Director');
  const cast = (detail.credits?.cast || []).slice(0, 3).map(c => c.name);
  return {
    tmdbId: detail.id,
    title: detail.title,
    releaseDate: detail.release_date || '',
    overview: detail.overview || '',
    posterPath: detail.poster_path || '',
    genres: (detail.genres || []).map(g => g.name),
    director: director ? director.name : '',
    cast,
    rating: 0,
    tags: [],
    customTags: {},
    formats: {
      physical: [],
      digital: ['Apple TV'],
    },
    digitalQuality: [],
  };
}

// --------------- main ---------------

async function main() {
  console.log(`Reading CSV: ${CSV_PATH}`);
  const csvText = readFileSync(CSV_PATH, 'utf-8');
  const titles = parseCsv(csvText);
  console.log(`Found ${titles.length} unique titles in CSV.\n`);

  const movies = JSON.parse(readFileSync(MOVIES_PATH, 'utf-8'));
  const existingByTmdbId = new Map(movies.map(m => [m.tmdbId, m]));
  const existingByTitle = new Map(movies.map(m => [m.title.toLowerCase(), m]));

  let added = 0, updated = 0, skipped = 0, failed = 0;
  const failures = [];

  for (let i = 0; i < titles.length; i++) {
    const { name, year } = titles[i];
    const searchTitle = cleanTitle(name);
    const progress = `[${i + 1}/${titles.length}]`;

    // Check if already in library by title (case-insensitive, try both raw and cleaned)
    const existingByRaw = existingByTitle.get(name.toLowerCase());
    const existingByCleaned = existingByTitle.get(searchTitle.toLowerCase());
    const existing = existingByRaw || existingByCleaned;

    if (existing) {
      // Just ensure Apple TV is in digital formats
      if (!existing.formats) existing.formats = { physical: [], digital: [] };
      if (!existing.formats.digital) existing.formats.digital = [];
      if (!existing.formats.digital.includes('Apple TV')) {
        existing.formats.digital.push('Apple TV');
        console.log(`${progress} ✓ Updated "${existing.title}" — added Apple TV`);
        updated++;
      } else {
        console.log(`${progress} — "${existing.title}" already has Apple TV`);
        skipped++;
      }
      continue;
    }

    // Search TMDB
    try {
      await sleep(80); // respect rate limit (~12 req/s)
      const searchResult = await tmdbSearch(searchTitle, year);
      const best = pickBestResult(searchResult.results || [], year);

      if (!best) {
        // Retry without year
        const retry = await tmdbSearch(searchTitle, 0);
        const best2 = pickBestResult(retry.results || [], year);
        if (!best2) {
          console.log(`${progress} ✗ NOT FOUND: "${name}" (searched: "${searchTitle}")`);
          failures.push(name);
          failed++;
          continue;
        }
        await sleep(80);
        const detail = await tmdbDetails(best2.id);
        if (existingByTmdbId.has(detail.id)) {
          const ex = existingByTmdbId.get(detail.id);
          if (!ex.formats.digital.includes('Apple TV')) {
            ex.formats.digital.push('Apple TV');
            console.log(`${progress} ✓ Updated "${ex.title}" (matched by TMDB ID) — added Apple TV`);
            updated++;
          } else {
            console.log(`${progress} — "${ex.title}" already has Apple TV (matched by TMDB ID)`);
            skipped++;
          }
        } else {
          const entry = buildMovieEntry(detail);
          movies.push(entry);
          existingByTmdbId.set(entry.tmdbId, entry);
          existingByTitle.set(entry.title.toLowerCase(), entry);
          console.log(`${progress} ✚ Added "${entry.title}" (TMDB ${entry.tmdbId})`);
          added++;
        }
        continue;
      }

      await sleep(80);
      const detail = await tmdbDetails(best.id);
      if (existingByTmdbId.has(detail.id)) {
        const ex = existingByTmdbId.get(detail.id);
        if (!ex.formats.digital.includes('Apple TV')) {
          ex.formats.digital.push('Apple TV');
          console.log(`${progress} ✓ Updated "${ex.title}" (matched by TMDB ID) — added Apple TV`);
          updated++;
        } else {
          console.log(`${progress} — "${ex.title}" already has Apple TV (matched by TMDB ID)`);
          skipped++;
        }
      } else {
        const entry = buildMovieEntry(detail);
        movies.push(entry);
        existingByTmdbId.set(entry.tmdbId, entry);
        existingByTitle.set(entry.title.toLowerCase(), entry);
        console.log(`${progress} ✚ Added "${entry.title}" (TMDB ${entry.tmdbId})`);
        added++;
      }
    } catch (err) {
      console.log(`${progress} ✗ ERROR for "${name}": ${err.message}`);
      failures.push(name);
      failed++;
    }
  }

  // Write back
  writeFileSync(MOVIES_PATH, JSON.stringify(movies, null, 2) + '\n', 'utf-8');

  console.log(`\n========== DONE ==========`);
  console.log(`Added:   ${added}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped} (already had Apple TV)`);
  console.log(`Failed:  ${failed}`);
  if (failures.length) {
    console.log(`\nFailed titles:`);
    failures.forEach(f => console.log(`  - ${f}`));
  }
  console.log(`\nTotal movies in library: ${movies.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
