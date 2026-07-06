# Translation review checklist — Shona (sn) & Ndebele (nd)

The multi-language UI (English / Shona / Ndebele) is implemented in
[`i18n.js`](./i18n.js). All Shona and Ndebele strings there are **first-pass
drafts by the developer/AI and MUST be reviewed by native speakers (ZINGSA)
before production release.** Nothing in this layer changes database values — it
is display-only. Crop keys, enum values, etc. are still stored in English.

## How it works
- One dictionary in `i18n.js`: each key maps to `{ en, sn, nd }` (side-by-side
  so a reviewer can read all three at once).
- HTML elements carry `data-i18n="key"` (text), `data-i18n-ph` (placeholder),
  `data-i18n-title`, `data-i18n-html` (rich text), `data-i18n-prefix` (a
  language-neutral emoji/star kept in front of the translation, e.g. `⭐⭐⭐`).
- A language `<select>` (English / Shona / Ndebele) appears **before login** on
  both `signin.html` and the `GeoCrop.html` login gate, and in the app header.
- Choice is saved to `localStorage['gc_lang']` and applied on every page load,
  so it persists across sessions and the whole app follows it.
- Dynamic lists (entries, validation, legend) re-render on the `gc:langchange`
  event via `window.gcCrop()` / `window.gcEnum()`.

## Priority items for a native reviewer (highest risk)
These are agronomy/technical terms most likely to be wrong in the draft:

| Key group        | Why to double-check |
|------------------|---------------------|
| `crop.*`         | Local crop names vary by region/dialect. Confirm each Shona & Ndebele name. Known-uncertain: `groundnut`, `roundnut` vs `bambaranuts` (both drafted as Nyimo/Indlubu — clarify the distinction), `sesame`, `pigeon_pea`, `chick_pea`, `macademia`, `paprika`, `tsenza`. |
| `growth.*`       | Crop growth-stage vocabulary (emergence, senescence, reproductive) — confirm standard extension-service terms. |
| `cond.*`         | "Wilting", "leached/waterlogged" — technical field-condition terms. |
| `sector.*`       | LSCFA/A2/A1/SSCFA/CA are Zimbabwe land-tenure codes — kept as codes on purpose; only `peri_urban`/`other` are translated. Confirm that's desired. |
| `season.*`, `irr.*` | Main/secondary/irrigated season and rainfed/irrigated — confirm. |

## To confirm a term
Edit the `sn:` / `nd:` value for the key in `i18n.js`. Any entry whose `sn`/`nd`
still equals the English text is an explicit placeholder awaiting a term.

## Adding a new language later
Add the code to `LANGS`/`LANG_LABELS` in `i18n.js` and a fourth value to each
dictionary row. The selector and engine pick it up automatically.

## Coverage status
- ✅ Login/sign-in screens (both surfaces), pre-login selector
- ✅ Header, sidebar tabs, connectivity + panel toggles
- ✅ Collect form: all labels, sector/season/growth/condition/irrigation menus, all 34 crop names
- ✅ Validate form: status/confidence menus, stats
- ✅ Entries list (crop + enum chips), filter dropdown
- ✅ Upload & Sent panels: card titles, buttons, section labels
- ⏳ Not yet localized (English-only, low priority): toast/notification messages
  (`toast(...)` calls) and `confirm()`/`alert()` dialogs. These use plain strings
  today; migrate by wrapping in `window.t('key','English default')` and adding keys.

## Build note
After changing web source, the mobile app needs `npm run cap:copy:android`
(from `frontend/`) then an APK rebuild. The web build serves `frontend/app/` directly.
