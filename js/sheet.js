// OSRIC character sheet: renders the spreadsheet-like pages and keeps the values in the token's metadata.
import {
  KEY, HERO_KEY, POPOVER_ID, FORMAT, FORMAT_VERSION, VERSION, inOwlbear, loadOBR, whenReady, whenSceneReady,
  store, applyTheme, emptySheet, sheetStats, characterName, esc, openSheet, setHero, halfWidth, fullWidth,
  defaultWin, MIN_W, MIN_H,
} from "./common.js?v=1.2.0";
import { readWorkbook } from "./xlsx-import.js?v=1.2.0";

const params = new URLSearchParams(location.search);
const IN_OBR = inOwlbear() || !!window.__OBR_MOCK__;
const STANDALONE_KEY = "osric-sheet:standalone";
const PREFS_KEY = "osric-sheet:prefs";
const BACKUP_PREFIX = "osric-sheet:backup:";
const SEP = "\u0000";

const FONTS = {
  n: '"Aptos Narrow","SheetNarrow","Arial Narrow",sans-serif',
  Abadi: 'Abadi,"Aptos Narrow","SheetNarrow","Arial Narrow",sans-serif',
  a: 'Arial,"Liberation Sans",Arimo,Helvetica,sans-serif',
  c: 'Calibri,Carlito,"Segoe UI",Arial,sans-serif',
  p: 'Aptos,"Segoe UI",Arial,sans-serif',
};
const H_ALIGN = { l: "flex-start", c: "center", r: "flex-end", j: "flex-start", g: "flex-start" };
const T_ALIGN = { l: "left", c: "center", r: "right", j: "justify", g: "left" };
const V_ALIGN = { t: "flex-start", c: "center", b: "flex-end" };
const K = { DECOR: 0, LABEL: 1, INPUT: 2, AREA: 3, CHECK: 4 };

const prefs = Object.assign({ zoom: "fit", page: "cs", groups: {} }, store.get(PREFS_KEY, {}));
const savePrefs = () => store.set(PREFS_KEY, prefs);

const app = {
  OBR: null,
  itemId: params.get("id"),
  me: "local",
  sheet: emptySheet(),
  index: null,
  layouts: {},
  views: {},
  current: null,
  pending: new Map(),
  inflight: new Map(),
  saveTimer: null,
  saving: false,
  stamp: null,
  gone: false,
};

const $ = (sel, root = document) => root.querySelector(sel);
const scroller = $("#scroller");

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function newStamp() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ------------------------------------------------------------------ status / banners
function setStatus(kind, text) {
  const s = $("#status");
  s.dataset.kind = kind;
  s.textContent = text;
  s.title = text;
}

function banner(text, kind = "info") {
  const b = $("#banner");
  if (!text) {
    b.hidden = true;
    return;
  }
  b.hidden = false;
  b.dataset.kind = kind;
  b.textContent = text;
}

// ------------------------------------------------------------------ data model
function pageVals(pid, create) {
  let p = app.sheet.pages[pid];
  if (!p && create) p = app.sheet.pages[pid] = {};
  return p;
}

function getStored(pid, ref) {
  const p = app.sheet.pages[pid];
  return p && Object.prototype.hasOwnProperty.call(p, ref) ? p[ref] : undefined;
}

function setStored(pid, ref, value) {
  if (value === null) {
    const p = pageVals(pid, false);
    if (p) {
      delete p[ref];
      if (!Object.keys(p).length) delete app.sheet.pages[pid];
    }
  } else {
    pageVals(pid, true)[ref] = value;
  }
  app.pending.set(pid + SEP + ref, value);
  scheduleSave();
}

function hiddenPages() {
  const v = getStored("_", "hidden");
  return new Set(typeof v === "string" && v ? v.split(",") : []);
}

function normalizeSheet(raw) {
  const s = emptySheet();
  if (raw && typeof raw === "object" && raw.pages && typeof raw.pages === "object") {
    for (const [pid, vals] of Object.entries(raw.pages)) {
      if (vals && typeof vals === "object") s.pages[pid] = { ...vals };
    }
  }
  return s;
}

function applyBatch(sheet, batch) {
  for (const [k, v] of batch) {
    const [pid, ref] = k.split(SEP);
    if (v === null) {
      if (sheet.pages[pid]) {
        delete sheet.pages[pid][ref];
        if (!Object.keys(sheet.pages[pid]).length) delete sheet.pages[pid];
      }
    } else {
      if (!sheet.pages[pid]) sheet.pages[pid] = {};
      sheet.pages[pid][ref] = v;
    }
  }
}

// ------------------------------------------------------------------ saving
function scheduleSave() {
  setStatus("dirty", "Unsaved changes");
  clearTimeout(app.saveTimer);
  app.saveTimer = setTimeout(flush, 500);
}

async function flush() {
  clearTimeout(app.saveTimer);
  if (app.saving) {
    app.saveTimer = setTimeout(flush, 250);
    return;
  }
  if (!app.pending.size) return;
  const batch = new Map(app.pending);
  app.pending.clear();
  app.inflight = batch;
  app.saving = true;
  setStatus("saving", "Saving…");
  try {
    if (IN_OBR) await saveToItem(batch);
    else store.set(STANDALONE_KEY, app.sheet);
    backup();
    setStatus("ok", IN_OBR ? "Saved to token" : "Saved in this browser");
    banner(null);
  } catch (err) {
    for (const [k, v] of batch) if (!app.pending.has(k)) app.pending.set(k, v);
    const msg = (err && err.message) || String(err);
    setStatus("error", "Not saved");
    banner(`Changes could not be saved to the token (${msg}). If the GM restricted token editing, ask them for access. Retrying…`, "error");
    app.saveTimer = setTimeout(flush, 5000);
  } finally {
    app.inflight = new Map();
    app.saving = false;
    if (app.pending.size && !app.saveTimer) scheduleSave();
  }
}

async function saveToItem(batch, replaceAll = false) {
  if (app.gone) throw new Error("the token is no longer in this scene");
  const stamp = newStamp();
  let touched = false;
  await app.OBR.scene.items.updateItems([app.itemId], (items) => {
    for (const item of items) {
      touched = true;
      let m = item.metadata[KEY];
      if (replaceAll || !m || typeof m !== "object") {
        item.metadata[KEY] = { format: FORMAT, v: FORMAT_VERSION, pages: JSON.parse(JSON.stringify(app.sheet.pages)) };
        m = item.metadata[KEY];
      } else {
        if (!m.pages || typeof m.pages !== "object") m.pages = {};
        applyBatch(m, batch);
        m.format = FORMAT;
        m.v = FORMAT_VERSION;
      }
      m.stamp = stamp;
      m.by = app.me;
      m.at = Date.now();
    }
  });
  if (!touched) throw new Error("the token was not found");
  app.stamp = stamp;
}

