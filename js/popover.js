// Toolbar popover: lists the character tokens in the scene and opens their sheets.
import {
  KEY, HERO_KEY, LABEL_KEY, loadOBR, whenReady, whenSceneReady, openSheet, setHero, setLabel, displayName, applyTheme,
  characterName, sheetStats, sheetSummary, esc, inOwlbear, extUrl,
} from "./common.js?v=1.4.0";

const $ = (id) => document.getElementById(id);

const isHero = (item) => !!(item.metadata && item.metadata[HERO_KEY]);
const hasSheet = (item) => !!(item.metadata && item.metadata[KEY]);
const labelOf = (item) => (item.metadata && typeof item.metadata[LABEL_KEY] === "string" ? item.metadata[LABEL_KEY] : "");

// Latest scene state. While a name is being edited the list is not rebuilt (tokens moving on the map
// would otherwise throw the text box away); it is rebuilt when the edit ends.
const state = { OBR: null, items: [], selection: [], editing: false };

function rerender() {
  if (!state.editing) render(state.OBR, state.items, state.selection);
}

function row(OBR, item) {
  const li = document.createElement("li");
  const sheet = item.metadata[KEY];
  const name = displayName(item);
  let sub = "no sheet yet";
  if (sheet) {
    const charName = characterName(sheet, "");
    const summary = sheetSummary(sheet);
    sub = [charName && charName !== name ? charName : "", summary || (({ fields }) => `${fields} field${fields === 1 ? "" : "s"} filled`)(sheetStats(sheet))].filter(Boolean).join(" · ");
  }
  const star = document.createElement("button");
  star.type = "button";
  star.className = "star" + (isHero(item) ? " on" : "");
  star.textContent = isHero(item) ? "★" : "☆";
  star.title = isHero(item) ? "Remove from Heroes" : "Add to Heroes";
  star.setAttribute("aria-label", star.title);
  star.addEventListener("click", async () => {
    star.disabled = true;
    try {
      await setHero(OBR, item.id, !isHero(item));
    } catch (err) {
      star.title = `Could not change it: ${(err && err.message) || err}`;
    }
    star.disabled = false;
  });
  li.appendChild(star);
  const txt = document.createElement("div");
  txt.className = "txt";
  txt.innerHTML = `<span class="name">${esc(name)}</span><span class="sub">${esc(sub)}</span>`;
  const nameEl = txt.firstChild;
  if (labelOf(item) && item.name && item.name !== name) nameEl.title = `Token: ${item.name}`;
  li.appendChild(txt);
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "edit";
  edit.textContent = "✎";
  edit.title = "Rename (changes only the name shown here, not the token)";
  edit.setAttribute("aria-label", "Rename");
  edit.addEventListener("click", () => startRename(OBR, item, nameEl));
  nameEl.addEventListener("dblclick", () => startRename(OBR, item, nameEl));
  li.appendChild(edit);
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = sheet ? "Open" : "Create";
  b.addEventListener("click", () => openSheet(OBR, item.id));
  li.appendChild(b);
  return li;
}

/** Edit the shown name in place. Enter or clicking away saves, Esc cancels, an empty name goes back to the token's name. */
function startRename(OBR, item, nameEl) {
  if (state.editing || !nameEl.isConnected) return; // e.g. the list was rebuilt by the click that ended another edit
  state.editing = true;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "rename";
  input.value = displayName(item, "");
  input.placeholder = item.name || "Name";
  input.maxLength = 80;
  input.spellcheck = false;
  input.setAttribute("aria-label", "Name shown in this list");
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const typed = input.value.trim();
    const label = typed && typed !== (item.name || "") ? typed : "";
    if (save && label !== labelOf(item)) {
      input.disabled = true;
      try {
        await setLabel(OBR, item.id, label);
        // show the new name straight away, before Owlbear reports the change
        state.items = state.items.map((i) => {
          if (i.id !== item.id) return i;
          const metadata = { ...i.metadata };
          if (label) metadata[LABEL_KEY] = label;
          else delete metadata[LABEL_KEY];
          return { ...i, metadata };
        });
      } catch (err) {
        nameEl.title = `Could not rename it: ${(err && err.message) || err}`;
      }
    }
    state.editing = false;
    if (input.isConnected) input.replaceWith(nameEl);
    rerender();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      finish(false);
    }
  });
  input.addEventListener("blur", () => finish(true));
}

function fill(list, items, OBR, emptyHtml) {
  list.innerHTML = "";
  if (!items.length && emptyHtml) list.innerHTML = `<li class="empty">${emptyHtml}</li>`;
  for (const item of items) list.appendChild(row(OBR, item));
}

function render(OBR, items, selection) {
  const byName = (a, b) => displayName(a).localeCompare(displayName(b));
  const chars = items.filter((i) => i.layer === "CHARACTER" || i.layer === "MOUNT").sort(byName);
  const heroes = chars.filter(isHero);
  const others = chars.filter((i) => !isHero(i) && hasSheet(i));
  const without = chars.filter((i) => !isHero(i) && !hasSheet(i));

  fill($("heroes"), heroes, OBR, "Click ☆ next to a token to add your player characters here.");
  fill($("withSheet"), others, OBR, heroes.length || without.length ? "None." : "No sheets yet. Open one from a token's right-click menu, or create one below.");
  fill($("withoutSheet"), without, OBR, "");
  $("otherCount").textContent = String(without.length);
  $("othersBox").hidden = !without.length;

  const sel = $("selected");
  sel.innerHTML = "";
  if (selection && selection.length === 1) {
    const item = items.find((i) => i.id === selection[0]);
    if (item) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "primary";
      b.textContent = `${hasSheet(item) ? "Open" : "Create"} sheet for selected: ${displayName(item, "token")}`;
      b.addEventListener("click", () => openSheet(OBR, item.id));
      sel.appendChild(b);
    }
  }
}

async function main() {
  if (!inOwlbear()) {
    applyTheme(null);
    $("heroes").innerHTML = `<li class="empty">This page runs inside Owlbear Rodeo. To try the sheet outside Owlbear, open <a href="${esc(extUrl("sheet.html"))}" target="_blank">the preview</a>.</li>`;
    $("othersBox").hidden = true;
    return;
  }
  let OBR;
  try {
    OBR = await loadOBR();
  } catch (_) {
    $("heroes").innerHTML = `<li class="empty">Could not load the Owlbear Rodeo SDK. Check your internet connection.</li>`;
    return;
  }
  try {
    await whenReady(OBR);
  } catch (_) {
    $("heroes").innerHTML = `<li class="empty">Owlbear Rodeo didn't answer. Close this panel and open it again.</li>`;
    return;
  }
  try {
    applyTheme(await OBR.theme.getTheme());
    OBR.theme.onChange(applyTheme);
  } catch (_) {
    /* optional */
  }
  const sceneReady = await OBR.scene.isReady();
  if (!sceneReady) $("heroes").innerHTML = `<li class="empty">Open a scene to see its tokens.</li>`;
  await whenSceneReady(OBR);
  state.OBR = OBR;
  state.items = await OBR.scene.items.getItems();
  state.selection = await OBR.player.getSelection();
  rerender();
  OBR.scene.items.onChange((next) => {
    state.items = next;
    rerender();
  });
  OBR.player.onChange((player) => {
    state.selection = player.selection;
    rerender();
  });
  $("foot").textContent = "✎ renames an entry in this list. Sheets are saved on the tokens, so they belong to this scene. To move one, use Export and Import in the sheet's ⋯ menu.";
}

main();
