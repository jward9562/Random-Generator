# Siege Loadout Lab — local prototype

Milestone 3B adds a separate local graphical database editor. Double-click
**Start-Editor.cmd** and open **http://127.0.0.1:4174**. To learn with fictional
examples, use **Start-Editor-Practice.cmd** at **http://127.0.0.1:4175** instead.
No new dependencies are needed. Read [the editor guide](docs/editor-guide.md)
for the walkthrough, verification protection, saving, and recovery instructions.

The running app
still uses the original mock dataset and the same RANDOM.ORG workflow and design.
Start with [the database editing guide](docs/database-guide.md). Double-click
`Validate-Database.cmd` to check the empty real-data workspace without making API calls.
Fictional worked examples live in `database/example/`; drafts belong in `database/real/`.

Milestone 3B files to review in GitHub Desktop: the two editor launch scripts,
`scripts/edit-database.mjs`, `editor/`, `server/editor-store.js`,
`server/editor-http.js`, `src/domain/verification.js`, and `tests/editor.test.js`.
Updates also cover the v2 validator/tests, fictional example fingerprints, `.gitignore`,
the guides, and one pure-module asset entry in `server/http-server.js`.
No real equipment was invented or activated. `database/real/` remains unchanged.

Milestone 2 integrates RANDOM.ORG with the existing interface. **Operators, weapons,
gadgets, and compatibility remain fictional test fixtures; no Siege patch is verified.**
Loadout selections now use RANDOM.ORG bits obtained by the local Node server. There
is no local/pseudorandom fallback. The page waits for **Generate All**.

All project files remain in `C:\Users\incor\Documents\Projects\Random-Generator`.
No Codex Cloud environment is used. The only external application request is the
server's HTTPS call to RANDOM.ORG when the bit buffer needs replenishing.

## Obtain and configure your key on Windows 11