function backup() {
  const key = BACKUP_PREFIX + (app.itemId || "standalone");
  store.set(key, { at: Date.now(), sheet: app.sheet });
}

async function replaceWhole(sheet) {
  app.sheet = normalizeSheet(sheet);
  app.pending.clear();
  refreshAll();
  if (IN_OBR) {
    setStatus("saving", "Saving…");
    try {
      await saveToItem(new Map(), true);
      setStatus("ok", "Saved to token");
    } catch (err) {
      setStatus("error", "Not saved");
      banner(`Could not save to the token: ${(err && err.message) || err}`, "error");
    }
  } else {
    store.set(STANDALONE_KEY, app.sheet);
    setStatus("ok", "Saved in this browser");
  }
  backup();
}

// remote updates
function onItemsChange(items) {
  const item = items.find((i) => i.id === app.itemId);
  if (!item) {
    if (!app.gone) {
      app.gone = true;
      banner("This token was removed from the scene, so the sheet can no longer be saved. Use ⋯ → Export to keep a copy.", "error");
      setStatus("error", "Token removed");
    }
    return;
  }
  if (app.gone) {
    app.gone = false;
    banner(null);
  }
  setTokenName(item.name);
  setHeroButton(!!item.metadata[HERO_KEY]);
  const m = item.metadata[KEY];
  const stamp = (m && m.stamp) || null;
  if (stamp === app.stamp) return;
  app.stamp = stamp;
  const incoming = normalizeSheet(m);
  applyBatch(incoming, app.inflight);
  applyBatch(incoming, app.pending);
  app.sheet = incoming;
  refreshAll();
}

// ------------------------------------------------------------------ rendering
function styleRule(pid, i, st) {
  const p = [`font-family:${FONTS[st.f] || `"${st.f}",sans-serif`}`, `font-size:${st.z}px`];
  if (st.bg) p.push(`background-color:#${st.bg}`);
  if (st.c) p.push(`color:#${st.c}`);
  if (st.b) p.push("font-weight:700");
  if (st.i) p.push("font-style:italic");
  const deco = [st.u ? "underline" : "", st.s ? "line-through" : ""].filter(Boolean).join(" ");
  if (deco) p.push(`text-decoration:${deco}`);
  if (st.h) {
    p.push(`justify-content:${H_ALIGN[st.h]}`);
    p.push(`text-align:${T_ALIGN[st.h]}`);
  }
  if (st.v) p.push(`align-items:${V_ALIGN[st.v]}`);
  if (st.in) p.push(`padding-left:${2 + st.in * 9}px`);
  if (st.bt) p.push(`border-top:${st.bt}`);
  if (st.br) p.push(`border-right:${st.br}`);
  if (st.bb) p.push(`border-bottom:${st.bb}`);
  if (st.bl) p.push(`border-left:${st.bl}`);
  return `#pg-${pid} .s${i}{${p.join(";")}}`;
}

