// Shared helpers for the OSRIC Character Sheet extension.

export const EXT_ID = "osric-character-sheet";
export const KEY = `${EXT_ID}/sheet`; // item metadata key that holds a sheet
export const POPOVER_ID = `${EXT_ID}/sheet-popover`;
export const MENU_ID = `${EXT_ID}/context-menu`;
export const HERO_KEY = `${EXT_ID}/hero`; // item metadata flag: this token is a player character
export const PREFS_KEY = "osric-sheet:prefs";
export const FORMAT = "osric-character-sheet";
export const FORMAT_VERSION = 1;
export const VERSION = "1.2.0"; // also used in the ?v= of every file reference, so updates are not mixed with cached files

// The Owlbear Rodeo SDK (MIT licence), loaded as an ES module from a CDN, with a fallback.
const SDK_URLS = [
  "https://cdn.jsdelivr.net/npm/@owlbear-rodeo/sdk@3.1.0/+esm",
  "https://esm.sh/@owlbear-rodeo/sdk@3.1.0",
];

/** True when this page was loaded by Owlbear Rodeo (it adds ?obrref=...). */
export function inOwlbear() {
  return new URLSearchParams(location.search).has("obrref");
}

/** Absolute URL of a file of this extension, works when hosted in a sub-folder too. */
export function extUrl(path) {
  return new URL(path, import.meta.url.replace(/js\/common\.js.*$/, "")).href;
}

let sdkPromise = null;

/**
 * Load the Owlbear SDK. Owlbear sends its "ready" message as soon as the frame loads,
 * which can be before a CDN import finishes, so each page buffers that message in a tiny
 * inline script (window.__obrMessages) and it is replayed here.
 */
