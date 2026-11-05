# OSRIC Character Sheet for Owlbear Rodeo

An Owlbear Rodeo extension that shows an editable character sheet for a character token. It has the same pages,
fields, colours and layout as the **1st Edition / OSRIC Automated Charactersheet v2.2 by FlacoAlto**
(<https://flacoalto.itch.io/1st-edition-osric-automated-charactersheet>), but no dropdowns and only one kind of
formula: every field is typed in by hand, except the weights of carried items, which are added up for you.

Pages: Character Sheet, Cleric, Druid, Fighter, Ranger, Paladin, MU, Ill, Thief, Assassin, Monk, Animals, License.
Left out: the spreadsheet's Instructions, Character Options/Assumptions, Bard, 2-Weapon, Weaponless, Hirelings, Tables
and OSRIC Tables tabs. **Animals** (animals of burden) is not in the spreadsheet: it is built from the Character
Sheet's item lists, with a Name and an Enc. Total for each of three animals and two lists each, without the money.

Changes from the spreadsheet's look: a neutral blue-grey colour scheme; the right half of the Character Sheet
(movement, money, carried items) and the Known Spells list of MU and Ill are placed under the rest of their page; the
class pages are 10 % narrower than in the spreadsheet (text that no longer fits a cell is shrunk slightly), so they fit a
half-width sheet; the two grey *container* captions are fields, so you can name those containers; each Total Weight
has a *manual* field next to it; the note under the item lists gives the units (lb, 10 coins = 1 lb).

## 1. Put the files online

Owlbear Rodeo loads extensions from a web address, so this folder has to be hosted somewhere. All of these are free.

**GitHub Pages (simplest)**
1. Create a GitHub account and a new **public** repository named exactly `<your-username>.github.io`.
2. On the repository page choose **Add file → Upload files** and drag in everything inside this folder
   (`manifest.json`, `index.html`, `sheet.html`, and the `css`, `js`, `fonts`, `layouts` folders, etc.). Commit.
3. In **Settings → Pages**, set *Source* to *Deploy from a branch*, branch `main`, folder `/ (root)`. Save.
4. After a minute or two, open `https://<your-username>.github.io/`. The page shows the install link and checks the setup.

If you use a repository with any other name, the site lives in a sub-folder (`https://<user>.github.io/<repo>/`).
That works too, but `manifest.json` must then point into that folder: open the site's front page and it will show
you the exact `manifest.json` to upload instead.

**Netlify**: sign in first, then drag this folder (or its zip) onto <https://app.netlify.com/drop>. New Netlify
projects can start out private, so click **Make public** on the project page (or *Project configuration → General →
Visitor access → Project visibility → Public*); otherwise Owlbear can't read the manifest. The `_headers` file
already sends the CORS header Owlbear needs. Cloudflare Pages reads the same `_headers` file; Vercel uses `vercel.json`.

## 2. Add it to Owlbear Rodeo

1. In your Owlbear Rodeo profile click **Add Extension** and paste the install link, e.g.
   `https://<your-username>.github.io/manifest.json`.
2. Turn it on for a room: pick it when creating a room, or open an existing room and add it from the extension menu.

## 3. Use it

- **Right-click a character token → OSRIC Character Sheet.** The sheet opens on the right, half the screen wide,
  and stays open while you use the map.
  - **Move it** by dragging its top bar; it jumps to the new place when you let go.
  - **Resize it** by dragging its bottom-left corner. **▣ Full / ◨ Half** switches between the full and half width.
    *⋯ → Reset size & position* puts it back. Size and position are remembered in your browser.
  - **✕** or *Esc* closes it.
- **Heroes:** click **☆** next to the sheet's name (or next to a token in the extension's panel) to mark that token as a
  player character. The extension's button (top left in the room) lists Heroes first, then the other sheets in the
  scene and the tokens that don't have one yet.
- Click a field and type. Coloured cells, white boxes and every former formula or dropdown are plain fields.
  Click any empty spot to write there, as in the spreadsheet.