async function fetchJSON(path) {
  const res = await fetch(new URL(`${path}?v=${VERSION}`, location.href));
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function getLayout(pid) {
  if (!app.layouts[pid]) app.layouts[pid] = fetchJSON(`layouts/${pid}.json`);
  return app.layouts[pid];
}

// A page is made of one or more blocks, each its own grid. The Character Sheet has two:
// its right half (movement, money, items) sits under the left half.
function groupState(view, b) {
  const saved = prefs.groups[view.pid] || {};
  b.colsCollapsed = new Uint8Array(b.C);
  b.rowsCollapsed = new Uint8Array(b.R);
  b.layout.colGroups.forEach(([s, e, def], gi) => {
    const collapsed = saved[`${b.index}c${gi}`] ?? def;
    if (collapsed) for (let i = s; i <= e; i++) b.colsCollapsed[i] = 1;
  });
  b.layout.rowGroups.forEach(([s, e, def], gi) => {
    const collapsed = saved[`${b.index}r${gi}`] ?? def;
    if (collapsed) for (let i = s; i <= e; i++) b.rowsCollapsed[i] = 1;
  });
}

function applyTracks(b) {
  const L = b.layout;
  b.cw = L.cols.map((w, i) => (b.colsCollapsed[i] ? 0 : w));
  b.rh = L.rows.map((h, i) => (b.rowsCollapsed[i] ? 0 : h));
  b.width = b.cw.reduce((x, y) => x + y, 0);
  b.height = b.rh.reduce((x, y) => x + y, 0);
  b.cx = [0];
  for (const w of b.cw) b.cx.push(b.cx[b.cx.length - 1] + w);
  b.ry = [0];
  for (const h of b.rh) b.ry.push(b.ry[b.ry.length - 1] + h);
  const cols = b.cw.map((w) => w + "px").join(" ");
  const rows = b.rh.map((h) => h + "px").join(" ");
  b.grid.style.gridTemplateColumns = cols;
  b.grid.style.gridTemplateRows = rows;
  if (b.olTop) b.olTop.style.gridTemplateColumns = cols;
  if (b.olLeft) b.olLeft.style.gridTemplateRows = rows;
  // hide elements that sit entirely inside collapsed tracks
  const any = b.colsCollapsed.some((x) => x) || b.rowsCollapsed.some((x) => x);
  b.nodes.forEach((node, i) => {
    const [r, c, rs, cs] = L.cells[i];
    let gone = false;
    if (any) {
      let allC = true;
      for (let x = c; x < c + cs; x++) if (!b.colsCollapsed[x]) { allC = false; break; }
      let allR = true;
      for (let y = r; y < r + rs; y++) if (!b.rowsCollapsed[y]) { allR = false; break; }
      gone = allC || allR;
    }
    node.classList.toggle("gone", gone);
    if (node._mark) node._mark.classList.toggle("gone", gone);
  });
  for (const node of b.free.values()) node.classList.toggle("gone", !!(b.rowsCollapsed[node._r] || b.colsCollapsed[node._c]));
}

function updateViewSize(view) {
  view.width = Math.max(...view.blocks.map((b) => b.width + (b.olLeft ? 16 : 0)));
}

function buildOutline(view, b) {
  const L = b.layout;
  const mkBtn = (collapsed, onClick, title) => {
    const btn = el("button", "ol-btn", collapsed ? "+" : "−");
    btn.type = "button";
    btn.title = title;
    btn.addEventListener("click", onClick);
    return btn;
  };
  if (L.colGroups.length) {
    const top = el("div", "ol-top");
    L.colGroups.forEach(([s, e], gi) => {
      const collapsed = b.colsCollapsed[s];
      const line = el("div", "ol-line-h");
      line.style.gridColumn = `${s + 1} / ${e + 2}`;
      top.appendChild(line);
      const at = Math.min(e + 1, b.C - 1);
      const what = `columns ${L.colIds[s]}–${L.colIds[e]}`;
      const btn = mkBtn(collapsed, () => toggleGroup(view, b, "c", gi), collapsed ? `Show ${what}` : `Hide ${what}`);
      btn.style.gridColumn = `${at + 1}`;
      top.appendChild(btn);
    });
    b.olTop = top;
  }
  if (L.rowGroups.length) {
    const left = el("div", "ol-left");
    L.rowGroups.forEach(([s, e], gi) => {
      const collapsed = b.rowsCollapsed[s];
      const line = el("div", "ol-line-v");
      line.style.gridRow = `${s + 1} / ${e + 2}`;
      left.appendChild(line);
      const at = Math.min(e + 1, b.R - 1);
      const what = `rows ${L.rowIds[s]}–${L.rowIds[e]}`;
      const btn = mkBtn(collapsed, () => toggleGroup(view, b, "r", gi), collapsed ? `Show ${what}` : `Hide ${what}`);
      btn.style.gridRow = `${at + 1}`;
      left.appendChild(btn);
    });
    b.olLeft = left;
  }
}

function toggleGroup(view, b, kind, gi) {
  const [s] = kind === "c" ? b.layout.colGroups[gi] : b.layout.rowGroups[gi];
  const now = kind === "c" ? b.colsCollapsed[s] : b.rowsCollapsed[s];
  const saved = (prefs.groups[view.pid] = prefs.groups[view.pid] || {});
  saved[`${b.index}${kind}${gi}`] = now ? 0 : 1;
  savePrefs();
  groupState(view, b);
  const oldTop = b.olTop, oldLeft = b.olLeft;
  b.olTop = b.olLeft = null;
  buildOutline(view, b);
  if (oldTop) oldTop.replaceWith(b.olTop);
  if (oldLeft) oldLeft.replaceWith(b.olLeft);
  applyTracks(b);
  layoutOverflow(view, b);
  fitText(view, b);
  updateViewSize(view);
  applyZoom();
}

function fieldValue(node) {
  const v = getStored(node._pid, node._ref);
  if (node._kind === K.CHECK) return v === undefined ? !!node._def : !!v;
  if (v === undefined) return node._def == null ? "" : String(node._def);
  return String(v);
}

function setFieldValue(node) {
  if (node === document.activeElement) return;
  const v = fieldValue(node);
  if (node._kind === K.CHECK) {
    if (node._box.checked !== v) node._box.checked = v;
  } else if (node.value !== v) {
    node.value = v;
  }
}

function buildBlock(view, blk, index) {
  const pid = view.pid;
  const styles = view.layout.styles;
  const b = {
    index, layout: blk, styles, R: blk.rows.length, C: blk.cols.length,
    nodes: [], free: new Map(), labels: [], olTop: null, olLeft: null,
  };
  b.frame = el("div", "frame");
  b.grid = el("div", "grid");
  groupState(view, b);
  buildOutline(view, b);
  const occ = new Int32Array(b.R * b.C).fill(-1);
  b.occ = occ;
  const frag = document.createDocumentFragment();
  blk.cells.forEach((rec, i) => {
    const [r, c, rs, cs, s, k, ref, t, note, link] = rec;
    const st = styles[s];
    let node;
    if (k === K.LABEL) {
      node = el("div", `c l s${s}`);
      node.appendChild(el("span", "t", t === 0 || t == null ? "" : String(t)));
      if (st.w) node.classList.add("w");
      if (st.r) node.classList.add(st.r === 180 ? "r270" : "r90");
      if (!st.w && !st.r && rs === 1) b.labels.push(i);
      if (link) {
        node.classList.add("lnk");
        node.tabIndex = 0;
        node.addEventListener("click", () => followLink(link));
        node.addEventListener("keydown", (e) => e.key === "Enter" && followLink(link));
      }
    } else if (k === K.INPUT || k === K.AREA) {
      node = document.createElement(k === K.AREA ? "textarea" : "input");
      node.className = `c f s${s}`;
      if (k === K.INPUT) node.type = "text";
      node.spellcheck = false;
      node.autocomplete = "off";
      node._kind = k;
    } else if (k === K.CHECK) {
      node = el("label", `c k f s${s}`);
      const box = document.createElement("input");
      box.type = "checkbox";
      node.appendChild(box);
      node._box = box;
      box._owner = node;
      node._kind = k;
    } else {
      node = el("div", `c s${s}`);
    }
    if (k === K.INPUT || k === K.AREA || k === K.CHECK) {
      node._pid = pid;
      node._ref = ref;
      node._def = k === K.CHECK ? !!t : t === 0 || t == null ? "" : String(t);
      view.fields.set(ref, node);
      setFieldValue(node);
      if (k !== K.CHECK) node.setAttribute("aria-label", ref);
    }
    node.style.gridArea = `${r + 1} / ${c + 1} / span ${rs} / span ${cs}`;
    if (note) {
      node.title = note;
      const mark = el("div", "nm");
      mark.style.gridArea = `${r + 1} / ${c + cs} / span 1 / span 1`;
      node._mark = mark;
      frag.appendChild(mark);
    }
    for (let y = r; y < r + rs; y++) for (let x = c; x < c + cs; x++) occ[y * b.C + x] = i;
    b.nodes[i] = node;
    frag.appendChild(node);
  });
  b.grid.appendChild(frag);
  b.grid.addEventListener("input", onFieldInput);
  b.grid.addEventListener("change", onFieldInput);
  b.grid.addEventListener("mousedown", (e) => onGridMouseDown(view, b, e));
  b.grid.addEventListener("focusout", (e) => onFreeBlur(view, b, e));
  if (b.olTop) {
    b.frame.appendChild(el("div", "ol-corner"));
    b.frame.appendChild(b.olTop);
  }
  if (b.olLeft) b.frame.appendChild(b.olLeft);
  b.frame.appendChild(b.grid);
  b.frame.classList.toggle("has-top", !!b.olTop);
  b.frame.classList.toggle("has-left", !!b.olLeft);
  applyTracks(b);
  return b;
}

function buildView(layout) {
  const pid = layout.id;
  const view = { pid, layout, fields: new Map(), blocks: [] };
  const page = el("section", "page");
  page.id = "pg-" + pid;
  page.dataset.pid = pid;
  const style = document.createElement("style");
  style.textContent = layout.styles.map((st, i) => styleRule(pid, i, st)).join("\n");
  page.appendChild(style);
  const zoomBox = el("div", "zoombox");
  view.page = page;
  view.zoomBox = zoomBox;
  layout.blocks.forEach((blk, i) => {
    const b = buildBlock(view, blk, i);
    view.blocks.push(b);
    zoomBox.appendChild(b.frame);
  });
  page.appendChild(zoomBox);
  updateViewSize(view);
  // values typed into empty (free) cells
  const vals = app.sheet.pages[pid] || {};
  for (const ref of Object.keys(vals)) if (!view.fields.has(ref)) addFree(view, ref, false, true);
  return view;
}

function buildTextView(layout) {
  const page = el("section", "page textpage");
  page.id = "pg-" + layout.id;
  const box = el("article", "doc");
  for (const para of layout.text) {
    const parts = para.split(/\n/);
    for (const part of parts) {
      if (!part.trim()) continue;
      const p = el("p", /^\[(BEGINNING|END) OF LICENSE\]|^[A-Z0-9 ()/.-]{12,}$/.test(part.trim()) ? "h" : "", part.trim());
      box.appendChild(p);
    }
  }
  const credit = el("p", "credit");
  credit.innerHTML = `Layout taken from the <a href="${esc(app.index.sourceUrl)}" target="_blank" rel="noopener">${esc(app.index.source)}</a>. This extension only reproduces its fields; it does no calculations.`;
  box.appendChild(credit);
  page.appendChild(box);
  return { pid: layout.id, layout, page, text: true, fields: new Map(), blocks: [] };
}

// ------------------------------------------------------------------ text overflow (like a spreadsheet)
function isFree(b, y, x) {
  return b.occ[y * b.C + x] === -1 && !b.freeAt?.has(y * b.C + x);
}

function layoutOverflow(view, only) {
  if (view.text) return;
  for (const b of only ? [only] : view.blocks) {
    b.freeAt = new Set();
    for (const node of b.free.values()) {
      for (let x = node._c; x < node._c + node._cs; x++) b.freeAt.add(node._r * b.C + x);
    }
    const cells = b.layout.cells;
    for (const i of b.labels) {
      const node = b.nodes[i];
      const [r, c, , cs, s] = cells[i];
      const h = b.styles[s].h || "l";
      let own = 0;
      for (let x = c; x < c + cs; x++) own += b.cw[x];
      let right = 0;
      for (let x = c + cs; x < b.C && isFree(b, r, x); x++) right += b.cw[x];
      let left = 0;
      for (let x = c - 1; x >= 0 && isFree(b, r, x); x--) left += b.cw[x];
      let max = own;
      if (h === "r") max = own + left;
      else if (h === "c") max = own + 2 * Math.min(left, right);
      else max = own + right;
      node.firstChild.style.maxWidth = Math.max(0, max - 4) + "px";
    }
  }
}

// Text that still doesn't fit its cell is made a little smaller (down to 74 %), like Excel's
// "shrink to fit". This lets the class pages be narrower than in the spreadsheet.
function overflows(t) {
  if (t.tagName === "TEXTAREA") return !!t.value && t.scrollHeight > t.clientHeight + 2;
  const cell = t.parentNode;
  if (cell.classList.contains("w") || cell.classList.contains("r90") || cell.classList.contains("r270")) {
    return t.scrollHeight > t.clientHeight + 1;
  }
  return t.scrollWidth > t.clientWidth + 1;
}

function fitText(view, only) {
  if (view.text || !view.page.isConnected) return;
  // measure at 100 % zoom (zoomed measurements round differently); callers re-apply the zoom
  view.zoomBox.style.zoom = "1";
  for (const b of only ? [only] : view.blocks) {
    const items = [];
    for (const node of b.nodes) {
      if (!node || node.classList.contains("gone")) continue;
      if (node.classList.contains("l")) items.push(node.firstChild);
      else if (node.tagName === "TEXTAREA") items.push(node);
    }
    for (const t of items) {
      if (t._shrunk) {
        t.style.fontSize = "";
        t._shrunk = false;
      }
    }
    const over = items.filter(overflows); // measure everything before changing anything
    for (const t of over) shrink(t);
  }
}

function shrink(t) {
  const base = parseFloat(getComputedStyle(t).fontSize) || 12;
  for (let f = 0.92; f >= 0.73; f -= 0.06) {
    t.style.fontSize = (base * f).toFixed(2) + "px";
    t._shrunk = true;
    if (!overflows(t)) break;
  }
}

// ------------------------------------------------------------------ free cells
/** Find the block and grid position of a cell reference such as "BX12". */
function locate(view, ref) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m || !view.blocks) return null;
  for (const b of view.blocks) {
    const x = b.layout.colIds.indexOf(m[1]);
    if (x < 0) continue;
    const y = b.layout.rowIds.indexOf(Number(m[2]));
    if (y < 0) continue;
    return [b, y, x];
  }
  return null;
}

