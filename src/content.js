// Content script: injects a small floating rating widget and listens for reminders
(function () {
  const ID = 'pwm-overlay-root';
  if (document.getElementById(ID)) return;

  // map ratings -> svg files provided in the extension's svg/ folder
  const iconMap = {
    '1': chrome.runtime.getURL('svg/angry.svg'),
    '2': chrome.runtime.getURL('svg/sad.svg'),
    '3': chrome.runtime.getURL('svg/ok.svg'),
    '4': chrome.runtime.getURL('svg/happy.svg'),
    '5': chrome.runtime.getURL('svg/very_happy.svg')
  };

  const style = document.createElement('style');
  style.textContent = `
  .pwm-overlay { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; font-family: Arial, sans-serif; }
  .pwm-floating-button { background:#2b6cb0; color:#fff; border-radius:24px; padding:8px 12px; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,.2); }
  .pwm-panel { display:none; width:260px; background:#fff; color:#111; border-radius:8px; box-shadow:0 6px 24px rgba(0,0,0,.2); padding:12px; margin-top:8px; }
  .pwm-row { display:flex; justify-content:space-between; align-items:center; }
  .pwm-emoji { width:44px; height:44px; border-radius:10px; display:flex; align-items:center; justify-content:center; cursor:pointer; border:1px solid rgba(0,0,0,.06); padding:6px; background:#fff }
  .pwm-emoji img{ width:28px; height:28px; display:block }
  .pwm-emoji:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.12); }
  .pwm-saved { color:green; font-size:12px; margin-top:6px; display:none; }
  .pwm-emoji.disabled{filter:grayscale(1);opacity:0.5;pointer-events:none}
  .pwm-blocked-overlay{background:rgba(0,0,0,0.72);color:#fff;padding:8px;border-radius:6px;margin-top:8px;font-size:13px}
  .pwm-blocked-overlay a{color:#ffd;cursor:pointer;text-decoration:underline}
  .pwm-hide-btn{position:absolute;right:6px;top:-6px;width:22px;height:22px;border-radius:50%;border:0;background:#f0f0f0;color:#444;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:12px}
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = ID;
  root.className = 'pwm-overlay';

  root.innerHTML = `
    <div style="position:relative;display:inline-block">
      <div class="pwm-floating-button" id="pwmToggle">How do you feel?</div>
      <button id="pwmHideBtn" class="pwm-hide-btn" title="Hide for this tab session">✕</button>
    </div>
    <div class="pwm-panel" id="pwmPanel">
      <div style="font-weight:600;margin-bottom:8px;color:#111">How does this site make you feel?</div>
      <div class="pwm-row" id="pwmEmojis">
        <div class="pwm-emoji" data-rating="1" title="Angry"><img src="${iconMap['1']}" alt="angry"/></div>
        <div class="pwm-emoji" data-rating="2" title="Sad"><img src="${iconMap['2']}" alt="sad"/></div>
        <div class="pwm-emoji" data-rating="3" title="Neutral"><img src="${iconMap['3']}" alt="neutral"/></div>
        <div class="pwm-emoji" data-rating="4" title="Content"><img src="${iconMap['4']}" alt="content"/></div>
        <div class="pwm-emoji" data-rating="5" title="Happy"><img src="${iconMap['5']}" alt="happy"/></div>
      </div>
      <div class="pwm-saved" id="pwmSaved">Saved</div>
      <div id="pwmBlockedNotice" class="pwm-blocked-overlay" style="display:none">This site is hidden from ratings. <a id="openSettingsFromBlocked">Unblock in Settings</a></div>
    </div>
  `;
  document.body.appendChild(root);

  const toggle = document.getElementById('pwmToggle');
  const panel = document.getElementById('pwmPanel');
  const saved = document.getElementById('pwmSaved');
  const blockedNotice = document.getElementById('pwmBlockedNotice');

  toggle.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
  });

  // per-tab hide button (session-only)
  const hideBtn = document.getElementById('pwmHideBtn');
  if (hideBtn) hideBtn.addEventListener('click', (ev) => { ev.stopPropagation(); try { sessionStorage.setItem('pwm_hidden', '1'); } catch (e) {} root.style.display = 'none'; });

  document.getElementById('pwmEmojis').addEventListener('click', (e) => {
    const el = e.target.closest('.pwm-emoji');
    if (!el) return;
    if (el.classList.contains('disabled')) return;
    const rating = el.getAttribute('data-rating');
    const domain = location.hostname;
    chrome.runtime.sendMessage({ type: 'saveRating', rating: rating, domain: domain, url: location.href, title: document.title }, (res) => {
      saved.style.display = 'block';
      setTimeout(() => saved.style.display = 'none', 1400);
    });
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'showReminder') {
      panel.style.display = 'block';
      toggle.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    if (msg && msg.type === 'blockedSitesUpdated') {
      applyBlockedState(msg.blockedSites || []);
    }
    if (msg && msg.type === 'settingsUpdated') {
      const s = msg.settings || {};
      const showFloating = (s.showFloating !== false);
      const sessionHidden = (() => { try { return sessionStorage.getItem('pwm_hidden') === '1'; } catch (e) { return false; } })();
      if (!showFloating || sessionHidden) root.style.display = 'none'; else root.style.display = '';
      applyBlockedState(s.blockedSites || []);
    }
  });

  // blocked site handling: disable emoji buttons and show notice
  function applyBlockedState(blockedSites) {
    try {
      let host = (location.hostname || '').toLowerCase();
      // treat leading www. as equivalent to apex domain
      const normHost = host.replace(/^www\./, '');
      const blocked = (blockedSites || []).map(s => (s||'').toLowerCase().replace(/^www\./, ''));
      // Block only when normalized hostname exactly matches an entry. Subdomains (other than www) remain separate.
      const isBlocked = blocked.some(b => b && normHost === b);
      const emojis = document.querySelectorAll('.pwm-emoji');
      emojis.forEach(e => { if (isBlocked) e.classList.add('disabled'); else e.classList.remove('disabled'); });
      if (isBlocked) { blockedNotice.style.display = 'block'; } else { blockedNotice.style.display = 'none'; }
    } catch (e) { console.warn('pwm blocked apply error', e); }
  }

  // initial load
  chrome.storage.local.get({ settings: {} }, (res) => {
    const s = res.settings || {};
    const blocked = (s.blockedSites || []);
    // respect global show/hide floating button setting and per-tab session hide
    const showFloating = (s.showFloating !== false);
    const sessionHidden = (() => { try { return sessionStorage.getItem('pwm_hidden') === '1'; } catch (e) { return false; } })();
    if (!showFloating || sessionHidden) root.style.display = 'none';
    applyBlockedState(blocked);
  });

  // listen for setting changes
  chrome.storage.onChanged.addListener((changes, area) => { if (changes.settings) { const s = changes.settings.newValue || {}; if (s.showFloating === false) root.style.display = 'none'; else if (!sessionStorage.getItem || sessionStorage.getItem('pwm_hidden') !== '1') root.style.display = ''; applyBlockedState(s.blockedSites || []); } });

  // unblock link
  const openSettingsFromBlocked = document.getElementById('openSettingsFromBlocked');
  if (openSettingsFromBlocked) openSettingsFromBlocked.addEventListener('click', () => { try { chrome.runtime.openOptionsPage(); } catch (e) { console.warn(e); } });
})();
