#!/usr/bin/env node
/**
 * Import Letterboxd ratings into existing movies.json entries.
 * - Parses ratings.csv from the letterboxd-ratings-import folder
 * - Matches by title + year against movies already in the library
 * - Updates the "rating" field for matched movies (only if currently 0)
 * - Does NOT add new titles — only existing entries are touched
 *
 * Usage: node scripts/import-letterboxd-ratings.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');
const MOVIES_PATH = resolve(ROOT, 'data/movies.json');
const RATINGS_CSV = resolve(ROOT, 'letterboxd/ratings.csv');

// ---- helpers ----

/** Normalise a title for fuzzy matching */
function norm(t) {
  return t
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[:.!?–—&]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse the Letterboxd ratings CSV into an array of { name, year, rating } */
function parseRatingsCsv(text) {
  const lines = text.trim().split('\n');
  // Header: Date,Name,Year,Letterboxd URI,Rating
  const entries = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Use a simple CSV parse that handles commas inside quoted fields
    const cols = parseCsvLine(line);
    if (cols.length < 5) continue;

    const name = cols[1].trim();
    const year = parseInt(cols[2], 10) || 0;
    const rating = parseFloat(cols[4]);
    if (!name || isNaN(rating)) continue;

    entries.push({ name, year, rating });
  }
  return entries;
}

/** Minimal CSV line parser that respects quoted fields */
function parseCsvLine(line) {
  const cols = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

/** Extract release year from a movie's releaseDate string */
function releaseYear(movie) {
  return parseInt((movie.releaseDate || '').split('-')[0], 10) || 0;
}

// ---- main ----

function main() {
  console.log('Reading Letterboxd ratings CSV...');
  const csvText = readFileSync(RATINGS_CSV, 'utf-8');
  const ratings = parseRatingsCsv(csvText);
  console.log(`Parsed ${ratings.length} ratings from CSV\n`);

  const movies = JSON.parse(readFileSync(MOVIES_PATH, 'utf-8'));

  // Build lookup maps: norm(title) -> array of movies (multiple movies can share a normalised title)
  const byNorm = new Map();
  for (const m of movies) {
    const key = norm(m.title);
    if (!byNorm.has(key)) byNorm.set(key, []);
    byNorm.get(key).push(m);
  }

  let matched = 0;
  let updated = 0;
  let skippedAlreadyRated = 0;
  let noMatch = 0;
  const unmatchedTitles = [];

  for (const { name, year, rating } of ratings) {
    const key = norm(name);
    const candidates = byNorm.get(key);

    if (!candidates || candidates.length === 0) {
      noMatch++;
      unmatchedTitles.push(`${name} (${year})`);
      continue;
    }

    // Pick the best candidate — prefer exact year match
    let match = candidates.length === 1
      ? candidates[0]
      : candidates.find(m => releaseYear(m) === year) || candidates[0];

    matched++;

    if (match.rating && match.rating > 0) {
      skippedAlreadyRated++;
      console.log(`— "${match.title}" already rated ${match.rating}, skipping (Letterboxd: ${rating})`);
      continue;
    }

    match.rating = rating;
    updated++;
    console.log(`✓ "${match.title}" → ${rating} ★`);
  }

  // Save
  writeFileSync(MOVIES_PATH, JSON.stringify(movies, null, 2) + '\n', 'utf-8');

  console.log(`\n========== DONE ==========`);
  console.log(`CSV ratings:        ${ratings.length}`);
  console.log(`Matched:            ${matched}`);
  console.log(`Updated:            ${updated}`);
  console.log(`Already rated:      ${skippedAlreadyRated} (kept existing)`);
  console.log(`No match in library: ${noMatch}`);
  if (unmatchedTitles.length) {
    console.log(`\nUnmatched titles (not in library — ignored):`);
    for (const t of unmatchedTitles) {
      console.log(`  - ${t}`);
    }
  }
  console.log(`\nTotal movies in library: ${movies.length}`);
}

main();