function freeSpan(b, y, x) {
  let n = 1;
  for (let c = x + 1; c < b.C; c++) {
    if (b.occ[y * b.C + c] !== -1) break;
    let taken = false;
    for (const other of b.free.values()) if (other._r === y && other._c === c) taken = true;
    if (taken) break;
    n++;
    if (n >= 40) break;
  }
  return n;
}

function respanRow(b, y) {
  for (const node of b.free.values()) {
    if (node._r !== y) continue;
    node._cs = freeSpan(b, y, node._c);
    node.style.gridArea = `${y + 1} / ${node._c + 1} / span 1 / span ${node._cs}`;
  }
}

function addFree(view, ref, focus, quiet = false) {
  const loc = locate(view, ref);
  if (!loc) return null;
  const [b, y, x] = loc;
  if (b.free.has(ref)) {
    if (focus) b.free.get(ref).focus();
    return b.free.get(ref);
  }
  if (b.occ[y * b.C + x] !== -1) return null;
  const node = document.createElement("input");
  node.type = "text";
  node.className = "c f free";
  node.spellcheck = false;
  node.autocomplete = "off";
  node._pid = view.pid;
  node._ref = ref;
  node._def = "";
  node._kind = K.INPUT;
  node._r = y;
  node._c = x;
  node._free = true;
  node.setAttribute("aria-label", ref);
  b.free.set(ref, node);
  b.grid.appendChild(node);
  respanRow(b, y);
  setFieldValue(node);
  if (b.rowsCollapsed[y] || b.colsCollapsed[x]) node.classList.add("gone");
  if (!quiet) layoutOverflow(view, b);
  if (focus) node.focus();
  return node;
}

function removeFree(view, b, ref) {
  const node = b.free.get(ref);
  if (!node) return;
  b.free.delete(ref);
  node.remove();
  respanRow(b, node._r);
  layoutOverflow(view, b);
}

function onGridMouseDown(view, b, e) {
  if (e.target !== b.grid || e.button !== 0) return;
  const rect = b.grid.getBoundingClientRect();
  const scale = rect.width / b.width || 1;
  const x = bisect(b.cx, (e.clientX - rect.left) / scale);
  const y = bisect(b.ry, (e.clientY - rect.top) / scale);
  if (x < 0 || y < 0 || x >= b.C || y >= b.R) return;
  if (b.occ[y * b.C + x] !== -1) return;
  e.preventDefault();
  addFree(view, b.layout.colIds[x] + b.layout.rowIds[y], true);
}

