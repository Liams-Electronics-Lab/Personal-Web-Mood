# Personal-Web-Mood
This extension lets you quickly rate how websites make you feel (emoji scale). Ratings are timestamped and stored in `chrome.storage.local`. The extension shows a simple map/visualization on the new-tab page and a popup for quick rating

##  Features

*   **Quick Mood Rating**: Use the browser popup to rate your current site from 1 (Angry) to 5 (Very Happy) with a single click[cite: 9, 10].
*   **Dynamic Mood Map**: A beautiful, interactive visualization that maps your digital footprint using "orbs"[cite: 5, 12]. 
    *   The **size** of an orb represents your visit frequency[cite: 5, 12].
    *   The **color** (ranging from red to bright green) reflects your average mood on that domain[cite: 5, 12].
*   **New Tab Integration**: An optional "New Tab" override that displays your personal mood map and a functional search bar every time you open a new tab[cite: 4, 12, 13].
*   **Glassmorphism UI**: A modern, sleek interface featuring blur effects and smooth animations[cite: 13].
*   **Privacy & Control**: 
    *   **Local Storage**: All ratings and timestamps are stored locally in your browser—no external tracking[cite: 11].
    *   **Domain Management**: Easily hide specific sites from your ratings or delete past entries[cite: 5, 7].
    *   **Backup & Restore**: Export your data as a JSON file or import existing backups to keep your history safe[cite: 6, 7].

---
## Install locally:

1. Open Chrome and go to `chrome://extensions/`.
2. Enable "Developer mode".
3. Click "Load unpacked" and select this folder (the repository root).

Notes:
- The extension declares a new-tab override to show the map. The options page contains a toggle but due to Chrome constraints the override must be present in the manifest; the toggle controls whether the map page shows data or a prompt.
- Use the popup (extension icon) to rate the current site, change settings, or open the full map.
---

## Configuration

The extension offers a robust **Settings** page where you can:
*   Adjust **reminder intervals** for ratings[cite: 6, 7].
*   Toggle the **floating rating button** on web pages[cite: 6, 7].
*   Select your preferred **search engine** (Google, Bing, DuckDuckGo, or a custom URL)[cite: 6, 7].
*   Manage your **Blocked Sites** list to prevent certain domains from affecting your map[cite: 6, 7].

### New tab page with search (you can choose the search engibe in settings, or use a custom one)
  <img width="2550" height="1300" alt="new tab page" src="https://github.com/user-attachments/assets/71c1aef1-bc52-44b8-9ee7-6d9ea5ef0d4b" />




### Dismissable popup (appears in lower right of webpages after set time)
<img width="395" height="245" alt="webpage popup" src="https://github.com/user-attachments/assets/5820f8e8-93a8-4744-989c-fe4c766be6fb" />
