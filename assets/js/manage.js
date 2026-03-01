/* ============================================================
   Movies Everywhere — manage.js
   Admin page: TMDB search, add / edit / delete, save JSON
   ============================================================ */

const Manage = (() => {
  'use strict';

  const FORMAT_META = {
    'VCD':             { category: 'physical', label: 'VCD' },
    'DVD':             { category: 'physical', label: 'DVD' },
    'Blu-Ray':         { category: 'physical', label: 'Blu-Ray' },
    'UHD Blu-Ray':     { category: 'physical', label: 'UHD Blu-Ray' },
    '3D DVD':          { category: 'physical', label: '3D DVD' },
    '3D Blu-Ray':      { category: 'physical', label: '3D Blu-Ray' },
    'Apple TV':        { category: 'digital',  label: 'Apple TV' },
    'YouTube':         { category: 'digital',  label: 'YouTube' },
    'Google Play':     { category: 'digital',  label: 'Google Play' },
    'Fandango At Home':{ category: 'digital',  label: 'Fandango At Home' },
    'Xfinity':         { category: 'digital',  label: 'Xfinity' },
    'Verizon':         { category: 'digital',  label: 'Verizon' },
    'DirecTV':         { category: 'digital',  label: 'DirecTV' },
    'Prime Video':     { category: 'digital',  label: 'Prime Video' },
    'Plex':            { category: 'digital',  label: 'Plex' },
  };

  let movies = [];
  let config = {};
  let editIndex = -1;
  let debounceTimer = null;
  let genreMap = {};
  let currentRating = 0;
  let currentTags = [];

  // ---------- Init ----------
  async function init() {
    try {
      [config, movies] = await Promise.all([
        fetch('data/config.json').then(r => r.json()),
        fetch('data/movies.json').then(r => r.json()),
      ]);
    } catch (e) {
      console.error('Failed to load data:', e);
      movies = [];
      config = {};
    }
    await loadGenreMap();
    renderCustomFieldCheckboxes();
    renderTable();
    bindSearch();
    bindForm();
    bindStarPicker();
    bindTagInput();
    updateCount();
  }

  // ---------- Custom field checkboxes ----------
  function renderCustomFieldCheckboxes() {
    const container = document.getElementById('custom-field-checks');
    if (!container) return;
    container.innerHTML = '';
    const fields = config.customFields || [];
    if (fields.length === 0) {
      container.innerHTML = '<span class="text-secondary" style="font-size:.8rem">None configured. Add fields in config.json</span>';
      return;
    }
    fields.forEach(f => {
      const id = `cf-${f.replace(/\s+/g, '-').toLowerCase()}`;
      const div = document.createElement('div');
      div.className = 'form-check';
      div.innerHTML = `<input class="form-check-input custom-field-cb" type="checkbox" value="${f}" id="${id}"><label class="form-check-label" for="${id}">${f}</label>`;
      container.appendChild(div);
    });
  }

  // ---------- Table ----------
  function renderTable() {
    const body = document.getElementById('movies-tbody');
    if (!body) return;
    body.innerHTML = '';

    if (movies.length === 0) {
      body.innerHTML = '<tr><td colspan="6" class="text-center text-secondary">No movies yet. Use the form above to add titles.</td></tr>';
      return;
    }

    movies.forEach((m, i) => {
      const formats = [...(m.formats?.physical || []), ...(m.formats?.digital || [])].join(', ');
      const stars = m.rating ? '★'.repeat(Math.floor(m.rating)) + (m.rating % 1 ? '½' : '') : '—';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${m.tmdbId || ''}</td>
        <td>${escHtml(m.title)}</td>
        <td>${m.releaseDate || ''}</td>
        <td style="font-size:.82rem">${stars}</td>
        <td style="font-size:.82rem">${escHtml(formats)}</td>
        <td class="text-end text-nowrap">
          <button class="btn btn-sm btn-outline-light me-1" data-edit="${i}" title="Edit">✏️</button>
          <button class="btn btn-sm btn-outline-danger" data-delete="${i}" title="Delete">🗑️</button>
        </td>`;
      body.appendChild(tr);
    });

    body.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => startEdit(parseInt(btn.dataset.edit)));
    });
    body.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', () => deleteMovie(parseInt(btn.dataset.delete)));
    });
  }

  function updateCount() {
    const el = document.getElementById('movie-count');
    if (el) el.textContent = `${movies.length} title${movies.length !== 1 ? 's' : ''}`;
  }

  // ---------- Genre map ----------
  async function loadGenreMap() {
    if (!config.tmdbApiKey || config.tmdbApiKey === 'YOUR_TMDB_API_KEY_HERE') return;
    try {
      const url = `https://api.themoviedb.org/3/genre/movie/list?api_key=${encodeURIComponent(config.tmdbApiKey)}&language=en-US`;
      const res = await fetch(url);
      const data = await res.json();
      (data.genres || []).forEach(g => { genreMap[g.id] = g.name; });
    } catch (e) { console.warn('Could not load genre list:', e); }
  }

  // ---------- TMDB Search ----------
  function bindSearch() {
    const input = document.getElementById('search-input');
    const list = document.getElementById('tmdb-results');
    if (!input || !list) return;

    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      const q = input.value.trim();
      if (q.length < 2) { list.innerHTML = ''; list.style.display = 'none'; return; }
      debounceTimer = setTimeout(() => searchTmdb(q), 350);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#search-wrapper')) list.style.display = 'none';
    });
  }

  async function searchTmdb(query) {
    const list = document.getElementById('tmdb-results');
    if (!config.tmdbApiKey || config.tmdbApiKey === 'YOUR_TMDB_API_KEY_HERE') {
      list.innerHTML = '<li class="text-warning px-3 py-2">Set your TMDB API key in data/config.json</li>';
      list.style.display = 'block';
      return;
    }
    try {
      const url = `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(config.tmdbApiKey)}&query=${encodeURIComponent(query)}&include_adult=false`;
      const res = await fetch(url);
      const data = await res.json();
      renderSearchResults(data.results || []);
    } catch (err) {
      console.error('TMDB search error:', err);
      list.innerHTML = '<li class="text-danger px-3 py-2">API error — check console</li>';
      list.style.display = 'block';
    }
  }

  function renderSearchResults(results) {
    const list = document.getElementById('tmdb-results');
    list.innerHTML = '';
    if (results.length === 0) {
      list.innerHTML = '<li class="text-secondary px-3 py-2">No results found</li>';
      list.style.display = 'block';
      return;
    }
    const imgBase = config.tmdbImageBase || 'https://image.tmdb.org/t/p/w500';
    results.slice(0, 10).forEach(r => {
      const year = r.release_date ? r.release_date.substring(0, 4) : '—';
      const thumb = r.poster_path ? `${imgBase}${r.poster_path}` : '';
      const li = document.createElement('li');
      li.innerHTML = `
        ${thumb ? `<img src="${thumb}" alt="">` : '<span style="width:32px;height:48px;display:inline-block;background:#333;border-radius:3px;flex-shrink:0;"></span>'}
        <span><span class="result-title">${escHtml(r.title)}</span> <span class="result-year">(${year})</span></span>`;
      li.addEventListener('click', () => selectResult(r));
      list.appendChild(li);
    });
    list.style.display = 'block';
  }

  async function selectResult(r) {
    document.getElementById('search-input').value = r.title;
    document.getElementById('tmdb-results').style.display = 'none';

    document.getElementById('field-tmdbId').value = r.id || '';
    document.getElementById('field-title').value = r.title || '';
    document.getElementById('field-releaseDate').value = r.release_date || '';
    document.getElementById('field-overview').value = r.overview || '';
    document.getElementById('field-posterPath').value = r.poster_path || '';

    const genres = (r.genre_ids || []).slice(0, 3).map(id => genreMap[id]).filter(Boolean);
    document.getElementById('field-genres').value = genres.join(', ');

    await fetchCredits(r.id);
  }

  async function fetchCredits(tmdbId) {
    document.getElementById('field-director').value = '';
    document.getElementById('field-cast').value = '';
    if (!config.tmdbApiKey || config.tmdbApiKey === 'YOUR_TMDB_API_KEY_HERE' || !tmdbId) return;
    try {
      const url = `https://api.themoviedb.org/3/movie/${tmdbId}/credits?api_key=${encodeURIComponent(config.tmdbApiKey)}`;
      const res = await fetch(url);
      const data = await res.json();
      const director = (data.crew || []).find(c => c.job === 'Director');
      document.getElementById('field-director').value = director ? director.name : '';
      const topCast = (data.cast || []).slice(0, 3).map(c => c.name);
      document.getElementById('field-cast').value = topCast.join(', ');
    } catch (e) { console.warn('Could not fetch credits:', e); }
  }

  // ---------- Star rating picker ----------
  function bindStarPicker() {
    const container = document.getElementById('star-picker');
    if (!container) return;
    renderStarPicker();

    container.addEventListener('click', (e) => {
      const star = e.target.closest('[data-value]');
      if (!star) return;
      const rect = star.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const isHalf = x < rect.width / 2;
      const val = parseFloat(star.dataset.value);
      currentRating = isHalf ? val - 0.5 : val;
      if (currentRating <= 0) currentRating = 0.5;
      renderStarPicker();
    });

    // Double-click to clear
    container.addEventListener('dblclick', () => {
      currentRating = 0;
      renderStarPicker();
    });
  }

  function renderStarPicker() {
    const container = document.getElementById('star-picker');
    if (!container) return;
    let html = '';
    for (let i = 1; i <= 5; i++) {
      let cls = 'star-pick empty';
      if (currentRating >= i) cls = 'star-pick filled';
      else if (currentRating >= i - 0.5) cls = 'star-pick half';
      html += `<span class="${cls}" data-value="${i}">★</span>`;
    }
    html += `<span class="text-secondary ms-2" style="font-size:.8rem">${currentRating > 0 ? currentRating + '/5' : 'Click to rate, double-click to clear'}</span>`;
    container.innerHTML = html;
  }

  // ---------- Tag input ----------
  function bindTagInput() {
    const input = document.getElementById('tag-input');
    const btn = document.getElementById('tag-add-btn');
    if (!input) return;

    const addTag = () => {
      const val = input.value.trim();
      if (val && !currentTags.includes(val)) {
        currentTags.push(val);
        renderTags();
      }
      input.value = '';
    };

    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } });
    btn?.addEventListener('click', addTag);
  }

  function renderTags() {
    const container = document.getElementById('tag-list');
    if (!container) return;
    container.innerHTML = currentTags.map((t, i) =>
      `<span class="movie-tag">${escHtml(t)} <button type="button" class="btn-close btn-close-white" style="font-size:.5rem;vertical-align:middle" data-remove-tag="${i}"></button></span>`
    ).join('');

    container.querySelectorAll('[data-remove-tag]').forEach(btn => {
      btn.addEventListener('click', () => {
        currentTags.splice(parseInt(btn.dataset.removeTag), 1);
        renderTags();
      });
    });
  }

  // ---------- Form ----------
  function bindForm() {
    const form = document.getElementById('movie-form');
    if (!form) return;
    form.addEventListener('submit', (e) => { e.preventDefault(); saveFromForm(); });
    document.getElementById('btn-cancel')?.addEventListener('click', resetForm);
  }

  function saveFromForm() {
    const movie = {
      tmdbId: parseInt(document.getElementById('field-tmdbId').value) || 0,
      title: document.getElementById('field-title').value.trim(),
      releaseDate: document.getElementById('field-releaseDate').value.trim(),
      overview: document.getElementById('field-overview').value.trim(),
      posterPath: document.getElementById('field-posterPath').value.trim(),
      genres: document.getElementById('field-genres').value.trim()
        ? document.getElementById('field-genres').value.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      director: document.getElementById('field-director').value.trim(),
      cast: document.getElementById('field-cast').value.trim()
        ? document.getElementById('field-cast').value.split(',').map(s => s.trim()).filter(Boolean)
        : [],
      rating: currentRating,
      tags: [...currentTags],
      customTags: {},
      formats: { physical: [], digital: [] },
      digitalQuality: [],
    };

    if (!movie.title) { alert('Title is required'); return; }

    // Collect checked formats
    document.querySelectorAll('#movie-form .format-cb:checked').forEach(cb => {
      const key = cb.value;
      const meta = FORMAT_META[key];
      if (meta) movie.formats[meta.category].push(key);
    });

    // Collect digital quality checkboxes
    document.querySelectorAll('#movie-form .dq-cb:checked').forEach(cb => {
      movie.digitalQuality.push(cb.value);
    });

    // Collect custom field checkboxes
    document.querySelectorAll('#custom-field-checks .custom-field-cb:checked').forEach(cb => {
      movie.customTags[cb.value] = true;
    });

    if (editIndex >= 0) {
      movies[editIndex] = movie;
    } else {
      if (movie.tmdbId && movies.some(m => m.tmdbId === movie.tmdbId)) {
        if (!confirm(`A movie with TMDB ID ${movie.tmdbId} already exists. Add anyway?`)) return;
      }
      movies.push(movie);
    }

    renderTable();
    updateCount();
    resetForm();
  }

  function startEdit(index) {
    editIndex = index;
    const m = movies[index];
    document.getElementById('search-input').value = m.title;
    document.getElementById('field-tmdbId').value = m.tmdbId || '';
    document.getElementById('field-title').value = m.title || '';
    document.getElementById('field-releaseDate').value = m.releaseDate || '';
    document.getElementById('field-overview').value = m.overview || '';
    document.getElementById('field-posterPath').value = m.posterPath || '';
    document.getElementById('field-genres').value = (m.genres || []).join(', ');
    document.getElementById('field-director').value = m.director || '';
    document.getElementById('field-cast').value = (m.cast || []).join(', ');

    // Rating
    currentRating = m.rating || 0;
    renderStarPicker();

    // Tags
    currentTags = [...(m.tags || [])];
    renderTags();

    // Format checkboxes
    const allFormats = [...(m.formats?.physical || []), ...(m.formats?.digital || [])];
    document.querySelectorAll('#movie-form .format-cb').forEach(cb => {
      cb.checked = allFormats.includes(cb.value);
    });

    // Digital quality checkboxes
    const dq = m.digitalQuality || [];
    document.querySelectorAll('#movie-form .dq-cb').forEach(cb => {
      cb.checked = dq.includes(cb.value);
    });

    // Custom fields
    const ct = m.customTags || {};
    document.querySelectorAll('#custom-field-checks .custom-field-cb').forEach(cb => {
      cb.checked = !!ct[cb.value];
    });

    document.getElementById('form-heading').textContent = 'Edit Movie';
    document.getElementById('btn-submit').textContent = 'Update Movie';
    document.getElementById('btn-cancel').style.display = 'inline-block';
    document.getElementById('search-input').scrollIntoView({ behavior: 'smooth' });
  }

  function deleteMovie(index) {
    const title = movies[index]?.title || 'this movie';
    if (!confirm(`Remove "${title}" from your library?`)) return;
    movies.splice(index, 1);
    if (editIndex === index) resetForm();
    if (editIndex > index) editIndex--;
    renderTable();
    updateCount();
  }

  function resetForm() {
    editIndex = -1;
    document.getElementById('movie-form').reset();
    document.getElementById('field-tmdbId').value = '';
    document.getElementById('field-posterPath').value = '';
    document.getElementById('field-genres').value = '';
    document.getElementById('field-director').value = '';
    document.getElementById('field-cast').value = '';
    currentRating = 0;
    renderStarPicker();
    currentTags = [];
    renderTags();
    // Reset quality checkboxes
    document.querySelectorAll('#movie-form .dq-cb').forEach(cb => { cb.checked = false; });
    // Reset custom fields
    document.querySelectorAll('#custom-field-checks .custom-field-cb').forEach(cb => { cb.checked = false; });
    document.getElementById('form-heading').textContent = 'Add Movie';
    document.getElementById('btn-submit').textContent = 'Add Movie';
    document.getElementById('btn-cancel').style.display = 'none';
    document.getElementById('tmdb-results').style.display = 'none';
  }

  // ---------- Save / Export JSON ----------
  function exportJson() {
    const json = JSON.stringify(movies, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'movies.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ---------- Import JSON ----------
  function importJson() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!Array.isArray(data)) { alert('Invalid format: expected a JSON array.'); return; }
        movies = data;
        renderTable();
        updateCount();
      } catch (e) { alert('Failed to parse JSON file.'); }
    });
    input.click();
  }

  // ---------- Helpers ----------
  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  return { init, exportJson, importJson };
})();

document.addEventListener('DOMContentLoaded', Manage.init);