function bisect(edges, v) {
  let lo = 0, hi = edges.length - 1;
  if (v < 0 || v >= edges[hi]) return -1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (edges[mid] <= v) lo = mid;
    else hi = mid;
  }
  // skip zero-width (collapsed) tracks
  while (lo < edges.length - 2 && edges[lo + 1] === edges[lo]) lo++;
  return lo;
}

function onFreeBlur(view, b, e) {
  const node = e.target;
  if (node.tagName === "TEXTAREA") {
    const z = view.zoomBox.style.zoom;
    view.zoomBox.style.zoom = "1";
    if (node._shrunk) {
      node.style.fontSize = "";
      node._shrunk = false;
    }
    if (overflows(node)) shrink(node);
    view.zoomBox.style.zoom = z;
  }
  if (!node._free) return;
  setTimeout(() => {
    if (node !== document.activeElement && node.value === "") removeFree(view, b, node._ref);
  }, 0);
}

// ------------------------------------------------------------------ editing
function onFieldInput(e) {
  let node = e.target;
  if (node._owner) node = node._owner;
  if (!node._ref) return;
  if (node._kind === K.CHECK) {
    const v = node._box.checked;
    setStored(node._pid, node._ref, v === !!node._def ? null : v);
  } else {
    const v = node.value;
    const def = node._def || "";
    setStored(node._pid, node._ref, v === def ? null : v);
  }
  if (node._pid === "cs" && node._ref === "N1") updateTitle();
}

function refreshView(view) {
  if (view.text) return;
  for (const node of view.fields.values()) setFieldValue(node);
  const vals = app.sheet.pages[view.pid] || {};
  for (const b of view.blocks) {
    for (const [ref, node] of [...b.free]) {
      if (!(ref in vals) && node !== document.activeElement) removeFree(view, b, ref);
      else setFieldValue(node);
    }
  }
  for (const ref of Object.keys(vals)) {
    if (!view.fields.has(ref) && !view.blocks.some((b) => b.free.has(ref))) addFree(view, ref, false);
  }
}

function refreshAll() {
  for (const view of Object.values(app.views)) refreshView(view);
  updateTitle();
  updateTabs();
}

// ------------------------------------------------------------------ pages / tabs / zoom
async function showPage(pid) {
  if (!app.index.pages.some((p) => p.id === pid)) pid = "cs";
  const prev = app.views[app.current];
  if (prev) prev.scroll = { top: scroller.scrollTop, left: scroller.scrollLeft };
  app.current = pid;
  prefs.page = pid;
  savePrefs();
  updateTabs();
  let view = app.views[pid];
  if (!view) {
    const loading = el("div", "loading", "Loading page…");
    scroller.appendChild(loading);
    const layout = await getLayout(pid);
    view = app.views[pid] = layout.text ? buildTextView(layout) : buildView(layout);
    loading.remove();
    scroller.appendChild(view.page);
    if (!view.text) {
      layoutOverflow(view);
      view.page.classList.add("on");
      try {
        await document.fonts.ready; // measure with the real font
      } catch (_) {
        /* ignore */
      }
      fitText(view);
    }
  }
  for (const v of Object.values(app.views)) v.page.classList.toggle("on", v === view);
  applyZoom();
  scroller.scrollTop = view.scroll ? view.scroll.top : 0;
  scroller.scrollLeft = view.scroll ? view.scroll.left : 0;
}

function buildTabs() {
  const tabs = $("#tabs");
  tabs.innerHTML = "";
  for (const p of app.index.pages) {
    const b = el("button", "tab", p.title);
    b.type = "button";
    b.dataset.pid = p.id;
    b.addEventListener("click", () => showPage(p.id));
    tabs.appendChild(b);
  }
  updateTabs();
}

function updateTabs() {
  const hidden = hiddenPages();
  for (const b of document.querySelectorAll("#tabs .tab")) {
    b.classList.toggle("on", b.dataset.pid === app.current);
    b.hidden = hidden.has(b.dataset.pid) && b.dataset.pid !== app.current;
  }
  const on = $("#tabs .tab.on");
  if (on) on.scrollIntoView({ block: "nearest", inline: "nearest" });
}

// "Fit" zoom: every page uses the scale that fits the Character Sheet (at most 120 %), so text is the
// same size on the Character Sheet and the class pages; pages wider than that shrink to fit.
const FIT_MAX = 1.2;
function currentZoom(view) {
  if (prefs.zoom !== "fit") return Number(prefs.zoom) || 1;
  if (!view || view.text) return 1;
  const avail = scroller.clientWidth - 24;
  const cs = app.views.cs && !app.views.cs.text ? app.views.cs.width : (app.index.pages.find((p) => p.id === "cs") || {}).w;
  const ref = cs || view.width;
  return Math.max(0.5, Math.min(FIT_MAX, avail / ref, avail / view.width));
}

function applyZoom() {
  const view = app.views[app.current];
  const z = currentZoom(view);
  if (view && !view.text) view.zoomBox.style.zoom = String(z);
  $("#zoomval").textContent = prefs.zoom === "fit" ? `Fit ${Math.round(z * 100)}%` : `${Math.round(z * 100)}%`;
}

function stepZoom(dir) {
  const view = app.views[app.current];
  const cur = currentZoom(view);
  const steps = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
  let next = cur;
  if (dir > 0) next = steps.find((s) => s > cur + 0.001) ?? 2;
  else next = [...steps].reverse().find((s) => s < cur - 0.001) ?? 0.5;
  prefs.zoom = next;
  savePrefs();
  applyZoom();
}

function followLink(link) {
  const m = /^([a-z0-9]+)!([A-Z]+\d+)$/.exec(link);
  if (!m) {
    if (/^https?:/.test(link)) window.open(link, "_blank", "noopener");
    return;
  }
  const [, pid, ref] = m;
  showPage(pid).then(() => {
    const view = app.views[pid];
    const loc = view && locate(view, ref);
    if (!loc) return;
    const [b, y, x] = loc;
    const r = b.grid.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    const scale = r.width / b.width || 1;
    scroller.scrollTo({
      top: Math.max(0, scroller.scrollTop + (r.top - s.top) + b.ry[y] * scale - 10),
      left: Math.max(0, scroller.scrollLeft + (r.left - s.left) + b.cx[x] * scale - 20),
      behavior: "smooth",
    });
  });
}

// ------------------------------------------------------------------ title
let tokenName = "";
function setTokenName(name) {
  tokenName = name || "";
  updateTitle();
}

function updateTitle() {
  const name = characterName(app.sheet, tokenName || (IN_OBR ? "Character" : "Character sheet"));
  $("#title").textContent = name;
  $("#title").title = tokenName && tokenName !== name ? `Token: ${tokenName}` : name;
  document.title = `${name} · OSRIC sheet`;
}

