// Toolbar popover: lists the character tokens in the scene and opens their sheets.
import {
  KEY, HERO_KEY, loadOBR, whenReady, whenSceneReady, openSheet, setHero, applyTheme, characterName, sheetStats,
  sheetSummary, esc, inOwlbear, extUrl,
} from "./common.js?v=1.2.0";

const $ = (id) => document.getElementById(id);

const isHero = (item) => !!(item.metadata && item.metadata[HERO_KEY]);
const hasSheet = (item) => !!(item.metadata && item.metadata[KEY]);

function row(OBR, item) {
  const li = document.createElement("li");
  const sheet = item.metadata[KEY];
  const name = item.name || "Unnamed token";
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
  li.appendChild(txt);
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = sheet ? "Open" : "Create";
  b.addEventListener("click", () => openSheet(OBR, item.id));
  li.appendChild(b);
  return li;
}

function fill(list, items, OBR, emptyHtml) {
  list.innerHTML = "";
  if (!items.length && emptyHtml) list.innerHTML = `<li class="empty">${emptyHtml}</li>`;
  for (const item of items) list.appendChild(row(OBR, item));
}

function render(OBR, items, selection) {
  const byName = (a, b) => (a.name || "").localeCompare(b.name || "");
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
      b.textContent = `${hasSheet(item) ? "Open" : "Create"} sheet for selected: ${item.name || "token"}`;
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
  let items = await OBR.scene.items.getItems();
  let selection = await OBR.player.getSelection();
  render(OBR, items, selection);
  OBR.scene.items.onChange((next) => {
    items = next;
    render(OBR, items, selection);
  });
  OBR.player.onChange(async (player) => {
    selection = player.selection;
    render(OBR, items, selection);
  });
  $("foot").textContent = "Sheets are saved on the tokens, so they belong to this scene. To move one, use Export and Import in the sheet's ⋯ menu.";
}

main();
