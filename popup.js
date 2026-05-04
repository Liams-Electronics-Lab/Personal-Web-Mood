document.addEventListener('DOMContentLoaded', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0] || {};
    const tabUrl = tab.url || '';
    let domain = 'unknown';
    try { domain = new URL(tabUrl).hostname; } catch (e) {}
    const pageTitle = tab.title || domain;

    // set marquee title
    const titleInner = document.getElementById('titleInner');
    if (titleInner) titleInner.textContent = pageTitle;

    // helper: relative time
    function relativeTime(ts) {
      const sec = Math.floor((Date.now() - ts) / 1000);
      if (sec < 10) return 'just now';
      if (sec < 60) return `${sec}s ago`;
      const min = Math.floor(sec / 60);
      if (min < 60) return `${min}m ago`;
      const hr = Math.floor(min / 60);
      if (hr < 24) return `${hr}h ago`;
      const days = Math.floor(hr / 24);
      if (days < 7) return `${days}d ago`;
      const weeks = Math.floor(days / 7);
      if (weeks < 5) return `${weeks}w ago`;
      const months = Math.floor(days / 30);
      if (months < 12) return `${months}mo ago`;
      const years = Math.floor(days / 365);
      return `${years}y ago`;
    }

    function ratingToEmoji(r) {
      return ({ '1': '😡', '2': '☹️', '3': '😐', '4': '🙂', '5': '😀' })[String(r)] || String(r);
    }

    function escapeHtml(s) { return (s||'').replace(/[&<>\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]||c)); }

    function renderRecent(domain) {
      chrome.storage.local.get({ ratings: {} }, (res) => {
        const arr = (res.ratings && res.ratings[domain]) || [];
        const recent = arr.slice().sort((a,b) => b.ts - a.ts).slice(0,5);
        const container = document.getElementById('recentList');
        container.innerHTML = '';
        if (!recent.length) { container.innerHTML = '<div class="empty">No ratings yet</div>'; return; }
        recent.forEach((e, idx) => {
          const item = document.createElement('div');
          item.className = 'recent-item';
          const emoji = document.createElement('div'); emoji.className = 'recent-emoji'; emoji.textContent = ratingToEmoji(e.rating);
          const meta = document.createElement('div'); meta.className = 'recent-meta';
          const titleSpan = document.createElement('div'); titleSpan.className = 'recent-title'; titleSpan.textContent = (e.title && e.title.length) ? e.title : '';
          const timeSpan = document.createElement('div'); timeSpan.className = 'recent-time'; timeSpan.textContent = relativeTime(e.ts);
          meta.appendChild(titleSpan);
          meta.appendChild(timeSpan);
          item.appendChild(emoji);
          item.appendChild(meta);
          if (idx === 0) {
            const badge = document.createElement('span'); badge.className = 'new-badge'; badge.textContent = 'NEW!';
            item.appendChild(badge);
          }
          container.appendChild(item);
        });
      });
    }

    // emoji buttons: check blocked status first, then wire
    const emojiButtons = Array.from(document.querySelectorAll('.emoji'));
    function normalizeHost(h) { return (h||'').toLowerCase().replace(/^www\./, ''); }
    function setBlockedState(isBlocked) {
      emojiButtons.forEach(btn => { if (isBlocked) btn.classList.add('disabled'); else btn.classList.remove('disabled'); });
      const st = document.getElementById('status');
      if (isBlocked) st.textContent = 'Site hidden from ratings — Unblock in Settings';
      else st.textContent = '';
    }

    function attachEmojiHandlers() {
      emojiButtons.forEach(btn => {
        if (btn._pwmAttached) return;
        btn.addEventListener('click', (e) => {
          const rating = e.currentTarget.dataset.rating;
          chrome.runtime.sendMessage({ type: 'saveRating', rating, domain, url: tabUrl, title: pageTitle }, (res) => {
            const st = document.getElementById('status');
            st.textContent = 'Saved ✓';
            renderRecent(domain);
            setTimeout(() => st.textContent = '', 1200);
          });
        });
        btn._pwmAttached = true;
      });
    }

    // check settings for blocked sites and apply
    chrome.storage.local.get({ settings: {} }, (res) => {
      const blocked = (res.settings && res.settings.blockedSites) || [];
      const normBlocked = blocked.map(normalizeHost);
      const isBlocked = normBlocked.includes(normalizeHost(domain));
      setBlockedState(isBlocked);
      if (!isBlocked) attachEmojiHandlers();
    });

    // respond to live settings changes while popup is open
    chrome.storage.onChanged.addListener((changes, area) => {
      if (changes.settings) {
        const s = changes.settings.newValue || {};
        const blocked = s.blockedSites || [];
        const isBlocked = blocked.map(normalizeHost).includes(normalizeHost(domain));
        setBlockedState(isBlocked);
      }
    });

    document.getElementById('openMap').addEventListener('click', () => {
      chrome.tabs.create({ url: 'start.html' });
    });

    document.getElementById('options').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // show quick stats and recent
    chrome.storage.local.get({ ratings: {} }, (res) => {
      const arr = (res.ratings && res.ratings[domain]) || [];
      if (arr.length) {
        const avg = (arr.reduce((s, e) => s + e.rating, 0) / arr.length).toFixed(2);
        document.getElementById('status').textContent = `${arr.length} ratings • avg ${avg}`;
      }
      renderRecent(domain);
    });
  });
});