// ------------------------------------------------------------------ menu & dialogs
function openDialog(html, onReady) {
  const dlg = $("#dialog");
  dlg.innerHTML = html;
  dlg.showModal();
  dlg.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dlg.close()));
  if (onReady) onReady(dlg);
  return dlg;
}

function download(name, text) {
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
    return true;
  } catch (_) {
    return false;
  }
}

function exportSheet() {
  const name = characterName(app.sheet, tokenName || "character");
  const data = { format: FORMAT, v: FORMAT_VERSION, exported: new Date().toISOString(), name, pages: app.sheet.pages };
  const text = JSON.stringify(data, null, 1);
  const file = `${name.replace(/[^\w\- ]+/g, "").trim() || "character"} (OSRIC sheet).json`;
  openDialog(
    `<h2>Export sheet</h2>
     <p>A JSON file with every value on this sheet. Use <b>Import</b> to load it onto another token, in another scene or room.</p>
     <textarea class="json" readonly>${esc(text)}</textarea>
     <div class="row"><button type="button" class="primary" data-dl>Download file</button>
     <button type="button" data-copy>Copy text</button><span class="spacer"></span><button type="button" data-close>Close</button></div>`,
    (dlg) => {
      dlg.querySelector("[data-dl]").addEventListener("click", () => download(file, text));
      dlg.querySelector("[data-copy]").addEventListener("click", async (e) => {
        const ta = dlg.querySelector("textarea");
        ta.select();
        let ok = false;
        try {
          await navigator.clipboard.writeText(text);
          ok = true;
        } catch (_) {
          try {
            ok = document.execCommand("copy");
          } catch (__) {
            ok = false;
          }
        }
        e.target.textContent = ok ? "Copied" : "Select and copy manually";
      });
    },
  );
}

function importSheet() {
  openDialog(
    `<h2>Import</h2>
     <p><b>From an exported sheet (.json)</b> or pasted text. This replaces everything on this sheet.</p>
     <div class="row"><input type="file" accept=".json,application/json" data-json></div>
     <textarea class="json" placeholder="…or paste exported JSON here" data-paste></textarea>
     <div class="row"><button type="button" class="primary" data-load>Load pasted text</button></div>
     <hr>
     <p><b>From a filled-in copy of the spreadsheet (.xlsx)</b>, e.g. downloaded from Google Sheets with File → Download → Microsoft Excel.
     Values are read from the cells, including the results of formulas, and placed in the same fields here. Made for template v2.2.</p>
     <div class="row"><input type="file" accept=".xlsx" data-xlsx></div>
     <p class="msg" data-msg></p>
     <div class="ask" data-ask hidden><p data-asktext></p><div class="row"><span class="spacer"></span>
       <button type="button" data-no>Cancel</button><button type="button" class="danger" data-yes>Replace this sheet</button></div></div>
     <div class="row"><span class="spacer"></span><button type="button" data-close>Close</button></div>`,
    (dlg) => {
      const msg = dlg.querySelector("[data-msg]");
      // window.confirm() can be blocked inside Owlbear's frames, so ask inside the dialog
      const ask = (text) =>
        new Promise((resolve) => {
          const box = dlg.querySelector("[data-ask]");
          dlg.querySelector("[data-asktext]").textContent = text;
          box.hidden = false;
          const done = (v) => {
            box.hidden = true;
            resolve(v);
          };
          dlg.querySelector("[data-yes]").onclick = () => done(true);
          dlg.querySelector("[data-no]").onclick = () => done(false);
          dlg.querySelector("[data-yes]").focus();
        });
      const loadJson = async (text) => {
        let data;
        try {
          data = JSON.parse(text);
        } catch (_) {
          msg.textContent = "That is not valid JSON.";
          return;
        }
        if (!data || typeof data.pages !== "object") {
          msg.textContent = "That file is not an exported OSRIC sheet.";
          return;
        }
        if (!(await ask(`Replace everything on this sheet with the ${sheetStats(data).fields} imported values?`))) return;
        await replaceWhole(data);
        dlg.close();
      };
      dlg.querySelector("[data-json]").addEventListener("change", async (e) => {
        const f = e.target.files[0];
        if (f) loadJson(await f.text());
      });
      dlg.querySelector("[data-load]").addEventListener("click", () => loadJson(dlg.querySelector("[data-paste]").value));
      dlg.querySelector("[data-xlsx]").addEventListener("change", async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        msg.textContent = "Reading spreadsheet…";
        try {
          const result = await importFromXlsx(f);
          if (!result.count) {
            msg.textContent = "No values found. Is this a copy of the OSRIC character sheet template?";
            return;
          }
          msg.textContent = "";
          if (!(await ask(`Found ${result.count} values on ${result.pages} pages. Replace everything on this sheet with them?`))) return;
          await replaceWhole(result.sheet);
          dlg.close();
        } catch (err) {
          msg.textContent = `Could not read the file: ${(err && err.message) || err}`;
        }
      });
    },
  );
}

async function importFromXlsx(file) {
  const layouts = await Promise.all(app.index.pages.map((p) => getLayout(p.id)));
  const grids = layouts.filter((l) => !l.text);
  const { sheets } = await readWorkbook(file, grids.map((l) => l.sheet));
  const sheet = emptySheet();
  let count = 0;
  let pages = 0;
  for (const layout of grids) {
    const cells = sheets[layout.sheet];
    if (!cells) continue;
    const kinds = new Map();
    const blocks = layout.blocks.map((blk) => {
      const C = blk.cols.length;
      const occ = new Int32Array(blk.rows.length * C).fill(-1);
      blk.cells.forEach((rec, i) => {
        const [r, c, rs, cs, , k, ref, t] = rec;
        for (let y = r; y < r + rs; y++) for (let x = c; x < c + cs; x++) occ[y * C + x] = i;
        if (k >= 2 && ref) kinds.set(ref, { k, def: k === 4 ? !!t : t === 0 || t == null ? "" : String(t) });
      });
      return { C, occ, colIndex: new Map(blk.colIds.map((c, i) => [c, i])), rowIndex: new Map(blk.rowIds.map((r, i) => [r, i])) };
    });
    const vals = {};
    for (const [ref, cell] of cells) {
      const f = kinds.get(ref);
      if (f) {
        if (f.k === 4) {
          const v = cell.bool != null ? cell.bool : /^(true|yes|x|1)$/i.test(cell.text);
          if (v !== f.def) vals[ref] = v;
        } else if (cell.text !== f.def) {
          vals[ref] = cell.text;
        }
        continue;
      }
      const m = /^([A-Z]+)(\d+)$/.exec(ref);
      if (!m) continue;
      for (const b of blocks) {
        const x = b.colIndex.get(m[1]);
        const y = b.rowIndex.get(Number(m[2]));
        if (x == null || y == null) continue;
        if (b.occ[y * b.C + x] === -1) vals[ref] = cell.text; // typed into an empty cell
        break;
      }
    }
    const n = Object.keys(vals).length;
    if (n) {
      sheet.pages[layout.id] = vals;
      count += n;
      pages++;
    }
  }
  return { sheet, count, pages };
}