1. Visit the [RANDOM.ORG API Dashboard](https://api.random.org/dashboard), sign up or
   log in, and create an API key for this application. Choose an appropriate license
   and review its allowance in the dashboard. Make sure the key is running. See
   [official key guidance](https://api.random.org/api-keys).
2. In this folder, copy `.env.example` to a new file named `.env`. Do not overwrite an
   existing `.env`. In File Explorer, enable **View > Show > File name extensions**
   so the filename does not accidentally become `.env.txt`.
3. Open `.env` in Notepad and place your key after `RANDOM_ORG_API_KEY=`. Save it.
   **Do not put the key in `.env.example`, a source file, a screenshot, or this chat.**
4. Start or restart the server. Configuration is read once at startup.

`.env` is already ignored by Git and is not served to browsers. Verify that it does
not appear in GitHub Desktop's Changes tab. It is a local plaintext secret: keep
it private and out of shared folders or repository backups. A GitHub restore will
need a new local `.env` setup. Never use force-add on this file.

An existing `RANDOM_ORG_API_KEY` environment variable takes precedence over `.env`.
You can alternatively set a user environment variable through Windows' **Edit
 environment variables for your account** dialog, then open a new terminal/launcher.
Avoid typing a real key into a PowerShell command, where it may enter command history.
The browser has no key entry field and never receives the key.

## Launch

Node.js 22 or newer is required. Run `node --version` in PowerShell to check. If
unavailable, install Node.js from [nodejs.org](https://nodejs.org/) and reopen your
terminal. There are **no new dependencies and no `npm install` step**.

Double-click **Start-Prototype.cmd**, then open **http://127.0.0.1:4173**. Or run:

```powershell
cd C:\Users\incor\Documents\Projects\Random-Generator
node scripts/serve.mjs
```

Keep the server window open; Ctrl+C stops it. Use the same browser profile and
address to retain your side preference. Do not open `index.html` directly. If port
4173 is occupied, stop the other instance or set `$env:PORT = '4174'` in PowerShell
before running the server and use that port in the browser. Run one server instance
for this API key so its quota and delay tracking are shared by all your tabs.

Opening/reloading the page, choosing a side, and starting the server **do not call
RANDOM.ORG**. Pressing Generate All can use your API allowance when a refill is needed.

## Simple Windows acceptance test

1. Open the app. There should be no loadout yet; the footer says
   **RANDOM.ORG · not used yet**. Reload once to confirm no automatic generation.
2. Choose Attack or Defense and press **Generate All**. With a valid key and an
   internet connection, a full fictional loadout appears. Its footer says
   **Displayed loadout: RANDOM.ORG true randomness**.
3. Generate several more loadouts. The server reuses unused bits from the same
   8,192-bit block; it does not fetch one block per click. Your RANDOM.ORG dashboard
   can show usage. Exact loadouts per block vary because rejected bit patterns are
   discarded; no extra usage-check API requests are made by the app.
4. Switch sides. The old result stays visible with its original side until you
   generate again. Reload to verify that the side is remembered and the result is
   cleared until the next Generate All.
5. To check previous-result preservation without spending quota, leave a result on
   screen, stop the server with Ctrl+C, and press Generate All. An understandable
   connection error should appear and the old result should remain.
6. Restart the server and generate to retry. Restarting discards unused in-memory
   bits, so the next successful generation will need a fresh block.

For a no-key setup check, start without a configured key and press Generate All:
the app should explain how to configure `.env` without contacting RANDOM.ORG.
If you lose internet while unused bits remain, generation can continue from that
buffer. Once it cannot finish, it fails without changing the previous result.
Failure, quota, and refill behavior can be tested offline with the automated suite;
you do not need to exhaust your real allowance to test them.

## Automated tests

```powershell
node --test
```

All RANDOM.ORG responses are injected fixtures, never live calls. Tests do not read
your real `.env`. HTTP integration tests connect only to temporary loopback servers.
Coverage includes unbiased range selection, singleton choices, compatibility,
sequential bit consumption, exhaustion/refills, failures without bit reuse,
advisory and retry delays, quota handling, key privacy, side persistence, and
preserving results after failed generation. No browser or extra test package is needed.

## Behavior and limitations

- The layout, colors, typography, and fictional database are unchanged.
- Equipment order remains operator, primary and attachments, secondary and
  attachments, then secondary gadget. Unavailable slots and no-attachment choices
  remain distinct; counts come from the database.
- The source label describes the **displayed result**, even after a later failed
  attempt. It does not claim the service is currently reachable.
- Refills honor advisory delays and HTTP Retry-After. Network errors back off from
  5 to 60 seconds. There are no automatic retries; wait as instructed and click again.
- Cached bits can be used during a delay or quota exhaustion. Daily quota information
  is reconsidered after UTC midnight. Check the API dashboard for your actual allowance.
- The Basic API is used over HTTPS. This is a source indicator, not a cryptographic
  certificate from the Signed API.
- Bits, quotas, and delay state are in memory for one server session. Reloading a
  browser preserves the server buffer; restarting the server discards it. Requests
  are not replayed after timeouts, and consumed bits are never rolled back.
- Results remain in browser memory only. Real Siege data and a packaged executable
  remain outside this milestone.

## Changed files for GitHub Desktop backup

| File(s) | Change |
| --- | --- |
| `.env.example` | Blank, safe configuration template; `.env` remains ignored |
| `server/config.js`, `server/errors.js` | Server-only key loading and safe public errors |
| `server/random-org-client.js` | Basic JSON-RPC generateBlobs transport, validation, delays, quotas |
| `server/bit-buffer.js` | Sequential in-memory bit consumption and on-demand refills |
| `server/loadout-service.js`, `server/http-server.js` | Server-side generation, provenance, protected local routes |
| `scripts/serve.mjs` | Starts the integrated loopback server |
| `src/random/selection.js` | Bit-efficient unbiased rejection sampling |
| `src/random/local-provider.js` | Removed; no pseudorandom fallback |
| `src/ui/remote-generator.js` | Browser request to the local server |
| `src/ui/controller.js`, `src/app.js`, `index.html` | Explicit generation and source indicator; preserved result behavior |
| `tests/*.test.js` | Expanded deterministic tests, including local HTTP integration |
| `package.json` | Milestone version 0.2.0; still no dependencies |
| `README.md`, `docs/architecture.md` | Setup, acceptance tests, and implementation contracts |

`styles.css`, `Start-Prototype.cmd`, `.gitignore`, the compatibility rules, and the
fictional dataset are unchanged. Review the Changes tab in GitHub Desktop, commit,
and push when ready. No commit or push is performed automatically. Exclude `.env`
from any manual backup you intend to share. `.local/` contains ignored QA artifacts.

See [architecture details](docs/architecture.md) for the data and provider contracts.
