document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('mapCanvas');
  const ctx = canvas.getContext('2d');
  const listEl = document.getElementById('domainList');
  const detailsEl = document.getElementById('details');
  const toggleBtn = document.getElementById('toggleNewtabBtn');
  const canvasWrap = document.getElementById('canvasWrap');

  // Settings button (avoid inline onclick due to CSP)
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  if (openSettingsBtn) openSettingsBtn.addEventListener('click', () => { try { chrome.runtime.openOptionsPage(); } catch (e) { console.warn('openOptionsPage failed', e); } });

  let orbs = [];
  let animId = null;
  let canvasClickAttached = false;
  const DEFAULT_SETTINGS = { reminderInterval: 60, showOnNewTab: false, showFloating: true, searchEngine: { id: 'google', url: 'https://www.google.com/search?q=%s' }, blockedSites: [] };

  // tooltip element
  const tooltipEl = document.createElement('div');
  tooltipEl.className = 'pwm-tooltip';
  tooltipEl.style.display = 'none';
  canvasWrap.appendChild(tooltipEl);
  let hoveredOrb = null;

  // search form wiring (new-tab search bar)
  const searchForm = document.getElementById('newtabSearchForm');
  const searchInput = document.getElementById('searchQuery');
  if (searchForm && searchInput) {
    searchForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const q = (searchInput.value || '').trim();
      if (!q) return;
      chrome.storage.local.get({ settings: DEFAULT_SETTINGS }, (res) => {
        const s = res.settings || DEFAULT_SETTINGS;
        const seUrl = (s.searchEngine && s.searchEngine.url) ? s.searchEngine.url : 'https://www.google.com/search?q=%s';
        let url = seUrl;
        if (url.indexOf('%s') >= 0) url = url.replace(/%s/g, encodeURIComponent(q));
        else url = url + (url.includes('?') ? '&' : '?') + 'q=' + encodeURIComponent(q);
        window.location.href = url;
      });
    });
    // autofocus the search input so user can start typing immediately
    setTimeout(() => { try { searchInput.focus(); searchInput.select(); } catch (e){} }, 60);
  }

  function setCanvasSize() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || canvas.offsetWidth;
    const cssH = canvas.clientHeight || canvas.offsetHeight;
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function resize() { setCanvasSize(); drawPlaceholder(); }
  window.addEventListener('resize', resize);
  resize();

  // deterministic hash for stable placement
  function hashNormalized(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    return (h % 1000) / 1000;
  }

  // color stops: red->orange->yellow->green->bright green
  const stops = ['#e53935','#ff8a00','#ffeb3b','#4caf50','#00c853'];
  function hexToRgb(hex) { const s = hex.replace('#',''); return { r: parseInt(s.substring(0,2),16), g: parseInt(s.substring(2,4),16), b: parseInt(s.substring(4,6),16) }; }
  function ratingToRgb(avg) {
    const t = Math.max(0, Math.min(1, (avg - 1) / 4));
    const scaled = t * (stops.length - 1);
    const idx = Math.floor(scaled);
    const localT = scaled - idx;
    const c1 = hexToRgb(stops[idx]);
    const c2 = hexToRgb(stops[Math.min(idx + 1, stops.length - 1)]);
    return { r: Math.round(c1.r + (c2.r - c1.r) * localT), g: Math.round(c1.g + (c2.g - c1.g) * localT), b: Math.round(c1.b + (c2.b - c1.b) * localT) };
  }

  // rounded rect helper
  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  // build orb objects from data
  function buildOrbs(data) {
    orbs = [];
    const domains = Object.keys(data);
    const pad = 50;
    const avgMin = 1, avgMax = 5;
    const cssW = canvas.clientWidth || canvas.offsetWidth;
    const cssH = canvas.clientHeight || canvas.offsetHeight;
    const counts = domains.map(d => data[d].count);
    const countMax = Math.max(1, ...counts);

    for (const domain of domains) {
      const it = data[domain];
      const avg = it.avg || 3;
      const count = it.count || 1;
      const hash = hashNormalized(domain);
      const x = pad + ((avg - avgMin) / (avgMax - avgMin)) * (cssW - pad * 2);
      const baseY = pad + hash * (cssH - pad * 2);
      const r = 8 + Math.log(count + 1) * 6;
      const rgb = ratingToRgb(avg);
      const phase = hash * Math.PI * 2;
      const speed = 0.6 + (hash * 0.8);
      const amplitude = 6 + (r * 0.6);
      const xOsc = 4 + (hash * 10);
      orbs.push({ domain, avg, count, entries: it.entries || [], x, baseY, r, rgb, phase, speed, amplitude, xOsc, currentX: x, currentY: baseY });
    }
  }

  function startAnimation() {
    stopAnimation();
    function frame(now) {
      const t = now / 1000;
      setCanvasSize();
      const cssW = canvas.clientWidth || canvas.offsetWidth;
      const cssH = canvas.clientHeight || canvas.offsetHeight;
      ctx.clearRect(0, 0, cssW, cssH);

      // sort by y for depth
      const sorted = orbs.slice().sort((a, b) => (a.baseY - b.baseY));
      // draw glows with additive blending for nice color mixing
      ctx.globalCompositeOperation = 'lighter';
      for (const ob of sorted) {
        const x = ob.x + Math.cos(t * ob.speed + ob.phase / 2) * (ob.xOsc * 0.3);
        const y = ob.baseY + Math.sin(t * ob.speed + ob.phase) * ob.amplitude;
        ob.currentX = x; ob.currentY = y;
        const heatR = Math.max(ob.r * 6, 30);
        const grad = ctx.createRadialGradient(x, y, 0, x, y, heatR);
        grad.addColorStop(0, `rgba(${ob.rgb.r},${ob.rgb.g},${ob.rgb.b},0.9)`);
        grad.addColorStop(0.35, `rgba(${ob.rgb.r},${ob.rgb.g},${ob.rgb.b},0.35)`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(x, y, heatR, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // draw cores (sorted so smaller/farther ones draw first)
      for (const ob of sorted) {
        const x = ob.currentX, y = ob.currentY, r = ob.r;
        // sphere shading
        const coreGrad = ctx.createRadialGradient(x - r * 0.36, y - r * 0.5, 0, x, y, r);
        coreGrad.addColorStop(0, `rgba(255,255,255,0.9)`);
        coreGrad.addColorStop(0.12, `rgba(${ob.rgb.r},${ob.rgb.g},${ob.rgb.b},1)`);
        coreGrad.addColorStop(1, `rgba(${Math.max(0, ob.rgb.r - 30)},${Math.max(0, ob.rgb.g - 30)},${Math.max(0, ob.rgb.b - 30)},1)`);
        ctx.fillStyle = coreGrad;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

        // specular highlight
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.arc(x - r * 0.36, y - r * 0.5, Math.max(1, r * 0.28), 0, Math.PI * 2); ctx.fill();

        // subtle outline
        ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      }

      // draw labels below orbs
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.font = '12px Arial';
      for (const ob of sorted) {
        const x = ob.currentX, y = ob.currentY, r = ob.r;
        const label1 = ob.domain.length > 26 ? ob.domain.slice(0,23) + '...' : ob.domain;
        const label2 = `avg ${Number(ob.avg).toFixed(2)}`;
        const w1 = ctx.measureText(label1).width;
        const w2 = ctx.measureText(label2).width;
        const boxW = Math.max(w1, w2) + 16;
        const boxH = 18 + 6;
        const boxX = x - boxW / 2;
        const boxY = y + r + 8;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        roundRect(ctx, boxX, boxY, boxW, boxH, 6);
        ctx.fill();
        ctx.fillStyle = '#111';
        ctx.fillText(label1, x, boxY + 4);
        ctx.fillText(label2, x, boxY + 4 + 14);
      }

      // update tooltip position if hovering (anchor to orb, keep onscreen)
      if (hoveredOrb && tooltipEl.style.display !== 'none') {
        placeTooltip(hoveredOrb);
      }

      animId = requestAnimationFrame(frame);
    }
    animId = requestAnimationFrame(frame);
  }

  function stopAnimation() { if (animId) cancelAnimationFrame(animId); animId = null; }

  function drawPlaceholder() { ctx.clearRect(0,0,canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height); ctx.fillStyle = '#111'; ctx.font = '14px Arial'; ctx.fillText('Preparing map...', 20, 30); }

  function attachClick() {
    if (canvasClickAttached) return;
    canvas.addEventListener('click', (ev) => {
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      for (const ob of orbs) {
        const dx = mx - ob.currentX, dy = my - ob.currentY;
        if (Math.sqrt(dx*dx + dy*dy) <= ob.r + 6) { showDetails(ob.domain, { avg: ob.avg, count: ob.count, entries: ob.entries }); break; }
      }
    });

    // hover handling for tooltip
    canvas.addEventListener('mousemove', (ev) => {
      const rect = canvas.getBoundingClientRect();
      const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
      if (!orbs || !orbs.length) { hideTooltip(); return; }
      let nearest = null; let nearestDist = Infinity;
      for (const ob of orbs) {
        const dx = mx - ob.currentX, dy = my - ob.currentY;
        const d = Math.sqrt(dx*dx + dy*dy);
        if (d < nearestDist) { nearest = ob; nearestDist = d; }
      }
      if (nearest && nearestDist <= nearest.r + 10) {
        if (hoveredOrb !== nearest) { hoveredOrb = nearest; tooltipEl.style.display = 'block'; updateTooltipContent(nearest); setTimeout(() => tooltipEl.classList.add('show'), 10); }
      } else {
        if (hoveredOrb) { hoveredOrb = null; hideTooltip(); }
      }
    });

    canvas.addEventListener('mouseleave', () => { hoveredOrb = null; hideTooltip(); });

    canvasClickAttached = true;
  }

  function updateTooltipContent(ob) {
    const entries = (ob.entries || []).slice().sort((a,b) => b.ts - a.ts).slice(0,5);
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

    // build tooltip: left = rating+title, right = relative time (+ NEW badge)
    let html = `<div style="font-weight:700;margin-bottom:6px"><div class="marquee-small"><div class="marquee-inner-small">${escapeHtml(ob.domain)}</div></div></div><ul>`;
    if (!entries.length) html += `<li style="padding:6px 0;color:#666">No ratings yet</li>`;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const isLatest = i === 0;
      const title = escapeHtml(e.title || '');
      const time = relativeTime(e.ts);
      html += `<li><div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0"><div style="width:36px;text-align:center"><strong>${e.rating}</strong></div><div style="flex:1;min-width:0"><div class="marquee-small"><div class="marquee-inner-small">${title}</div></div></div></div><div style="display:flex;flex-direction:column;align-items:flex-end;margin-left:12px"><div class="ts">${time}</div>${isLatest?'<div class="new-badge" style="margin-left:0;margin-top:4px">NEW!</div>':''}</div></li>`;
    }
    html += '</ul>';
    tooltipEl.innerHTML = html;

    // After the tooltip is rendered/displayed, enable marquee only where needed.
    // Use setTimeout 0 so this runs after the caller typically sets display:block.
    setTimeout(() => {
      const marquees = tooltipEl.querySelectorAll('.marquee-small');
      marquees.forEach(m => {
        const inner = m.querySelector('.marquee-inner-small');
        if (!inner) return;
        // if inner content wider than container, enable marquee animation
        if (inner.scrollWidth > m.clientWidth) m.classList.add('marquee-needed'); else m.classList.remove('marquee-needed');
      });
      // compute placement now that sizes are available
      placeTooltip(ob);
    }, 0);
  }
  
  function placeTooltip(ob) {
    if (!ob) return;
    const wrapRect = canvasWrap.getBoundingClientRect();
    const cw = wrapRect.width;
    const ch = wrapRect.height;
    // adapt margin to zoom (devicePixelRatio) so tooltip stays well inside when zoomed
    const dpr = window.devicePixelRatio || 1;
    const margin = Math.max(8, Math.round(12 * dpr));
    // ensure tooltip is visible for measurement
    const prevDisplay = tooltipEl.style.display;
    if (getComputedStyle(tooltipEl).display === 'none') tooltipEl.style.display = 'block';
    const tw = tooltipEl.offsetWidth;
    const th = tooltipEl.offsetHeight;
    let left, top, chosen = null, pointerLeft, pointerTop;

    // remember previous placement to detect flips
    const prevPlacement = tooltipEl.dataset.placement || null;

    // try top
    let topPos = ob.currentY - th - ob.r - 12;
    let leftPos = ob.currentX - tw / 2;
    leftPos = Math.max(margin, Math.min(cw - tw - margin, leftPos));
    if (topPos >= margin) {
      chosen = 'top'; left = leftPos; top = topPos;
      pointerLeft = ((ob.currentX - left) / tw) * 100; pointerLeft = Math.min(95, Math.max(5, pointerLeft));
    }

    // try bottom
    if (!chosen) {
      topPos = ob.currentY + ob.r + 12;
      leftPos = ob.currentX - tw / 2;
      leftPos = Math.max(margin, Math.min(cw - tw - margin, leftPos));
      if (topPos + th <= ch - margin) {
        chosen = 'bottom'; left = leftPos; top = topPos;
        pointerLeft = ((ob.currentX - left) / tw) * 100; pointerLeft = Math.min(95, Math.max(5, pointerLeft));
      }
    }

    // try right
    if (!chosen) {
      leftPos = ob.currentX + ob.r + 12;
      topPos = ob.currentY - th / 2;
      topPos = Math.max(margin, Math.min(ch - th - margin, topPos));
      if (leftPos + tw <= cw - margin) {
        chosen = 'right'; left = leftPos; top = topPos;
        pointerTop = ((ob.currentY - top) / th) * 100; pointerTop = Math.min(95, Math.max(5, pointerTop));
      }
    }

    // try left
    if (!chosen) {
      leftPos = ob.currentX - tw - ob.r - 12;
      topPos = ob.currentY - th / 2;
      topPos = Math.max(margin, Math.min(ch - th - margin, topPos));
      if (leftPos >= margin) {
        chosen = 'left'; left = leftPos; top = topPos;
        pointerTop = ((ob.currentY - top) / th) * 100; pointerTop = Math.min(95, Math.max(5, pointerTop));
      }
    }

    // fallback
    if (!chosen) {
      chosen = 'top';
      left = Math.max(margin, Math.min(cw - tw - margin, ob.currentX - tw / 2));
      top = Math.max(margin, Math.min(ch - th - margin, ob.currentY - ob.r - 12));
      pointerLeft = ((ob.currentX - left) / tw) * 100; pointerLeft = Math.min(95, Math.max(5, pointerLeft));
    }
    // apply placement, animate flip when placement changes
    tooltipEl.classList.remove('top','bottom','left','right');
    // if the placement changed, trigger a small placement-flip animation
    if (prevPlacement && prevPlacement !== chosen) {
      tooltipEl.classList.add('placement-flip');
      clearTimeout(tooltipEl._placementFlipTimeout);
      tooltipEl._placementFlipTimeout = setTimeout(() => tooltipEl.classList.remove('placement-flip'), 260);
    }
    tooltipEl.classList.add(chosen);
    tooltipEl.dataset.placement = chosen;
    if (pointerLeft !== undefined) tooltipEl.style.setProperty('--pointer-left', `${pointerLeft}%`);
    if (pointerTop !== undefined) tooltipEl.style.setProperty('--pointer-top', `${pointerTop}%`);
    tooltipEl.style.left = `${Math.round(left)}px`;
    tooltipEl.style.top = `${Math.round(top)}px`;
    // restore display if it was previously hidden
    if (getComputedStyle(tooltipEl).display === 'none') tooltipEl.style.display = prevDisplay;
  }

  function hideTooltip() {
    tooltipEl.classList.remove('show');
    tooltipEl.classList.remove('top','bottom','left','right');
    tooltipEl.style.removeProperty('--pointer-left');
    tooltipEl.style.removeProperty('--pointer-top');
    setTimeout(() => { if (!tooltipEl.classList.contains('show')) tooltipEl.style.display = 'none'; }, 140);
  }

  function loadAndRender() {
    chrome.runtime.sendMessage({ type: 'getAggregates' }, (res) => {
      const data = res.aggregates || {};
      resize();
      buildOrbs(data);
      populateList(data);
      attachClick();
      startAnimation();
    });
  }

  // Load settings and initialize
  chrome.storage.local.get({ settings: DEFAULT_SETTINGS }, (resSettings) => {
    const settings = resSettings.settings || DEFAULT_SETTINGS;
    if (toggleBtn) toggleBtn.textContent = settings.showOnNewTab ? 'Disable new-tab map' : 'Enable map on new tab';
    if (toggleBtn) toggleBtn.addEventListener('click', () => {
      const newVal = !settings.showOnNewTab;
      const newSettings = Object.assign({}, settings, { showOnNewTab: newVal });
      chrome.storage.local.set({ settings: newSettings }, () => {
        if (newVal) loadAndRender(); else { stopAnimation(); listEl.innerHTML = '<div style="padding:16px">The new-tab map is disabled. Click the button above to enable it.</div>'; detailsEl.innerHTML = ''; }
        toggleBtn.textContent = newVal ? 'Disable new-tab map' : 'Enable map on new tab';
        try { chrome.runtime.sendMessage({ type: 'settingsUpdated', settings: newSettings }); } catch (e) {}
      });
    });

    if (settings.showOnNewTab) loadAndRender(); else {
      listEl.innerHTML = '<div style="padding:16px">The new-tab map is disabled. Click the button above to enable it.</div>';
      drawPlaceholder();
    }
  });

  function populateList(data) {
    listEl.innerHTML = '';
    chrome.storage.local.get({ settings: DEFAULT_SETTINGS }, (resSettings) => {
      const blocked = (resSettings.settings && resSettings.settings.blockedSites) || [];
      const domains = Object.keys(data).sort((a,b) => data[b].count - data[a].count);
      domains.forEach(domain => {
        const it = data[domain];
        const div = document.createElement('div');
        div.className = 'list-item';
        const isBlocked = blocked.indexOf(domain) >= 0;
        div.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between"><div style="min-width:0"><strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">${escapeHtml(domain)}</strong><small style="color:#666"> ${it.count} ratings · avg ${it.avg.toFixed(2)}</small></div><div style="display:flex;align-items:center;gap:6px"><label style="font-size:12px;color:#666"><input type="checkbox" class="block-site-checkbox" ${isBlocked ? 'checked' : ''}/> Hide from ratings</label><button class="remove-btn" title="Delete domain">✕</button></div></div>`;
        div.addEventListener('click', (e) => {
          if (e.target.closest('.remove-btn') || e.target.closest('.block-site-checkbox') || e.target.closest('label')) return;
          showDetails(domain, it);
        });
        listEl.appendChild(div);

        const removeBtn = div.querySelector('.remove-btn');
        removeBtn.addEventListener('click', (ev) => { ev.stopPropagation(); showDeleteDomainModal(domain); });
        const chk = div.querySelector('.block-site-checkbox');
        chk.addEventListener('change', (ev) => { toggleBlockSite(domain, !!ev.target.checked); });
      });
    });
  }

  function showDetails(domain, it) {
    const entries = (it.entries || []).slice().reverse();
    const listHtml = entries.map(e => `<li data-ts="${e.ts}">${new Date(e.ts).toLocaleString()}: ${e.rating} — <small>${escapeHtml(e.title)}</small> <button class="del-entry" data-ts="${e.ts}">Delete</button></li>`).join('');
    detailsEl.innerHTML = `<h3>${escapeHtml(domain)}</h3><div>${it.count} ratings · avg ${it.avg.toFixed(2)}</div><ol>${listHtml}</ol>`;
    // attach delete handlers for individual ratings
    const dels = detailsEl.querySelectorAll('.del-entry');
    dels.forEach(btn => btn.addEventListener('click', (ev) => {
      const ts = Number(btn.getAttribute('data-ts'));
      if (confirm('Delete this rating?')) deleteRating(domain, ts);
    }));
  }

  function normalizeDomain(s) {
    if (!s) return '';
    try { const u = new URL(s.indexOf('://') === -1 ? 'https://' + s : s); return u.hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return s.toLowerCase().replace(/^www\./, ''); }
  }

  function toggleBlockSite(domain, shouldBlock) {
    const d = normalizeDomain(domain);
    chrome.storage.local.get({ settings: DEFAULT_SETTINGS }, (res) => {
      const settings = res.settings || DEFAULT_SETTINGS;
      const arr = (settings.blockedSites || []).slice();
      const idx = arr.indexOf(d);
      if (shouldBlock && idx === -1) arr.push(d);
      if (!shouldBlock && idx !== -1) arr.splice(idx, 1);
      settings.blockedSites = arr;
      chrome.storage.local.set({ settings }, () => { loadAndRender(); try { chrome.runtime.sendMessage({ type: 'settingsUpdated', settings: settings }); } catch (e) {} });
    });
  }

  function deleteRating(domain, ts) {
    const d = domain;
    chrome.storage.local.get({ ratings: {} }, (res) => {
      const ratings = res.ratings || {};
      if (!ratings[d]) return;
      ratings[d] = ratings[d].filter(e => e.ts !== ts);
      if (!ratings[d] || ratings[d].length === 0) delete ratings[d];
      chrome.storage.local.set({ ratings }, () => { showMsgTemp('Rating deleted'); loadAndRender(); });
    });
  }

  function deleteDomain(domain, alsoBlock) {
    const d = domain;
    chrome.storage.local.get({ ratings: {} , settings: DEFAULT_SETTINGS }, (res) => {
      const ratings = res.ratings || {};
      delete ratings[d];
      chrome.storage.local.set({ ratings }, () => {
        if (alsoBlock) {
          const settings = res.settings || DEFAULT_SETTINGS;
          const arr = (settings.blockedSites || []).slice();
          const nd = normalizeDomain(d);
          if (arr.indexOf(nd) === -1) arr.push(nd);
          settings.blockedSites = arr;
          chrome.storage.local.set({ settings }, () => { showMsgTemp('Domain deleted and blocked'); loadAndRender(); });
        } else { showMsgTemp('Domain deleted'); loadAndRender(); }
      });
    });
  }

  function showDeleteDomainModal(domain) {
    // simple modal
    const modal = document.createElement('div');
    modal.style.position = 'fixed'; modal.style.left = '0'; modal.style.top = '0'; modal.style.right = '0'; modal.style.bottom = '0'; modal.style.background = 'rgba(0,0,0,0.4)'; modal.style.display = 'flex'; modal.style.alignItems = 'center'; modal.style.justifyContent = 'center'; modal.style.zIndex = 2000;
    const box = document.createElement('div'); box.style.background = '#fff'; box.style.padding = '16px'; box.style.borderRadius = '8px'; box.style.width = '420px'; box.style.boxShadow = '0 8px 40px rgba(0,0,0,0.3)';
    box.innerHTML = `<div style="font-weight:700;margin-bottom:8px">Delete all ratings for <em>${escapeHtml(domain)}</em>?</div><div style="margin-bottom:8px"><label><input type="checkbox" id="_alsoBlock"/> Also hide this site from ratings (block)</label></div><div style="text-align:right"><button id="_cancelBtn">Cancel</button> <button id="_delBtn" style="margin-left:8px;background:#c62828;color:#fff;border:0;padding:6px 10px;border-radius:6px">Delete</button></div>`;
    modal.appendChild(box); document.body.appendChild(modal);
    box.querySelector('#_cancelBtn').addEventListener('click', () => modal.remove());
    box.querySelector('#_delBtn').addEventListener('click', () => { const alsoBlock = !!box.querySelector('#_alsoBlock').checked; modal.remove(); deleteDomain(domain, alsoBlock); });
  }

  function showMsgTemp(t) { detailsEl.innerHTML = `<div style="padding:8px;color:green">${t}</div>`; setTimeout(() => { detailsEl.innerHTML = ''; }, 1800); }

  function escapeHtml(s) { return (s||'').replace(/[&<>\"]+/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]||c)); }
});
