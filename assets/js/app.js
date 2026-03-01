/* ============================================================
   Movies Everywhere — app.js
   Core logic: load data, render grid, sort, filter, detail view
   ============================================================ */

const App = (() => {
  'use strict';

  // ---------- Format definitions ----------
  const FORMAT_META = {
    // Physical
    'VCD':             { category: 'physical', logo: 'assets/logos/vcd.svg',             label: 'VCD' },
    'DVD':             { category: 'physical', logo: 'assets/logos/dvd.svg',             label: 'DVD' },
    'Blu-Ray':         { category: 'physical', logo: 'assets/logos/blu-ray.svg',         label: 'Blu-Ray' },
    'UHD Blu-Ray':     { category: 'physical', logo: 'assets/logos/uhd-blu-ray.svg',     label: 'UHD Blu-Ray' },
    '3D DVD':          { category: 'physical', logo: 'assets/logos/dvd-3d.svg',           label: '3D DVD' },
    '3D Blu-Ray':      { category: 'physical', logo: 'assets/logos/blu-ray-3d.svg',      label: '3D Blu-Ray' },
    // Digital
    'Apple TV':        { category: 'digital', logo: 'assets/logos/apple-tv.svg',         label: 'Apple TV',          url: 'https://tv.apple.com/search?term={q}' },
    'YouTube':         { category: 'digital', logo: 'assets/logos/youtube.svg',           label: 'YouTube',           url: 'https://www.youtube.com/results?search_query={q}' },
    'Google Play':     { category: 'digital', logo: 'assets/logos/google-play.svg',       label: 'Google Play',       url: 'https://play.google.com/store/search?q={q}&c=movies' },
    'Fandango At Home':{ category: 'digital', logo: 'assets/logos/fandango-at-home.svg',  label: 'Fandango At Home',  url: 'https://athome.fandango.com/content/browse/search?searchString={q}' },
    'Xfinity':         { category: 'digital', logo: 'assets/logos/xfinity.svg',           label: 'Xfinity' },
    'Verizon':         { category: 'digital', logo: 'assets/logos/verizon.svg',            label: 'Verizon' },
    'DirecTV':         { category: 'digital', logo: 'assets/logos/directv.svg',            label: 'DirecTV' },
    'Prime Video':     { category: 'digital', logo: 'assets/logos/prime-video.svg',        label: 'Prime Video',       url: 'https://www.primevideo.com/search/ref=atv_nb_sug?ie=UTF8&phrase={q}' },
    'Movies Anywhere': { category: 'digital', logo: 'assets/logos/moviesanywhere.png',    label: 'Movies Anywhere',  url: 'https://moviesanywhere.com/movie/{slug}' },
    'Plex':            { category: 'digital', logo: 'assets/logos/plex.svg',               label: 'Plex',              url: 'https://app.plex.tv/desktop/#!/search?pivot=top&query={q}' },
  };

  let movies = [];
  let config = {};
  let currentSort = 'date-desc';
  let activeFilter = 'all';
  let searchQuery = '';
  let detailOpen = false;   // tracks whether a detail view (modal or fullscreen) is open
  let closingViaBack = false; // prevents double history.back()

  // ---------- Bootstrap ----------
  async function init() {
    showLoading(true);
    try {
      [config, movies] = await Promise.all([
        fetch('data/config.json').then(r => r.json()),
        fetch('data/movies.json').then(r => r.json()),
      ]);
    } catch (e) {
      console.error('Failed to load data:', e);
      movies = [];
      config = { posterMode: 'remote', tmdbImageBase: 'https://image.tmdb.org/t/p/w500', customFields: [] };
    }

    renderSortButtons();
    renderFilters();
    bindSearch();
    initMobileUI();
    bindHistoryNav();
    bindPosterHero();
    renderGrid();

    if (config.posterMode === 'remote' && movies.length) {
      await waitForImages();
    }
    showLoading(false);
  }

  // ---------- Loading screen ----------
  function showLoading(show) {
    const el = document.getElementById('loading-screen');
    if (!el) return;
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
  }

  function waitForImages() {
    const imgs = document.querySelectorAll('.poster-card img');
    const promises = Array.from(imgs).map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
    });
    return Promise.all(promises);
  }

  // ---------- Poster URL helper ----------
  function posterUrl(movie) {
    if (config.posterMode === 'local') return `posters/${movie.tmdbId}.jpg`;
    if (movie.posterPath) return `${config.tmdbImageBase || 'https://image.tmdb.org/t/p/w500'}${movie.posterPath}`;
    return '';
  }

  // ---------- Search ----------
  function bindSearch() {
    const input = document.getElementById('search-box');
    const mobileInput = document.getElementById('mobile-search-box');

    function handleSearch(value, syncTarget) {
      searchQuery = value.trim().toLowerCase();
      if (syncTarget) syncTarget.value = value;
      renderGrid();
    }

    if (input) {
      input.addEventListener('input', () => handleSearch(input.value, mobileInput));
    }
    if (mobileInput) {
      mobileInput.addEventListener('input', () => handleSearch(mobileInput.value, input));
    }
  }

  function searchMovies(list) {
    if (!searchQuery) return list;
    return list.filter(m => {
      const haystack = [
        m.title, m.director,
        ...(m.cast || []), ...(m.genres || []), ...(m.tags || []),
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(searchQuery);
    });
  }

  // ---------- Sorting ----------
  function sortMovies(list) {
    const sorted = [...list];
    if (currentSort === 'date-desc') {
      sorted.sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''));
    } else if (currentSort === 'alpha-asc') {
      sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else if (currentSort === 'rating-desc') {
      sorted.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    }
    return sorted;
  }

  function renderSortButtons() {
    const container = document.getElementById('sort-buttons');
    if (!container) return;
    container.innerHTML = '';

    const sorts = [
      { key: 'date-desc', label: 'Newest' },
      { key: 'alpha-asc', label: 'A–Z' },
      { key: 'rating-desc', label: '★ Rated' },
    ];

    sorts.forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm ' + (s.key === currentSort ? 'btn-light' : 'btn-outline-light');
      btn.dataset.sort = s.key;
      btn.textContent = s.label;
      btn.addEventListener('click', () => {
        currentSort = s.key;
        container.querySelectorAll('.btn').forEach(b => { b.className = 'btn btn-sm btn-outline-light'; });
        btn.className = 'btn btn-sm btn-light';
        renderGrid();
      });
      container.appendChild(btn);
    });
  }

  // ---------- Filtering ----------
  function getUsedFormats() {
    const used = new Set();
    movies.forEach(m => {
      if (!m.formats) return;
      (m.formats.physical || []).forEach(f => used.add(f));
      (m.formats.digital || []).forEach(f => used.add(f));
    });
    return used;
  }

  function getUsedCustomFields() {
    const fields = config.customFields || [];
    const used = new Set();
    movies.forEach(m => {
      if (!m.customTags) return;
      fields.forEach(f => { if (m.customTags[f]) used.add(f); });
    });
    return used;
  }

  function renderFilters() {
    const container = document.getElementById('filter-chips');
    const mobileContainer = document.getElementById('me-filter-chips');
    if (!container && !mobileContainer) return;
    if (container) container.innerHTML = '';
    if (mobileContainer) mobileContainer.innerHTML = '';

    const usedFormats = getUsedFormats();
    const hasPhysical = movies.some(m => m.formats?.physical?.length > 0);
    const hasDigital = movies.some(m => m.formats?.digital?.length > 0);

    const chips = [{ key: 'all', label: 'All Movies' }];
    if (hasDigital) chips.push({ key: 'digital', label: 'Digital' });
    if (hasPhysical) chips.push({ key: 'physical', label: 'Physical' });

    Object.keys(FORMAT_META).forEach(key => {
      if (usedFormats.has(key)) chips.push({ key, label: FORMAT_META[key].label });
    });

    // Custom fields in use
    getUsedCustomFields().forEach(f => {
      chips.push({ key: `custom:${f}`, label: f });
    });

    function syncActiveFilter(key, label) {
      activeFilter = key;
      if (container) container.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
      if (mobileContainer) mobileContainer.querySelectorAll('.me-filter-chip').forEach(b => b.classList.remove('active'));
      document.querySelectorAll(`[data-filter="${key}"]`).forEach(b => b.classList.add('active'));
      const labelEl = document.getElementById('activeFilterLabel');
      if (labelEl) labelEl.textContent = label;
      renderGrid();
    }

    const topLevelKeys = new Set(['all', 'digital', 'physical']);
    let dividerInserted = false;

    chips.forEach((c, i) => {
      // Insert divider after the last top-level chip
      if (!dividerInserted && !topLevelKeys.has(c.key)) {
        dividerInserted = true;
        if (container) {
          const sep = document.createElement('span');
          sep.className = 'filter-divider';
          container.appendChild(sep);
        }
        if (mobileContainer) {
          const sep = document.createElement('span');
          sep.className = 'me-filter-divider';
          mobileContainer.appendChild(sep);
        }
      }
      // Desktop chip
      if (container) {
        const btn = document.createElement('button');
        btn.className = 'filter-chip' + (c.key === activeFilter ? ' active' : '');
        btn.dataset.filter = c.key;
        btn.textContent = c.label;
        btn.addEventListener('click', () => syncActiveFilter(c.key, c.label));
        container.appendChild(btn);
      }
      // Mobile glass chip
      if (mobileContainer) {
        const btn = document.createElement('button');
        btn.className = 'me-filter-chip' + (c.key === activeFilter ? ' active' : '');
        btn.dataset.filter = c.key;
        btn.textContent = c.label;
        btn.addEventListener('click', () => syncActiveFilter(c.key, c.label));
        mobileContainer.appendChild(btn);
      }
    });

    // Set initial active filter label
    const labelEl = document.getElementById('activeFilterLabel');
    const activeChip = chips.find(c => c.key === activeFilter);
    if (labelEl && activeChip) labelEl.textContent = activeChip.label;
  }

  function filterMovies(list) {
    if (activeFilter === 'all') return list;
    if (activeFilter === 'physical') return list.filter(m => m.formats?.physical?.length > 0);
    if (activeFilter === 'digital') return list.filter(m => m.formats?.digital?.length > 0);
    if (activeFilter.startsWith('custom:')) {
      const field = activeFilter.slice(7);
      return list.filter(m => m.customTags && m.customTags[field]);
    }
    const meta = FORMAT_META[activeFilter];
    if (!meta) return list;
    return list.filter(m => m.formats && m.formats[meta.category]?.includes(activeFilter));
  }

  // ---------- Grid rendering ----------
  function renderGrid() {
    const grid = document.getElementById('poster-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const visible = sortMovies(filterMovies(searchMovies(movies)));

    if (visible.length === 0) {
      grid.innerHTML = '<div class="text-center text-secondary py-5 w-100" style="grid-column:1/-1;">No movies found.</div>';
      return;
    }

    visible.forEach(movie => {
      const card = document.createElement('div');
      card.className = 'poster-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.setAttribute('aria-label', movie.title);

      const src = posterUrl(movie);
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.alt = movie.title;
        img.loading = 'lazy';
        img.onerror = function () {
          this.style.display = 'none';
          const ph = document.createElement('div');
          ph.className = 'poster-placeholder';
          ph.textContent = movie.title;
          card.appendChild(ph);
        };
        card.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'poster-placeholder';
        ph.textContent = movie.title;
        card.appendChild(ph);
      }

      card.addEventListener('click', () => openDetail(movie));
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDetail(movie); });
      grid.appendChild(card);
    });
  }

  // ---------- Detail view ----------
  function openDetail(movie) {
    if (window.innerWidth < 768) openFullScreen(movie);
    else openModal(movie);
  }

  function buildStars(rating) {
    if (!rating || rating <= 0) return '<span class="text-secondary" style="font-size:.85rem">Not rated</span>';
    let html = '';
    for (let i = 1; i <= 5; i++) {
      if (rating >= i) html += '<span class="star filled">★</span>';
      else if (rating >= i - 0.5) html += '<span class="star half">★</span>';
      else html += '<span class="star empty">★</span>';
    }
    return html;
  }

  function buildGenreTags(movie) {
    if (!movie.genres || movie.genres.length === 0) return '';
    return movie.genres.map(g => `<span class="genre-tag">${g}</span>`).join('');
  }

  function buildCredits(movie) {
    let html = '';
    if (movie.director) html += `<p class="detail-credits-line"><span class="credits-label">Director</span> ${movie.director}</p>`;
    if (movie.cast?.length > 0) html += `<p class="detail-credits-line"><span class="credits-label">Cast</span> ${movie.cast.join(', ')}</p>`;
    return html;
  }

  function buildFormatBadges(movie) {
    if (!movie.formats) return '';
    const dq = movie.digitalQuality || [];
    const qbHtml = dq.map(q => `<span class="quality-badge quality-${q.toLowerCase()}">${q}</span>`).join(' ');

    let physicalHtml = '';
    (movie.formats.physical || []).forEach(f => {
      const meta = FORMAT_META[f];
      if (!meta) return;
      physicalHtml += `<span class="format-badge" data-bs-toggle="tooltip" data-bs-title="${meta.label}"><img src="${meta.logo}" alt="${meta.label}"></span>`;
    });

    let digitalHtml = '';
    const title = encodeURIComponent(movie.title || '');
    const slug = (movie.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    (movie.formats.digital || []).forEach(f => {
      const meta = FORMAT_META[f];
      if (!meta) return;
      if (meta.url) {
        const href = meta.url.replace('{q}', title).replace('{slug}', slug);
        digitalHtml += `<a class="format-badge format-badge-link" href="${href}" target="_blank" rel="noopener" data-bs-toggle="tooltip" data-bs-title="${meta.label}"><img src="${meta.logo}" alt="${meta.label}"></a>`;
      } else {
        digitalHtml += `<span class="format-badge" data-bs-toggle="tooltip" data-bs-title="${meta.label}"><img src="${meta.logo}" alt="${meta.label}"></span>`;
      }
    });
    if (qbHtml) digitalHtml += `<span class="format-badge">${qbHtml}</span>`;

    let html = '';
    if (physicalHtml) {
      html += `<div class="format-section"><span class="format-section-label">Physical</span><div class="format-badges">${physicalHtml}</div></div>`;
    }
    if (digitalHtml) {
      html += `<div class="format-section"><span class="format-section-label">Digital</span><div class="format-badges">${digitalHtml}</div></div>`;
    }
    return html;
  }

  function buildTags(movie) {
    const items = [...(movie.tags || [])];
    (config.customFields || []).forEach(f => {
      if (movie.customTags && movie.customTags[f]) items.push(f);
    });
    if (items.length === 0) return '';
    return '<div class="movie-tags">' + items.map(t => `<span class="movie-tag">${t}</span>`).join('') + '</div>';
  }

  function populateDetail(prefix, movie) {
    document.getElementById(`${prefix}-title`).textContent = movie.title || '';
    document.getElementById(`${prefix}-date`).textContent = movie.releaseDate ? `Release: ${movie.releaseDate}` : '';
    document.getElementById(`${prefix}-rating`).innerHTML = buildStars(movie.rating);
    document.getElementById(`${prefix}-genres`).innerHTML = buildGenreTags(movie);
    document.getElementById(`${prefix}-credits`).innerHTML = buildCredits(movie);
    document.getElementById(`${prefix}-overview`).textContent = movie.overview || '';
    document.getElementById(`${prefix}-formats`).innerHTML = buildFormatBadges(movie);
    document.getElementById(`${prefix}-formats`).querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => new bootstrap.Tooltip(el));
    document.getElementById(`${prefix}-tags`).innerHTML = buildTags(movie);
    const posterImg = document.getElementById(`${prefix}-poster`);
    const src = posterUrl(movie);
    posterImg.src = src || '';
    posterImg.alt = movie.title;
    posterImg.style.display = src ? 'block' : 'none';

    // Fullscreen-specific: set blurred BG + full poster for overlay
    if (prefix === 'fs') {
      const bg = document.getElementById('fs-bg');
      if (bg) bg.style.backgroundImage = src ? `url('${src}')` : 'none';
      const fullImg = document.getElementById('fs-poster-full');
      if (fullImg) { fullImg.src = src || ''; fullImg.alt = movie.title; }
    }
  }

  function openModal(movie) {
    const el = document.getElementById('detailModal');
    if (!el) return;
    populateDetail('detail', movie);
    const modal = new bootstrap.Modal(el);
    modal.show();
    pushDetailState();

    // When Bootstrap hides the modal (X button, backdrop click, Esc),
    // pop the history entry so the URL stays clean.
    el.addEventListener('hidden.bs.modal', function onHidden() {
      el.removeEventListener('hidden.bs.modal', onHidden);
      popDetailState();
    });
  }

  function openFullScreen(movie) {
    const fs = document.getElementById('detail-fullscreen');
    if (!fs) return;
    populateDetail('fs', movie);
    fs.classList.add('open');
    document.body.style.overflow = 'hidden';
    pushDetailState();
  }

  function closeFullScreen() {
    const fs = document.getElementById('detail-fullscreen');
    if (fs) fs.classList.remove('open');
    // Also close poster overlay if open
    const overlay = document.getElementById('fs-poster-overlay');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
    popDetailState();
  }

  // ---------- Poster hero: tap to expand / collapse ----------
  function bindPosterHero() {
    const hero = document.getElementById('fs-poster-hero');
    const overlay = document.getElementById('fs-poster-overlay');
    if (!hero || !overlay) return;

    hero.addEventListener('click', () => {
      overlay.classList.add('open');
    });

    overlay.addEventListener('click', () => {
      overlay.classList.remove('open');
    });
  }

  // ---------- History / back-button support ----------
  function pushDetailState() {
    if (!detailOpen) {
      detailOpen = true;
      history.pushState({ detailOpen: true }, '');
    }
  }

  function popDetailState() {
    if (detailOpen) {
      detailOpen = false;
      if (!closingViaBack) {
        // Closed via UI (button / backdrop) — remove the history entry we pushed
        history.back();
      }
    }
  }

  function bindHistoryNav() {
    window.addEventListener('popstate', () => {
      if (!detailOpen) return;

      closingViaBack = true;

      // Close Bootstrap modal if visible
      const modalEl = document.getElementById('detailModal');
      const modalInstance = modalEl && bootstrap.Modal.getInstance(modalEl);
      if (modalInstance) modalInstance.hide();

      // Close fullscreen overlay if visible
      const fs = document.getElementById('detail-fullscreen');
      if (fs && fs.classList.contains('open')) {
        fs.classList.remove('open');
        document.body.style.overflow = '';
      }
      // Close poster overlay too
      const posterOverlay = document.getElementById('fs-poster-overlay');
      if (posterOverlay) posterOverlay.classList.remove('open');

      detailOpen = false;
      closingViaBack = false;
    });
  }

  // ---------- Liquid Glass UI (all screen sizes) ----------
  function initMobileUI() {
    const filterBar = document.getElementById('meFilterBar');
    const activeFilterPill = document.getElementById('activeFilterPill');
    const sortBubble = document.getElementById('sortBubble');
    const searchWrap = document.getElementById('meSearch');
    const searchCollapsedBtn = document.getElementById('meSearchCollapsed');
    const mobileSearchBox = document.getElementById('mobile-search-box');

    // ---- Sort Bubble: tap to expand, select to collapse ----
    if (sortBubble) {
      sortBubble.addEventListener('click', (e) => {
        const btn = e.target.closest('.me-sort-btn');
        if (!btn) return;

        if (!sortBubble.classList.contains('expanded')) {
          // Collapsed → expand to reveal options
          sortBubble.classList.add('expanded');
          e.stopPropagation();
          return;
        }

        // Expanded → pick this sort & collapse
        const sortKey = btn.dataset.sort;
        currentSort = sortKey;
        sortBubble.querySelectorAll('.me-sort-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        sortBubble.classList.remove('expanded');

        // Sync desktop sort buttons
        const desktopBtns = document.getElementById('sort-buttons');
        if (desktopBtns) {
          desktopBtns.querySelectorAll('.btn').forEach(b => {
            b.className = 'btn btn-sm ' + (b.dataset.sort === sortKey ? 'btn-light' : 'btn-outline-light');
          });
        }
        renderGrid();
      });

      // Close sort bubble on outside tap
      document.addEventListener('click', (e) => {
        if (sortBubble.classList.contains('expanded') && !sortBubble.contains(e.target)) {
          sortBubble.classList.remove('expanded');
        }
      });
    }

    // ---- Search: expand / collapse ----
    let searchHasInput = false;

    function expandSearch() {
      if (!searchWrap) return;
      searchWrap.classList.remove('collapsed');
    }

    function collapseSearch() {
      if (!searchWrap || searchHasInput) return;
      searchWrap.classList.add('collapsed');
      mobileSearchBox?.blur();
    }

    if (searchCollapsedBtn) {
      searchCollapsedBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        expandSearch();
        setTimeout(() => mobileSearchBox?.focus(), 350);
      });
    }

    // Focus search on click of submit button too
    const searchSubmitBtn = document.querySelector('.me-search-submit');
    if (searchSubmitBtn && mobileSearchBox) {
      searchSubmitBtn.addEventListener('click', (e) => {
        e.preventDefault();
        mobileSearchBox.focus();
      });
    }

    if (mobileSearchBox) {
      mobileSearchBox.addEventListener('input', () => {
        searchHasInput = mobileSearchBox.value.trim().length > 0;
      });
      // When search loses focus and is empty, reset scroll state so UI normalises
      mobileSearchBox.addEventListener('blur', () => {
        if (!mobileSearchBox.value.trim()) {
          searchHasInput = false;
          const scrollY = window.scrollY;
          if (scrollY <= 10 && isScrolled) {
            isScrolled = false;
            if (filterBar) filterBar.classList.remove('hidden');
            if (activeFilterPill) activeFilterPill.classList.remove('visible');
            expandSearch();
          }
        }
      });
    }

    // ---- Scroll handler: filter bar, active pill, search ----
    let scrollTicking = false;
    let isScrolled = false;

    window.addEventListener('scroll', () => {
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(() => {
        scrollTicking = false;
        const scrollY = window.scrollY;
        const searchFocused = document.activeElement === mobileSearchBox ||
                              document.activeElement === document.getElementById('search-box');

        if (scrollY > 40 && !isScrolled) {
          // Entered scrolled state
          isScrolled = true;
          if (filterBar) filterBar.classList.add('hidden');
          if (activeFilterPill) activeFilterPill.classList.add('visible');
          if (!searchFocused) collapseSearch();
          // Close sort bubble on scroll
          if (sortBubble) sortBubble.classList.remove('expanded');
        } else if (scrollY <= 10 && isScrolled) {
          // Returned to top — but not while user is actively searching
          if (searchFocused || searchHasInput) return;
          isScrolled = false;
          if (filterBar) filterBar.classList.remove('hidden');
          if (activeFilterPill) activeFilterPill.classList.remove('visible');
          expandSearch();
        } else if (isScrolled && !searchHasInput && !searchFocused) {
          // Re-collapse search if user scrolls without typing
          collapseSearch();
        }
      });
    }, { passive: true });
  }

  return { init, closeFullScreen, FORMAT_META };
})();

document.addEventListener('DOMContentLoaded', App.init);
