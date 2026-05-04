// background service worker: sets periodic reminders and stores ratings
const DEFAULT_SETTINGS = { reminderInterval: 60, showOnNewTab: false, showFloating: true, searchEngine: { id: 'google', url: 'https://www.google.com/search?q=%s' } };

function ensureSettings() {
  chrome.storage.local.get(['settings'], (res) => {
    if (!res.settings) {
      chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
      createAlarm(DEFAULT_SETTINGS.reminderInterval);
    } else {
      createAlarm(res.settings.reminderInterval || DEFAULT_SETTINGS.reminderInterval);
    }
  });
}

function createAlarm(minutes) {
  if (!minutes || isNaN(minutes) || minutes <= 0) return;
  chrome.alarms.create('pwm_reminder', { periodInMinutes: minutes });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureSettings();
});

chrome.runtime.onStartup.addListener(() => {
  ensureSettings();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'pwm_reminder') return;
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const t = tabs && tabs[0];
    if (!t || !t.url || !(t.url.startsWith('http:') || t.url.startsWith('https:'))) return;
    chrome.tabs.sendMessage(t.id, { type: 'showReminder' });
  });
});

function extractDomain(url) {
  try { return new URL(url).hostname; } catch (e) { return 'unknown'; }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;
  if (message.type === 'saveRating') {
    const url = message.url || (sender.tab && sender.tab.url) || '';
    const domain = message.domain || extractDomain(url);
    const entry = {
      ts: Date.now(),
      rating: Number(message.rating) || 0,
      url: url,
      title: message.title || (sender.tab && sender.tab.title) || ''
    };
    chrome.storage.local.get({ ratings: {} }, (res) => {
      const ratings = res.ratings || {};
      if (!ratings[domain]) ratings[domain] = [];
      ratings[domain].push(entry);
      chrome.storage.local.set({ ratings }, () => {
          sendResponse({ success: true });
      });
    });
    return true;
  }

  if (message.type === 'getAggregates') {
    chrome.storage.local.get({ ratings: {} }, (res) => {
      const ratings = res.ratings || {};
      const aggregates = {};
      for (const domain in ratings) {
        const arr = ratings[domain];
        const sum = arr.reduce((s, e) => s + (e.rating || 0), 0);
        const avg = arr.length ? (sum / arr.length) : 0;
        aggregates[domain] = { avg, count: arr.length, entries: arr };
      }
      sendResponse({ aggregates });
    });
    return true;
  }

  if (message.type === 'settingsUpdated') {
    const settings = message.settings || {};
    try {
      chrome.tabs.query({}, (tabs) => {
        for (const t of (tabs || [])) {
          if (!t || !t.id) continue;
          chrome.tabs.sendMessage(t.id, { type: 'settingsUpdated', settings }, () => {});
        }
      });
    } catch (e) { console.warn('failed to broadcast settings update', e); }
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (changes.settings) {
    const newInterval = (changes.settings.newValue && changes.settings.newValue.reminderInterval) || DEFAULT_SETTINGS.reminderInterval;
    chrome.alarms.clear('pwm_reminder', () => createAlarm(newInterval));
  }
});
