<p align="center">
  <img src="public/images/b4call-api_light.png" alt="B4Call" width="440">
</p>

# B4Call

<p align="center">
  <a href="#license"><img src="https://img.shields.io/badge/license-MIT-6d5efc.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522.5-3c873a.svg" alt="Node 22.5+">
  <img src="https://img.shields.io/badge/dependencies-1-blue.svg" alt="One dependency">
  <img src="https://img.shields.io/badge/build%20step-none-orange.svg" alt="No build step">
</p>

A Postman-style API client you run yourself, with **shareable collections** — anyone
with a share link can open a collection, run its requests, comment on them, and see
each other live. No login needed.

## Run it

**Requires Node.js 22.5 or newer** — storage uses the built-in `node:sqlite`, so there
is no native module to compile. The only runtime dependency is Express.

```bash
git clone https://github.com/seeb4coding/b4call.git
cd b4call
npm install
npm start
```

Then open **http://localhost:2000**.

There is **no build step** — the browser loads `public/js/*.js` as ES modules and
the server is plain CommonJS. `npm run build` exists anyway, and does the two
things that are useful here: verify the source (syntax, that every import
resolves, that every `#id` the scripts reach for exists in the HTML) and stage a
deployable copy in `dist/`:

```bash
npm run check    # verify only
npm run build    # verify, then stage dist/
npm test         # the test suite

cd dist && npm install --omit=dev && npm start   # deploy
```
 The startup banner also prints your network
URL (e.g. `http://192.168.1.250:2000`) — open the app from that URL when you want
the share links you copy to work for teammates on the same network.

## Features

### Requests
- **Request builder** — GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS, plus **WS** and **SSE** consoles
- **Multiple tabs** — open several requests at once, like browser tabs; pin, duplicate, drag to reorder
- **Tabs per request** — Params, Headers, Body, Auth, Scripts, Capture & Tests, Docs, Activity, Settings
- **Body types** — raw JSON (line numbers, Beautify, live validation), raw text,
  x-www-form-urlencoded, form-data **with real file uploads**, and **GraphQL**
- **Auth** — Bearer, Basic, API Key, OAuth 2.0 (with token fetch), AWS SigV4, Digest, JWT
- **Pre-request & test scripts** — JavaScript with a `pm.*` sandbox
- **Per-request settings** — timeout, redirect policy, SSL verification; plus an outbound HTTP proxy
- **CORS proxy built in** — the backend forwards requests, so any API works

### Collections & organization
- **Workspaces**, **collections with nested folders**, favorites and tags
- **Add / duplicate / reorder / move-to-folder / rename / delete** requests
- **Sidebar search** and a **Ctrl+K command palette** across every request
- **Collection runner** — runs every request in order with live pass/fail results
- **Mock server** — saved examples answer real HTTP calls at `/mock/<collection>/<path>`
- **Import** — Postman v2.1, OpenAPI/Swagger, and pasted cURL. **Export** — Postman v2.1
- **Backup & restore** the whole workspace as one JSON file

### Response & debugging
- Color-coded status, time, size; pretty-printed JSON with a collapsible tree
- **JSONPath filter bar** — `$..email`, `$.items[*].id`, `$.users[?(@.age > 30 && @.active)]`,
  slices, unions, `=~` regex and `.length`, with a live match count and a syntax cheat sheet
- **Schema inference** — the **Schema** button turns any JSON response into a draft-07 **JSON Schema**
  or **TypeScript interfaces**, merging array elements so varying fields become optional
- **Response diff** — tick any two entries in History (or diff the newest against the
  current response) for a side-by-side line diff, with header differences, changed-lines-only
  mode, and optional JSON key sorting so reordering is not noise
- **Timing waterfall** — queueing, DNS, TCP, TLS, TTFB and download measured per request,
  with a per-hop table when redirects were followed
- **Image / PDF / audio / video / binary preview** — binary bodies come back as base64 and
  render inline, with a hex dump for anything unrecognised and a correct-format download
- **Built for large responses** — bodies over ~2,500 lines switch to a virtual scroller,
  and the JSON tree builds children lazily in pages of 200, so huge payloads stay responsive
- **Search inside the response**, copy, download, **HTML preview**, headers, cookies
- **Tests tab**, **per-request response history** with a response-time trend, saved **examples**
- **Code generation** — the **Code** button gives curl / fetch / axios snippets

### Sharing & collaboration
- **Share** on a collection → link like `/s/aB9xK2…`; anyone with it can view and run
  requests without logging in. Per-link **read-only** or **can edit**
- **Live presence** — everyone on a link appears as a coloured chip showing which
  request they are on, over Server-Sent Events (no extra dependency, no WebSocket server)
- **Live sync** — when a collaborator saves, everyone else's sidebar refreshes within a second
- **"X is editing the body…"** hints while someone types
- **Built-in chat** for the people on the link
- **Comments per request** — Markdown, resolve/reopen, delete (Activity tab)
- **Change history per request** — every save snapshots the previous version with an author
  and a summary of what changed; compare any version with the current one and restore it
- **Published API docs** — `/docs/<token>` renders a read-only reference from the same
  share token: grouped endpoints, parameters, auth, body samples, saved example responses,
  a cURL snippet per endpoint, a filter box, and a print/PDF stylesheet

### Variables
- **Environments** — multiple named sets (Staging, Production…), switch in the top bar
- **Scopes with precedence** — Vault > Environment > Collection > Globals
- **Local Vault** — `{{vault:name}}` secrets that never leave your browser, optionally
  encrypted with AES-256-GCM behind a master password
