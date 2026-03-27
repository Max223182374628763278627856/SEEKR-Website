/**
 * SEEKR Widget v1.0 — Barre de recherche IA
 * Fichier servi par le backend : GET /widget/seekr.js
 * S'auto-initialise sur les pages clientes
 */
(function(window, document) {
  'use strict';

  // Config depuis le script tag ou window.SEEKR_CONFIG
  const scriptEl = document.currentScript;
  const CONFIG = Object.assign({
    apiKey: '',
    backendUrl: '',
    site: window.location.hostname,
    placeholder: 'Rechercher…',
    theme: 'light',
    color: '#00E5A0',
    radius: '12',
    containerId: 'seekr-search',
    maxResults: 8,
    suggestDelay: 300,
    searchDelay: 600
  }, window.SEEKR_CONFIG || {}, {
    apiKey: (scriptEl && scriptEl.getAttribute('data-key')) || (window.SEEKR_CONFIG && window.SEEKR_CONFIG.apiKey) || '',
    backendUrl: (scriptEl && scriptEl.getAttribute('data-backend')) || (window.SEEKR_CONFIG && window.SEEKR_CONFIG.backendUrl) || scriptEl?.src?.replace('/widget/seekr.js','') || '',
    placeholder: (scriptEl && scriptEl.getAttribute('data-placeholder')) || 'Rechercher…',
    theme: (scriptEl && scriptEl.getAttribute('data-theme')) || 'light',
    color: (scriptEl && scriptEl.getAttribute('data-color')) || '#00E5A0',
    radius: (scriptEl && scriptEl.getAttribute('data-radius')) || '12',
  });

  // Session ID persistant (RGPD: anonymisé côté serveur)
  let sessionId = sessionStorage.getItem('_sk_sid');
  if (!sessionId) { sessionId = 'sk_' + Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('_sk_sid', sessionId); }

  let lastSearchId = null;
  let suggestTimeout = null;
  let searchTimeout = null;
  let isOpen = false;

  // ========== STYLES ==========
  const isDark = CONFIG.theme === 'dark';
  const bgMain = isDark ? '#1A1F2E' : '#ffffff';
  const bgSub = isDark ? '#141920' : '#F8FAFB';
  const borderCol = isDark ? 'rgba(255,255,255,0.1)' : '#E8ECF0';
  const textMain = isDark ? '#F0F4F8' : '#111827';
  const textSub = isDark ? 'rgba(255,255,255,0.5)' : '#9CA3AF';
  const shadow = isDark ? 'none' : '0 4px 24px rgba(0,0,0,.08)';
  const r = CONFIG.radius + 'px';

  const css = `
    #sk-wrap{position:relative;width:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
    #sk-bar{display:flex;align-items:center;gap:10px;padding:11px 16px;background:${bgMain};border:1.5px solid ${borderCol};border-radius:${r};box-shadow:${shadow};transition:border-color .2s,box-shadow .2s;cursor:text;}
    #sk-bar:focus-within{border-color:${CONFIG.color};box-shadow:0 0 0 3px ${CONFIG.color}28,${shadow};}
    #sk-icon{width:18px;height:18px;flex-shrink:0;color:${textSub};transition:color .2s;}
    #sk-bar:focus-within #sk-icon{color:${CONFIG.color};}
    #sk-input{flex:1;border:none;outline:none;font-size:15px;color:${textMain};background:transparent;font-family:inherit;}
    #sk-input::placeholder{color:${textSub};}
    #sk-clear{display:none;cursor:pointer;color:${textSub};background:none;border:none;padding:2px;border-radius:50%;align-items:center;justify-content:center;transition:all .15s;}
    #sk-clear:hover{background:rgba(0,0,0,.05);}
    #sk-clear.sk-vis{display:flex;}
    #sk-divider{width:1px;height:20px;background:${borderCol};flex-shrink:0;}
    #sk-btn{display:flex;align-items:center;gap:6px;padding:6px 14px;background:${CONFIG.color};border-radius:calc(${r} - 4px);flex-shrink:0;cursor:pointer;border:none;transition:opacity .2s,transform .15s;}
    #sk-btn:hover{opacity:.9;transform:translateY(-1px);}
    #sk-btn-text{font-size:12px;font-weight:700;color:#000;letter-spacing:.3px;}
    #sk-spinner-wrap{display:none;align-items:center;justify-content:center;gap:8px;padding:14px;font-size:13px;color:${textSub};}
    #sk-spinner-wrap.sk-vis{display:flex;}
    #sk-spinner{width:16px;height:16px;border:2px solid ${CONFIG.color}30;border-top-color:${CONFIG.color};border-radius:50%;animation:sk-spin .7s linear infinite;}
    @keyframes sk-spin{to{transform:rotate(360deg);}}
    #sk-dropdown{position:absolute;top:calc(100% + 6px);left:0;right:0;background:${bgMain};border:1.5px solid ${borderCol};border-radius:${r};box-shadow:0 8px 40px rgba(0,0,0,.14);z-index:99999;display:none;overflow:hidden;}
    #sk-dropdown.sk-vis{display:block;animation:sk-in .15s ease;}
    @keyframes sk-in{from{opacity:0;transform:translateY(-6px);}to{opacity:1;transform:none;}}
    .sk-sugg{display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;transition:background .1s;}
    .sk-sugg:hover,.sk-sugg.sk-focus{background:${bgSub};}
    .sk-sugg-icon{width:28px;height:28px;border-radius:6px;background:${CONFIG.color}18;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
    .sk-sugg-text{font-size:13px;color:${textMain};flex:1;}
    .sk-sugg-text em{color:${CONFIG.color};font-style:normal;font-weight:600;}
    .sk-label{padding:8px 14px 4px;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:${textSub};}
    .sk-sep{height:1px;background:${borderCol};margin:4px 0;}
    #sk-results{margin-top:8px;display:none;}
    #sk-results.sk-vis{display:block;}
    .sk-res-hdr{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:${textSub};margin-bottom:8px;}
    .sk-res-hdr strong{color:${textMain};}
    .sk-res-ms{font-size:11px;color:${CONFIG.color};}
    .sk-intent-bar{display:none;align-items:center;gap:8px;font-size:12px;color:${textSub};padding:4px 0 8px;}
    .sk-intent-bar.sk-vis{display:flex;}
    .sk-intent-tag{padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;}
    .sk-card{display:flex;gap:12px;padding:14px;background:${bgMain};border:1.5px solid ${borderCol};border-radius:calc(${r} - 2px);cursor:pointer;transition:all .2s;margin-bottom:8px;text-decoration:none;}
    .sk-card:hover{border-color:${CONFIG.color}60;box-shadow:0 4px 16px ${CONFIG.color}14;transform:translateY(-1px);}
    .sk-card-img{width:56px;height:56px;border-radius:8px;background:${bgSub};flex-shrink:0;object-fit:cover;display:flex;align-items:center;justify-content:center;font-size:24px;}
    .sk-card-body{flex:1;min-width:0;}
    .sk-card-name{font-size:14px;font-weight:600;color:${textMain};margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .sk-card-desc{font-size:12px;color:${textSub};margin-bottom:6px;line-height:1.4;}
    .sk-card-meta{display:flex;align-items:center;gap:8px;}
    .sk-price{font-size:15px;font-weight:700;color:${textMain};}
    .sk-score{font-size:10px;padding:2px 7px;background:${CONFIG.color}18;color:${CONFIG.color === '#00E5A0' ? '#059669' : CONFIG.color};border-radius:20px;font-weight:600;}
    .sk-no-results{padding:20px;text-align:center;font-size:13px;color:${textSub};}
    .sk-powered{display:flex;align-items:center;justify-content:center;gap:5px;padding:10px;font-size:11px;color:${textSub};text-decoration:none;margin-top:4px;}
    .sk-powered strong{color:${CONFIG.color};}
    .sk-ai-footer{display:flex;align-items:center;gap:8px;padding:10px 14px;background:${CONFIG.color}08;border-top:1px solid ${CONFIG.color}20;}
    .sk-ai-dot{width:6px;height:6px;border-radius:50%;background:${CONFIG.color};animation:sk-pulse 2s infinite;}
    @keyframes sk-pulse{0%,100%{opacity:1;}50%{opacity:.4;}}
    .sk-ai-txt{font-size:11px;color:${textSub};}
    .sk-ai-txt strong{color:${textMain};}
  `;

  // ========== INJECT HTML ==========
  function init() {
    const container = document.getElementById(CONFIG.containerId);
    if (!container) return;

    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    container.innerHTML = `
      <div id="sk-wrap">
        <div id="sk-bar">
          <svg id="sk-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input id="sk-input" type="text" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="${CONFIG.placeholder}" aria-label="Rechercher">
          <button id="sk-clear" aria-label="Effacer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
          <div id="sk-divider"></div>
          <button id="sk-btn" aria-label="Rechercher avec SEEKR">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <span id="sk-btn-text">SEEKR</span>
          </button>
        </div>

        <div class="sk-intent-bar" id="sk-intent-bar">
          <span>Intention :</span>
          <span class="sk-intent-tag" id="sk-intent-tag"></span>
          <span id="sk-intent-desc"></span>
        </div>

        <div id="sk-dropdown">
          <div id="sk-dropdown-inner"></div>
          <div class="sk-ai-footer">
            <div class="sk-ai-dot"></div>
            <div class="sk-ai-txt"><strong>SEEKR IA</strong> · Analyse sémantique · Hébergé en France 🇫🇷</div>
          </div>
        </div>

        <div id="sk-spinner-wrap">
          <div id="sk-spinner"></div>
          <span>SEEKR analyse votre recherche…</span>
        </div>

        <div id="sk-results">
          <div class="sk-res-hdr">
            <span id="sk-res-count"></span>
            <span class="sk-res-ms" id="sk-res-ms"></span>
          </div>
          <div id="sk-res-list"></div>
          <a href="https://seekr.ai" class="sk-powered" target="_blank">
            Propulsé par <strong>SEEKR</strong> · IA souveraine 🇫🇷
          </a>
        </div>
      </div>
    `;

    bindEvents();
  }

  // ========== EVENTS ==========
  function bindEvents() {
    const input = document.getElementById('sk-input');
    const clearBtn = document.getElementById('sk-clear');
    const searchBtn = document.getElementById('sk-btn');

    input.addEventListener('input', e => {
      const v = e.target.value;
      clearBtn.classList.toggle('sk-vis', v.length > 0);
      clearTimeout(suggestTimeout);
      clearTimeout(searchTimeout);
      hideResults();
      hideIntentBar();
      if (!v) { hideDropdown(); return; }
      suggestTimeout = setTimeout(() => suggest(v), CONFIG.suggestDelay);
      searchTimeout = setTimeout(() => search(v), CONFIG.searchDelay);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(searchTimeout); search(input.value); }
      if (e.key === 'Escape') { clearSearch(); }
    });

    input.addEventListener('focus', () => {
      if (input.value.length > 1) suggest(input.value);
    });

    document.addEventListener('click', e => {
      if (!document.getElementById('sk-wrap').contains(e.target)) hideDropdown();
    });

    clearBtn.addEventListener('click', clearSearch);
    searchBtn.addEventListener('click', () => search(document.getElementById('sk-input').value));
  }

  // ========== API CALLS ==========
  async function suggest(query) {
    if (!CONFIG.apiKey || !CONFIG.backendUrl) return;
    try {
      const res = await fetch(`${CONFIG.backendUrl}/api/suggest?q=${encodeURIComponent(query)}`, {
        headers: { 'x-seekr-key': CONFIG.apiKey }
      });
      const data = await res.json();
      if (data.suggestions?.length) renderSuggestions(data.suggestions, query);
    } catch { /* Silently fail */ }
  }

  async function search(query) {
    if (!query || query.length < 1) return;
    hideDropdown();
    showSpinner();
    hideResults();
    hideIntentBar();

    if (!CONFIG.apiKey || !CONFIG.backendUrl) {
      hideSpinner();
      document.getElementById('sk-res-list').innerHTML = '<div class="sk-no-results">Widget non configuré — clé API manquante.</div>';
      document.getElementById('sk-results').classList.add('sk-vis');
      return;
    }

    try {
      const res = await fetch(`${CONFIG.backendUrl}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-seekr-key': CONFIG.apiKey },
        body: JSON.stringify({ query, session_id: sessionId, limit: CONFIG.maxResults })
      });
      const data = await res.json();
      lastSearchId = data.search_id;
      hideSpinner();
      showIntentBar(data.intent, data.intent_score);
      renderResults(data);
    } catch(e) {
      hideSpinner();
      document.getElementById('sk-res-list').innerHTML = '<div class="sk-no-results">Erreur de connexion au serveur SEEKR.</div>';
      document.getElementById('sk-results').classList.add('sk-vis');
    }
  }

  async function trackEvent(type, productId, value) {
    if (!CONFIG.apiKey || !CONFIG.backendUrl) return;
    fetch(`${CONFIG.backendUrl}/api/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-seekr-key': CONFIG.apiKey },
      body: JSON.stringify({ session_id: sessionId, search_id: lastSearchId, type, product_id: productId, value })
    }).catch(() => {});
  }

  // ========== RENDER ==========
  function renderSuggestions(suggestions, query) {
    const hl = (t) => t.replace(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi'), '<em>$1</em>');
    document.getElementById('sk-dropdown-inner').innerHTML = `
      <div class="sk-label">Suggestions</div>
      ${suggestions.map(s => `
        <div class="sk-sugg" onclick="document.getElementById('sk-input').value='${s.replace(/'/g,"\\'")}';window._sk_search('${s.replace(/'/g,"\\'")}')">
          <div class="sk-sugg-icon"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${CONFIG.color}" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></div>
          <span class="sk-sugg-text">${hl(s)}</span>
        </div>
      `).join('')}
    `;
    document.getElementById('sk-dropdown').classList.add('sk-vis');
    isOpen = true;
  }

  function renderResults(data) {
    document.getElementById('sk-res-count').innerHTML = `<strong>${data.results?.length || 0} résultats</strong> pour "${data.query}"`;
    document.getElementById('sk-res-ms').textContent = `${data.ms}ms · IA SEEKR`;

    const list = document.getElementById('sk-res-list');
    if (!data.results?.length) {
      list.innerHTML = '<div class="sk-no-results">Aucun résultat trouvé. Essayez une autre formulation.</div>';
    } else {
      list.innerHTML = data.results.map(p => `
        <a class="sk-card" href="${p.product_url || '#'}" onclick="window._sk_track('click','${p.id}')" ${p.product_url ? 'target="_blank"' : ''}>
          <div class="sk-card-img">${p.image_url ? `<img src="${p.image_url}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">` : '📦'}</div>
          <div class="sk-card-body">
            <div class="sk-card-name">${p.name}</div>
            ${p.description ? `<div class="sk-card-desc">${p.description.slice(0,80)}…</div>` : ''}
            <div class="sk-card-meta">
              ${p.price ? `<span class="sk-price">${p.price}€</span>` : ''}
              <span class="sk-score">${p.score}% match</span>
              ${p.category ? `<span style="font-size:11px;color:${textSub};">${p.category}</span>` : ''}
            </div>
          </div>
        </a>
      `).join('');
    }
    document.getElementById('sk-results').classList.add('sk-vis');
  }

  function showIntentBar(intent, score) {
    const INTENT = {
      buy: { label: '🛒 Intention achat', color: '#059669', bg: '#05966918' },
      browse: { label: '👁 Navigation', color: '#3B82F6', bg: '#3B82F618' },
      compare: { label: '⚖️ Comparaison', color: '#D97706', bg: '#D9770618' },
      info: { label: 'ℹ️ Information', color: '#EF4444', bg: '#EF444418' }
    };
    const i = INTENT[intent] || INTENT.browse;
    const tag = document.getElementById('sk-intent-tag');
    tag.textContent = i.label;
    tag.style.background = i.bg;
    tag.style.color = i.color;
    document.getElementById('sk-intent-desc').textContent = `Score: ${Math.round((score||0)*100)}%`;
    document.getElementById('sk-intent-bar').classList.add('sk-vis');
  }

  // ========== HELPERS ==========
  function clearSearch() {
    document.getElementById('sk-input').value = '';
    document.getElementById('sk-clear').classList.remove('sk-vis');
    hideDropdown(); hideResults(); hideIntentBar();
    document.getElementById('sk-input').focus();
  }
  function hideDropdown() { document.getElementById('sk-dropdown').classList.remove('sk-vis'); isOpen = false; }
  function hideResults() { document.getElementById('sk-results').classList.remove('sk-vis'); }
  function hideIntentBar() { document.getElementById('sk-intent-bar').classList.remove('sk-vis'); }
  function showSpinner() { document.getElementById('sk-spinner-wrap').classList.add('sk-vis'); }
  function hideSpinner() { document.getElementById('sk-spinner-wrap').classList.remove('sk-vis'); }

  // Exposer pour onclick inline
  window._sk_search = (q) => search(q);
  window._sk_track = (type, id) => trackEvent(type, id);
  window.SEEKR = { init: (cfg) => { Object.assign(CONFIG, cfg); init(); }, track: trackEvent };

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})(window, document);