export function loadOBR() {
  if (sdkPromise) return sdkPromise;
  sdkPromise = (async () => {
    if (window.__OBR_MOCK__) return window.__OBR_MOCK__;
    let lastError;
    for (const url of SDK_URLS) {
      try {
        const mod = await import(url);
        const OBR = mod.default || mod.OBR || mod;
        if (OBR && OBR.onReady) {
          replayReady(OBR);
          return OBR;
        }
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError || new Error("Could not load the Owlbear Rodeo SDK");
  })();
  return sdkPromise;
}

function replayReady(OBR) {
  if (OBR.isReady) return;
  // Take a copy and replay only the latest message. The inline buffer ignores these synthetic
  // events (they are not "trusted"), so replaying can never feed itself.
  const last = (window.__obrMessages || []).slice(-1);
  window.__obrMessages = [];
  for (const m of last) {
    try {
      window.dispatchEvent(new MessageEvent("message", { data: m.data, origin: m.origin }));
    } catch (_) {
      /* ignore */
    }
  }
}

/** Resolve when the SDK is connected to Owlbear; reject after `ms` milliseconds. */
export function whenReady(OBR, ms = 20000) {
  return new Promise((resolve, reject) => {
    if (OBR.isReady) return resolve();
    const timer = setTimeout(() => reject(new Error("Owlbear Rodeo did not answer")), ms);
    OBR.onReady(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Resolve once a scene is open (item APIs fail without one). */
export async function whenSceneReady(OBR) {
  if (await OBR.scene.isReady()) return;
  await new Promise((resolve) => {
    const off = OBR.scene.onReadyChange((ready) => {
      if (ready) {
        off();
        resolve();
      }
    });
  });
}

export const store = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      /* storage may be unavailable (private window, blocked site data) */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (_) {
      /* ignore */
    }
  },
};

/** Apply the Owlbear theme (or the OS theme outside Owlbear) to CSS variables. */
export function applyTheme(theme) {
  const root = document.documentElement;
  if (!theme) {
    const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "dark" : "light";
    return;
  }
  root.dataset.theme = theme.mode === "LIGHT" ? "light" : "dark";
  const set = (k, v) => v && root.style.setProperty(k, v);
  set("--obr-primary", theme.primary && theme.primary.main);
  set("--obr-bg", theme.background && theme.background.default);
  set("--obr-paper", theme.background && theme.background.paper);
  set("--obr-text", theme.text && theme.text.primary);
  set("--obr-text2", theme.text && theme.text.secondary);
}

// ------------------------------------------------------------------ the sheet window
// The sheet opens as an Owlbear popover anchored at its top-RIGHT corner, so changing its width
// grows or shrinks it to the left. Size and position are remembered per browser in prefs.win
// as { r: right edge, y: top edge, w, h }. Default: half the screen wide, docked on the right,
// 90 % of the screen high.
export const MIN_W = 380;
export const MIN_H = 300;

export function halfWidth(vw) {
  return Math.max(MIN_W, Math.round(vw * 0.48));
}
export function fullWidth(vw) {
  return Math.max(MIN_W, Math.min(1700, vw - 32));
}
export function defaultHeight(vh) {
  return Math.max(MIN_H, Math.round((vh - 32) * 0.9));
}

/** Keep a window rectangle inside the viewport. */
export function clampWin(win, vw, vh) {
  const w = Math.round(Math.min(Math.max(win.w, MIN_W), Math.max(MIN_W, vw - 16)));
  const h = Math.round(Math.min(Math.max(win.h, MIN_H), Math.max(MIN_H, vh - 16)));
  const r = Math.round(Math.min(Math.max(win.r, w + 8), vw - 8));
  const y = Math.round(Math.min(Math.max(win.y, 8), Math.max(8, vh - h - 8)));
  return { r, y, w, h };
}

export function defaultWin(vw, vh, wide = false) {
  const w = wide ? fullWidth(vw) : halfWidth(vw);
  const h = defaultHeight(vh);
  return clampWin({ r: vw - 16, y: Math.round((vh - h) / 2), w, h }, vw, vh);
}

export function sheetWin(vw, vh) {
  const prefs = store.get(PREFS_KEY, {}) || {};
  const win = prefs.win;
  if (win && [win.r, win.y, win.w, win.h].every(Number.isFinite)) return clampWin(win, vw, vh);
  return defaultWin(vw, vh, prefs.wide === true);
}

export function saveWin(win) {
  const prefs = store.get(PREFS_KEY, {}) || {};
  prefs.win = win;
  store.set(PREFS_KEY, prefs);
}

/** Open (or move) the sheet popover for a token at a given rectangle (default: the remembered one). */
export async function openSheet(OBR, itemId, rect) {
  const vw = await OBR.viewport.getWidth();
  const vh = await OBR.viewport.getHeight();
  const win = rect ? clampWin(rect, vw, vh) : sheetWin(vw, vh);
  saveWin(win);
  await OBR.popover.open({
    id: POPOVER_ID,
    url: extUrl(`sheet.html?id=${encodeURIComponent(itemId)}`),
    width: win.w,
    height: win.h,
    anchorReference: "POSITION",
    anchorPosition: { left: win.r, top: win.y },
    anchorOrigin: { horizontal: "RIGHT", vertical: "TOP" },
    transformOrigin: { horizontal: "RIGHT", vertical: "TOP" },
    disableClickAway: true,
    marginThreshold: 8,
  });
}

/** Mark or unmark a token as a hero (player character). */
export async function setHero(OBR, itemId, on) {
  await OBR.scene.items.updateItems([itemId], (items) => {
    for (const item of items) {
      if (on) item.metadata[HERO_KEY] = true;
      else delete item.metadata[HERO_KEY];
    }
  });
}

/** Short description of a sheet for lists, e.g. "Cleric 3 · Dwarf". */
export function sheetSummary(sheet) {
  const cs = (sheet && sheet.pages && sheet.pages.cs) || {};
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const cls = str(cs.M2);
  const lvl = str(cs.AA2);
  const race = str(cs.AS2);
  return [[cls, lvl].filter(Boolean).join(" "), race].filter(Boolean).join(" · ");
}

export function emptySheet() {
  return { format: FORMAT, v: FORMAT_VERSION, pages: {} };
}

/** Count stored values and approximate the JSON size of a sheet. */
export function sheetStats(sheet) {
  let n = 0;
  for (const p of Object.values((sheet && sheet.pages) || {})) n += Object.keys(p).length;
  return { fields: n, bytes: new Blob([JSON.stringify(sheet || {})]).size };
}

export function characterName(sheet, fallback = "") {
  const v = sheet && sheet.pages && sheet.pages.cs && sheet.pages.cs.N1;
  return (typeof v === "string" && v.trim()) || fallback;
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
