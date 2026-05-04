document.addEventListener('DOMContentLoaded', () => {
  const interval = document.getElementById('interval');
  const newtab = document.getElementById('newtab');
  const msg = document.getElementById('msg');
  const exportBtn = document.getElementById('exportBtn');
  const importFile = document.getElementById('importFile');
  const importBtn = document.getElementById('importBtn');

  const searchEngineSelect = document.getElementById('searchEngineSelect');
  const searchCustomUrl = document.getElementById('searchCustomUrl');
  const searchCustomWrap = document.getElementById('searchCustomWrap');
  const showFloating = document.getElementById('showFloating');
  const blockedListEl = document.getElementById('blockedList');
  const blockInput = document.getElementById('blockInput');
  const addBlockBtn = document.getElementById('addBlockBtn');

  let blockedSites = [];

  const DEFAULT_SETTINGS = { reminderInterval: 60, showOnNewTab: false, showFloating: true, searchEngine: { id: 'google', url: 'https://www.google.com/search?q=%s' } };

  function showMsg(text, isError) {
    msg.style.color = isError ? 'darkred' : 'green';
    msg.textContent = text;
    if (!isError) setTimeout(() => msg.textContent = '', 3000);
  }

  function toggleSearchCustom() {
    const isCustom = searchEngineSelect.value === 'custom';
    searchCustomWrap.style.display = isCustom ? 'block' : 'none';
  }

  function normalizeDomain(s) {
    if (!s) return '';
    try { const u = new URL(s.indexOf('://') === -1 ? 'https://' + s : s); return u.hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return s.toLowerCase().replace(/^www\./, ''); }
  }

  function renderBlockedList() {
    if (!blockedListEl) return;
    blockedListEl.innerHTML = '';
    blockedSites.forEach((d, i) => {
      const div = document.createElement('div');
      div.style.display = 'flex'; div.style.justifyContent = 'space-between'; div.style.alignItems = 'center'; div.style.padding = '6px 0';
      div.innerHTML = `<span style="font-family:monospace">${d}</span><span><button class="edit-block" data-i="${i}">Edit</button> <button class="remove-block" data-i="${i}">Remove</button></span>`;
      blockedListEl.appendChild(div);
    });
    blockedListEl.querySelectorAll('.remove-block').forEach(btn => btn.addEventListener('click', (e) => {
      const i = Number(btn.getAttribute('data-i'));
      blockedSites.splice(i,1); renderBlockedList();
    }));
    blockedListEl.querySelectorAll('.edit-block').forEach(btn => btn.addEventListener('click', (e) => {
      const i = Number(btn.getAttribute('data-i'));
      const cur = blockedSites[i];
      const nv = prompt('Edit blocked site', cur);
      if (nv) { blockedSites[i] = normalizeDomain(nv); renderBlockedList(); }
    }));
  }

  if (addBlockBtn) addBlockBtn.addEventListener('click', () => {
    const val = (blockInput.value || '').trim();
    if (!val) return; const d = normalizeDomain(val);
    if (!blockedSites.includes(d)) blockedSites.push(d);
    blockInput.value = ''; renderBlockedList();
  });

  // load
  chrome.storage.local.get({ settings: DEFAULT_SETTINGS }, (res) => {
    const s = res.settings || DEFAULT_SETTINGS;
    interval.value = s.reminderInterval;
    newtab.checked = !!s.showOnNewTab;
    showFloating.checked = (s.showFloating !== false);
    blockedSites = (s.blockedSites || []).slice();
    renderBlockedList();
    const se = s.searchEngine || DEFAULT_SETTINGS.searchEngine;
    searchEngineSelect.value = se.id || 'google';
    searchCustomUrl.value = se.url || '';
    toggleSearchCustom();
  });
  searchEngineSelect.addEventListener('change', toggleSearchCustom);

  document.getElementById('save').addEventListener('click', (e) => {
    e.preventDefault();
    const s = {
      reminderInterval: Number(interval.value) || 60,
      showOnNewTab: !!newtab.checked,
      showFloating: !!showFloating.checked,
      searchEngine: { id: 'google', url: 'https://www.google.com/search?q=%s' },
      blockedSites: blockedSites.slice()
    };
    const se = searchEngineSelect.value;
    if (se === 'custom') s.searchEngine = { id: 'custom', url: (searchCustomUrl.value || '').trim() };
    else if (se === 'bing') s.searchEngine = { id: 'bing', url: 'https://www.bing.com/search?q=%s' };
    else if (se === 'duckduckgo') s.searchEngine = { id: 'duckduckgo', url: 'https://duckduckgo.com/?q=%s' };

    chrome.storage.local.set({ settings: s }, () => {
      showMsg('Saved');
      try { chrome.runtime.sendMessage({ type: 'settingsUpdated', settings: s }); } catch (e) {}
    });
  });

  // export ratings
  exportBtn.addEventListener('click', () => {
    chrome.storage.local.get(['ratings', 'settings'], (res) => {
      const payload = { ratings: res.ratings || {}, settings: res.settings || {} };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pwm-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showMsg('Export started');
    });
  });

  // import ratings
  importBtn.addEventListener('click', () => {
    const f = importFile.files[0];
    if (!f) { alert('Select a JSON file to import'); return; }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data || typeof data !== 'object') throw new Error('Invalid file');
        const replace = confirm('Replace existing ratings with imported data? Click Cancel to Merge (append).');
        chrome.storage.local.get({ ratings: {} }, (res) => {
          let newRatings = data.ratings || {};
          if (!replace) {
            const current = res.ratings || {};
            for (const d in newRatings) {
              if (!current[d]) current[d] = [];
              current[d] = current[d].concat(newRatings[d]);
            }
            newRatings = current;
          }
          chrome.storage.local.set({ ratings: newRatings }, () => {
            if (data.settings && confirm('Import settings (blocked sites, search engine, reminders)? Click OK to replace current settings.')) {
              chrome.storage.local.set({ settings: data.settings }, () => {
                try { chrome.runtime.sendMessage({ type: 'settingsUpdated', settings: data.settings }); } catch (e) {}
                showMsg('Import complete');
              });
            } else {
              showMsg('Import complete');
            }
          });
        });
      } catch (err) { alert('Error parsing file: ' + err.message); }
    };
    reader.readAsText(f);
  });

  // test connection
  // (external sync features removed)

});