function pagesDialog() {
  const hidden = hiddenPages();
  const rows = app.index.pages
    .map((p) => `<label class="chk"><input type="checkbox" value="${p.id}" ${hidden.has(p.id) ? "" : "checked"}> ${esc(p.title)}</label>`)
    .join("");
  openDialog(
    `<h2>Pages</h2><p>Untick the pages this character doesn't use (for example the other classes). This is saved with the sheet, so everyone sees the same tabs.</p>
     <div class="pagelist">${rows}</div>
     <div class="row"><span class="spacer"></span><button type="button" class="primary" data-ok>Done</button></div>`,
    (dlg) => {
      dlg.querySelector("[data-ok]").addEventListener("click", () => {
        const hide = [...dlg.querySelectorAll("input[type=checkbox]")].filter((b) => !b.checked).map((b) => b.value);
        setStored("_", "hidden", hide.length ? hide.join(",") : null);
        updateTabs();
        dlg.close();
      });
    },
  );
}

function clearDialog() {
  const { fields, bytes } = sheetStats(app.sheet);
  openDialog(
    `<h2>Clear sheet</h2><p>This removes all ${fields} values from this sheet${IN_OBR ? " and its token" : ""}. Export first if you want a copy.</p>
     <div class="row"><span class="spacer"></span><button type="button" data-close>Cancel</button><button type="button" class="danger" data-ok>Clear everything</button></div>
     <p class="msg">Sheet size: ${(bytes / 1024).toFixed(1)} KB.</p>`,
    (dlg) => {
      dlg.querySelector("[data-ok]").addEventListener("click", () => {
        replaceWhole(emptySheet());
        dlg.close();
      });
    },
  );
}

function aboutDialog() {
  const { fields, bytes } = sheetStats(app.sheet);
  openDialog(
    `<h2>About this sheet</h2>
     <p>Same pages and fields as the <a href="${esc(app.index.sourceUrl)}" target="_blank" rel="noopener">${esc(app.index.source)}</a>, without the formulas and dropdowns: every field is typed in by hand.
     Click any empty spot on a page to write there, as in the spreadsheet. A small red corner means the cell has a note: hover over it to read it.
     The <b>+</b>/<b>−</b> buttons at the edge show or hide the grouped rows and columns (HP by level, psionics, weaponless tables).</p>
     <p>${IN_OBR ? "Values are saved on the token itself, so everyone in the room sees the same sheet and changes appear live." : "Preview mode: not opened from Owlbear Rodeo, so values are kept in this browser only."}
     ${fields} values, ${(bytes / 1024).toFixed(1)} KB.</p>
     <div class="row"><span class="spacer"></span><button type="button" data-close>Close</button></div>`,
  );
}

function bindToolbar() {
  $("#zoomout").addEventListener("click", () => stepZoom(-1));
  $("#zoomin").addEventListener("click", () => stepZoom(1));
  $("#zoomval").addEventListener("click", () => {
    prefs.zoom = prefs.zoom === "fit" ? 1 : "fit";
    savePrefs();
    applyZoom();
  });
  $("#pagesbtn").addEventListener("click", pagesDialog);
  const menu = $("#menu");
  $("#menubtn").addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener("click", () => (menu.hidden = true));
  menu.addEventListener("click", (e) => {
    const act = e.target.dataset.act;
    menu.hidden = true;
    if (act === "export") exportSheet();
    else if (act === "import") importSheet();
    else if (act === "clear") clearDialog();
    else if (act === "about") aboutDialog();
    else if (act === "resetwin" && app.resetWindow) app.resetWindow();
  });
  window.addEventListener("resize", () => {
    if (prefs.zoom === "fit") applyZoom();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      flush();
    }
  });
  window.addEventListener("pagehide", () => flush());
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
}

// ------------------------------------------------------------------ the sheet window (inside Owlbear)
function setHeroButton(on) {
  const btn = $("#herobtn");
  btn.classList.toggle("on", on);
  btn.textContent = on ? "★" : "☆";
  btn.title = on ? "This token is a hero (listed first in the extension's panel). Click to unmark." : "Mark this token as a hero, so its sheet is listed under Heroes";
  btn.setAttribute("aria-pressed", on ? "true" : "false");
  app.hero = on;
}