- **Variables sidebar** — every `{{variable}}` in the request, its value and source badge
- **Autocomplete** — type `{{` in any field; hover any variable to see its resolved value
- **Chaining** — `{{res:RequestName.body.path}}` pulls from an earlier response
- **Auto-capture** — pull values out of responses (e.g. `data.token` → `{{token}}`)

### Appearance & keyboard
- **Themes** — **B4Call Light** (the default) and B4Call Dark, both drawn from the
  logo's violet→indigo gradient and its astronaut orange, plus Modern Light,
  Solarized, Slate Dark, OLED Black, Nord, Forest and Cyberpunk. The logo has two
  artworks — a solid wordmark for light themes, an outlined one for dark — and the
  favicon follows. The saved theme is applied before the first paint, so there is
  no flash on load
- **Appearance dialog** — theme, accent colour, interface and code text size,
  comfortable/compact density, corner rounding, with a live preview
- **Keyboard-first** — `j`/`k` to walk the request list, `Enter` to open, `/` to filter,
  `t`/`x` for tabs, `s` to send, `[`/`]` to cycle tabs, and `g`-chords (`g b` → Body,
  `g v` → Activity…). Modifier shortcuts (`Ctrl+Enter`, `Ctrl+S`, `Ctrl+K`, `Ctrl+L`,
  `Alt+1…9`) always work; single-key mode can be turned off in Appearance. Press `?`
  for the full cheat sheet
- **Installable PWA** with an offline app shell

## How it's organized

```
scripts/build.js             Source verification + dist/ staging
server.js                    Express app, static hosting, /s/:token and /docs/:token
src/db.js                    SQLite connection, schema, WAL, one-time JSON import
src/store.js                 Storage gateway — every query lives here
src/request-model.js         Request/folder validation & sanitization
src/activity-log.js          Per-request comments and revision history
src/http-client.js           HTTP(S) client: timings, redirects, proxying, binary bodies
src/routes/collections.js    Collections, requests, folders, bulk updates
src/routes/share.js          Share links (public read, guarded edit)
src/routes/realtime.js       SSE rooms: presence, editing hints, chat, change events
src/routes/activity.js       Comments & revisions API
src/routes/proxy.js          CORS proxy + multipart file upload + OAuth token exchange
src/routes/mock.js           Mock server backed by saved examples
public/                      Frontend (vanilla JS modules, no build step)
  js/jsonpath.js             JSONPath engine for the response filter
  js/schema-infer.js         JSON Schema + TypeScript inference
  js/response-diff.js        LCS line diff + header diff
  js/virtual-text.js         Virtual scroller for very large bodies
  js/timing-waterfall.js     Connection timing breakdown
  js/binary-preview.js       Image / PDF / media / hex viewers
  js/realtime.js             Presence, live sync, editing hints, chat
  js/activity-panel.js       Comments and change history UI
  js/docs-page.js            The published /docs/:token reference
  js/keyboard.js             Keyboard-first navigation and chords
  js/appearance.js           Themes, type scale, density, accent
  js/themes.js               Theme catalogue, light/dark scheme, logo switching
  js/icons.js                Inline SVG icon set (no emoji anywhere in the UI)
  js/identity.js             Collaborator display name and colour
  ...
```

## Storage

B4Call keeps everything in one SQLite file, `data/b4call.sqlite`.

- **Relational where it matters** — `workspaces`, `collections`, `folders`,
  `requests`, `comments` and `revisions` are real tables with foreign keys and
  indexes. The order-sensitive row arrays a request owns (params, headers, tests,
  examples…) stay as JSON columns, because they are always read and written whole.
- **Transactional** — a bulk import or a reorder either lands completely or not at
  all, instead of leaving a half-rewritten file behind.
- **WAL mode**, so a reader never blocks the writer, and the log is checkpointed
  back into the file on shutdown.

### Upgrading from the JSON version

Nothing to do. On first start, an existing `data/db.json` is read, brought up to
the current schema (older records get the fields they were missing), written into
SQLite, and renamed to `db.json.imported` — kept, not deleted, so there is always
a way back.

Looking up a single request went from parsing the whole file to an indexed query:

| Operation | JSON file | SQLite |
| --- | --- | --- |
| Fetch one request by id | 4.18 ms | **0.05 ms** |
| Resolve a share token | 4.18 ms | **0.01 ms** |
| Load a request's comments | 4.18 ms | **0.02 ms** |
| Save one edited request | 5.51 ms (rewrites 851 KB) | **2.13 ms** |
| List every collection | 4.77 ms | 5.02 ms |

(Measured on the 427-request collection in this repo. Listing everything is a
wash — it is the same work either way; the win is in every other query, which is
what the app actually does while you use it.)

## Tests

```bash
npm test
```

48 tests cover the JSONPath engine, schema inference, the diff engine, binary
sniffing, the activity log, request sanitization, and the SQLite store
(round-trips, ordering, cascades, workspace filtering).

## Notes & next steps

- Storage is **SQLite** (`data/b4call.sqlite`), via Node's built-in `node:sqlite` —
  no native module to compile, no dependency added. Set `B4CALL_DB` to move it.
  Add accounts and go multi-user by putting a `user_id` on `collections`.
- Collaborator names are labels people choose, not logins — anyone with an edit
  link can pick any name. Treat a share link as the credential.
- Share and docs links only work for teammates who can reach your machine —
  use the network URL from the startup banner, or host the app on a server.
- Upgrading from an earlier build? Your stored settings migrate automatically on
  first load (`public/js/storage-migrate.js`).