- **Weights** (Character Sheet and Animals) are calculated, in pounds:
  - **tW = # × Man**, or **# × Auto** when Man is empty. Auto is not looked up; type it in like Man. An empty # counts
    as 1; numbers can be written as 2, 0.5, 0,5, 1/2, 1½, 1,000, 1 000 or "5 lb", and a dash (—) counts as 0.
  - **Total Weight** is the sum of the tW column. To write a list's weight yourself, type it into the *manual* field
    next to it; that is used instead (the calculated one is then struck out).
  - **Enc. Total** = the four Total Weights + the coins *on person* (pp, gp, ep, sp, cp; 10 coins = 1 lb, as in
    OSRIC 3). Coins *stored away* don't count. On the Animals page it is the animal's two lists.
  - The numbers update as you type and when someone else changes the sheet. Clicking a calculated cell
    recalculates the page (it flashes), and so does switching pages or coming back to the sheet window.
- **Renaming:** click **✎** next to an entry in the extension's panel (or double-click its name) to change the name shown
  there, e.g. "Andrii's Char" → "Andrii – Brother Hal". Enter saves, Esc cancels, an empty name goes back to the token's
  name. The token itself keeps its name; the sheet's title uses the new name until the character has a name.
- A small red corner means the cell has a note from the spreadsheet: hover to read it.
- The **+ / −** buttons on the top and left edges show or hide grouped columns and rows, like in the
  spreadsheet (HP by level, Psionics).
- **Pages** hides the tabs a character doesn't use (e.g. the other classes). This is saved with the sheet.
- **Zoom**: −/+ or click the percentage to switch between *Fit* and 100 %. *Fit* uses one scale for all pages (the
  one that fits the Character Sheet, at most 120 %).
- **⋯ → Export / Import** saves the sheet as a JSON file or loads one. Use it to back up a sheet or move it to a token
  in another scene or room.
- **⋯ → Import → .xlsx** reads a filled-in copy of the v2.2 spreadsheet (Google Sheets: *File → Download →
  Microsoft Excel*) and puts its values, including formula results, into the same fields.

### Where the data lives

Each sheet is stored in its token's metadata (key `osric-character-sheet/sheet`; the Heroes mark and the name from ✎ are
`osric-character-sheet/hero` and `osric-character-sheet/label`), so everyone in the room sees the same sheet and edits
appear live for everyone. Calculated weights are not stored; every browser works them out from the values. Tokens belong to a scene, so a sheet is tied to that token in that scene.
If the GM restricts editing of tokens, players can't save changes to tokens they aren't allowed to edit; the sheet
then shows a warning. Each browser also keeps a local backup copy of every sheet it opened.

Opening `sheet.html` directly (outside Owlbear) gives a preview that saves only in that browser.

## Files

| Path | What it is |
| --- | --- |
| `manifest.json` | Extension manifest Owlbear reads |
| `background.html`, `js/background.js` | Adds the token right-click entry |
| `popover.html`, `js/popover.js`, `css/popover.css` | The toolbar list of sheets |
| `sheet.html`, `js/sheet.js`, `css/sheet.css` | The sheet itself |
| `js/common.js` | Shared helpers; loads the Owlbear SDK (`@owlbear-rodeo/sdk` 3.1.0, MIT) from esm.sh or jsDelivr |
| `js/xlsx-import.js` | Reads .xlsx files for the import |
| `layouts/*.json` | Page layouts generated from the template |
| `fonts/` | TeX Gyre Heros Condensed, used when Aptos Narrow isn't installed (GUST Font License) |
| `tools/gen.py` | Regenerates `layouts/` from the template: `python3 tools/gen.py template.xlsx .` (needs openpyxl) |
| `index.html` | Front page with the install link and a setup check |
| `_headers`, `netlify.toml`, `vercel.json`, `.nojekyll` | Hosting settings |

## Credits

The layout, labels and notes come from FlacoAlto's character sheet template. The License tab reproduces that
workbook's notices: OSRIC and Mythmere Games are trademarks of Mythmere Games LLC; this work is not affiliated with or
endorsed by Mythmere Games LLC; material from the SRD 5.1 is used under CC BY 4.0, and OSRIC content under the AELF
Open License 1.0a.