function bindPopoverControls() {
  const OBR = app.OBR;
  const sizeBtn = $("#sizebtn");
  const closeBtn = $("#closebtn");
  const grip = $("#grip");
  const bar = $(".bar");
  const ghost = $("#ghost");
  sizeBtn.hidden = false;
  closeBtn.hidden = false;
  grip.hidden = false;
  document.body.classList.add("in-obr");
  closeBtn.addEventListener("click", async () => {
    await flush();
    OBR.popover.close(POPOVER_ID);
  });

  let vw = window.innerWidth;
  let vh = window.innerHeight;
  const refreshViewport = async () => {
    vw = await OBR.viewport.getWidth();
    vh = await OBR.viewport.getHeight();
  };
  // prefs.win = { r: right edge, y: top, w, h } of the popover, which is anchored at its top-right corner
  const win = () => prefs.win || { r: vw - 16, y: 16, w: window.innerWidth, h: window.innerHeight };
  const saveWinPrefs = (w) => {
    prefs.win = w;
    savePrefs();
  };

  // Half / Full presets (Half is the default). Width changes grow or shrink the sheet to the left.
  let wide = prefs.wide === true;
  const label = () => {
    sizeBtn.textContent = wide ? "◨ Half" : "▣ Full";
    sizeBtn.title = wide ? "Make the sheet half as wide so you can see the map" : "Make the sheet use the full width";
  };
  label();
  sizeBtn.addEventListener("click", async () => {
    await refreshViewport();
    wide = !wide;
    prefs.wide = wide;
    label();
    const cur = win();
    const w = Math.max(MIN_W, Math.min(wide ? fullWidth(vw) : halfWidth(vw), cur.r - 8));
    saveWinPrefs({ ...cur, w });
    await OBR.popover.setWidth(POPOVER_ID, w);
  });

  // resize from the bottom-left corner (the top-right corner stays put)
  grip.addEventListener("pointerdown", async (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    await refreshViewport();
    const start = { sx: e.screenX, sy: e.screenY, ...win() };
    let next = null;
    let frame = 0;
    const onMove = (ev) => {
      const w = Math.round(Math.min(Math.max(MIN_W, start.w + start.sx - ev.screenX), start.r - 8));
      const h = Math.round(Math.min(Math.max(MIN_H, start.h + ev.screenY - start.sy), vh - start.y - 8));
      next = { r: start.r, y: start.y, w, h };
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          OBR.popover.setWidth(POPOVER_ID, next.w);
          OBR.popover.setHeight(POPOVER_ID, next.h);
        });
      }
    };
    const onUp = () => {
      grip.removeEventListener("pointermove", onMove);
      grip.removeEventListener("pointerup", onUp);
      grip.removeEventListener("pointercancel", onUp);
      if (!next) return;
      wide = next.w >= fullWidth(vw) - 40;
      prefs.wide = wide;
      label();
      saveWinPrefs(next);
    };
    grip.addEventListener("pointermove", onMove);
    grip.addEventListener("pointerup", onUp);
    grip.addEventListener("pointercancel", onUp);
  });

  // move by dragging the top bar; the sheet jumps to the new place when the mouse is released
  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button, input, select, textarea, a, .menu")) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    const start = { sx: e.screenX, sy: e.screenY };
    let dx = 0;
    let dy = 0;
    const onMove = (ev) => {
      dx = ev.screenX - start.sx;
      dy = ev.screenY - start.sy;
      if (Math.abs(dx) + Math.abs(dy) < 6) return;
      ghost.hidden = false;
      ghost.firstElementChild.style.transform = `translate(${dx}px, ${dy}px)`;
      ghost.lastElementChild.textContent = "Release to move the sheet here";
    };
    const onUp = async () => {
      bar.removeEventListener("pointermove", onMove);
      bar.removeEventListener("pointerup", onUp);
      bar.removeEventListener("pointercancel", onUp);
      ghost.hidden = true;
      if (Math.abs(dx) + Math.abs(dy) < 6) return;
      await refreshViewport();
      const cur = win();
      await moveWindow({ ...cur, r: Math.round(cur.r + dx), y: Math.round(cur.y + dy) });
    };
    bar.addEventListener("pointermove", onMove);
    bar.addEventListener("pointerup", onUp);
    bar.addEventListener("pointercancel", onUp);
  });

  // Owlbear can only place a popover when it opens it, so moving re-opens the sheet at the new
  // position. If that reloads this page, the current page and scroll position come back.
  async function moveWindow(rect) {
    await flush();
    prefs.restore = { page: app.current, top: scroller.scrollTop, left: scroller.scrollLeft, at: Date.now() };
    saveWinPrefs({ ...rect });
    await openSheet(OBR, app.itemId, rect);
    prefs.win = (store.get(PREFS_KEY, {}) || {}).win || rect;
    setTimeout(() => {
      delete prefs.restore;
      savePrefs();
    }, 4000);
  }
  app.resetWindow = async () => {
    await refreshViewport();
    wide = false;
    prefs.wide = false;
    label();
    await moveWindow(defaultWin(vw, vh, false));
  };

  // hero star
  const heroBtn = $("#herobtn");
  heroBtn.hidden = false;
  heroBtn.addEventListener("click", async () => {
    const on = !app.hero;
    setHeroButton(on);
    try {
      await setHero(OBR, app.itemId, on);
    } catch (err) {
      setHeroButton(!on);
      banner(`Could not change the hero mark: ${(err && err.message) || err}`, "error");
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || $("#dialog").open) return;
    const t = e.target;
    if (t && (t._ref || t._owner)) t.blur();
    else closeBtn.click();
  });
}

// ------------------------------------------------------------------ boot
async function bootOBR() {
  setStatus("saving", "Connecting to Owlbear…");
  let OBR;
  try {
    OBR = await loadOBR();
  } catch (err) {
    banner("Could not load the Owlbear Rodeo SDK from the internet, so this sheet can't be saved to the token. Check your connection and reopen the sheet.", "error");
    setStatus("error", "Offline");
    return false;
  }
  app.OBR = OBR;
  try {
    await whenReady(OBR);
  } catch (err) {
    banner("Owlbear Rodeo didn't answer, so this sheet can't load or save. Close the sheet and open it again.", "error");
    setStatus("error", "Not connected");
    return false;
  }
  try {
    applyTheme(await OBR.theme.getTheme());
    OBR.theme.onChange(applyTheme);
  } catch (_) {
    /* theme is optional */
  }
  app.me = await OBR.player.getId();
  bindPopoverControls();
  if (!(await OBR.scene.isReady())) setStatus("saving", "Waiting for a scene to open…");
  await whenSceneReady(OBR);
  if (!app.itemId) {
    banner("No token was given. Right-click a character token and choose “OSRIC Character Sheet”.", "error");
    setStatus("error", "No token");
    return true;
  }
  const [item] = await OBR.scene.items.getItems([app.itemId]);
  if (!item) {
    app.gone = true;
    banner("This token is not in the current scene.", "error");
    setStatus("error", "Token not found");
    return true;
  }
  setTokenName(item.name);
  setHeroButton(!!item.metadata[HERO_KEY]);
  const m = item.metadata[KEY];
  app.stamp = (m && m.stamp) || null;
  app.sheet = normalizeSheet(m);
  if (!m) {
    // first open: nothing stored yet; offer a local backup if one exists
    const b = store.get(BACKUP_PREFIX + app.itemId);
    if (b && b.sheet && sheetStats(b.sheet).fields) {
      banner("This token has no sheet data, but this browser has a backup of it. Use ⋯ → Import to restore it, or just start typing.", "info");
    }
  }
  OBR.scene.items.onChange(onItemsChange);
  setStatus("ok", m ? "Loaded from token" : "New sheet");
  return true;
}

function bootStandalone() {
  app.sheet = normalizeSheet(store.get(STANDALONE_KEY));
  banner("Preview mode: this page isn't running inside Owlbear Rodeo, so values are kept in this browser only.", "info");
  setStatus("ok", "Preview");
}

async function boot() {
  if (IN_OBR) loadOBR().catch(() => {}); // start downloading the SDK straight away
  applyTheme(null);
  bindToolbar();
  try {
    app.index = await fetchJSON("layouts/index.json");
  } catch (err) {
    banner(`Could not load the sheet layout: ${err.message}`, "error");
    return;
  }
  buildTabs();
  if (IN_OBR) await bootOBR();
  else bootStandalone();
  updateTitle();
  const restore = prefs.restore && Date.now() - prefs.restore.at < 15000 ? prefs.restore : null;
  await showPage(params.get("page") || (restore && restore.page) || prefs.page || "cs");
  if (restore) {
    scroller.scrollTop = restore.top;
    scroller.scrollLeft = restore.left;
    delete prefs.restore;
    savePrefs();
  }
  window.__sheetApp = app; // for debugging and tests
}

boot();
