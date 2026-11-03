# Siege Loadout Lab — local prototype

Milestone 1: a readable loadout interface and testable data architecture for a future
Rainbow Six Siege random loadout generator. **All operators, weapons, gadgets, and
attachment compatibility are fictional test fixtures. No Siege patch is verified.**
The prototype uses local browser randomness, **not RANDOM.ORG**.

All project files live in `C:\Users\incor\Documents\Projects\Random-Generator`.
Development and execution are local on Windows 11. No cloud environment, hosted
service, external fonts, package downloads, or API credentials are required.

## Launch on Windows

1. Open PowerShell in this folder and run `node --version`.
2. If Node is unavailable in your own terminal, install Node.js 22 or newer from
   [nodejs.org](https://nodejs.org/), then reopen the terminal. A Node v24.22.1 runtime
   was available in the development session; it may not be on your normal Windows PATH.
   Node is the only required development tool. No `npm install` is needed.
3. Double-click `Start-Prototype.cmd`, or run:

   ```powershell
   cd C:\Users\incor\Documents\Projects\Random-Generator
   node scripts/serve.mjs
   ```

4. Open **http://127.0.0.1:4173** in Edge, Chrome, or Firefox. Keep the server window
   open. Press Ctrl+C in that window when finished. Opening `index.html` directly
   is not supported because the application uses JavaScript modules.

The server binds only to the local computer. If port 4173 is occupied, stop the other
instance, or run `$env:PORT = '4174'` before the server command and open that port.
Keep using the same browser profile and address to retain the selected side.

## Use

- A complete mock loadout appears automatically when the page opens.
- Select Attack or Defense, then press **Generate All**. The side is remembered in
  browser local storage. If browser storage is blocked, the app still works but
  cannot remember the side after a reload.
- Read top to bottom: operator, primary weapon and attachments, secondary weapon
  and attachments, secondary gadget. There are no extra reveal steps.
- Changing the selected side keeps the current result visible and labels its side
  until you generate again. A failure preserves the entire previous loadout and
  shows an error; press Generate All to retry. Results are retained in memory for
  the current page session, not persisted after reload.
- Operator counts are calculated from the dataset. “Not available” indicates a
  nonexistent attachment slot; “No attachment” is an actual permitted choice.

## Tests

```powershell
node --test
```

Uses Node's built-in test runner, with no additional dependencies. Tests cover
override precedence, allowed equipment, malformed data, singleton and unavailable
choices, rejection boundaries, provider failures, side persistence, concurrent
requests, and preserving the previous complete result.

## Files to review and back up in GitHub Desktop

| Path | Purpose |
| --- | --- |
| `index.html`, `styles.css` | Responsive, keyboard-accessible interface |
| `src/app.js` | Browser rendering, controls, and initial generation |
| `src/ui/controller.js` | Side persistence and atomic generation state |
| `src/data/mock-database.js` | Small fictional dataset and patch metadata |
| `src/domain/compatibility.js` | Validation, operator filtering, attachment precedence |
| `src/domain/generate-loadout.js` | Provider-independent loadout generation |
| `src/random/selection.js` | Unbiased selection from uniform 32-bit words |
| `src/random/local-provider.js` | Explicitly local prototype random source |
| `tests/*.test.js` | Generation, compatibility, and state regression tests |
| `scripts/serve.mjs`, `Start-Prototype.cmd` | Loopback server and Windows launcher |
| `package.json` | Runtime requirements and optional npm shortcuts |
| `docs/architecture.md` | Data contracts and future RANDOM.ORG integration plan |
| `README.md`, `.gitignore` | Setup instructions and local-file exclusions |

Open this existing repository in GitHub Desktop and review the Changes tab. Commit
and push using your preferred repository. No automated commit or push is performed.

## Scope

This milestone is a browser-based local prototype, not a packaged Windows executable.
Real operator data, verified patch compatibility, RANDOM.ORG integration, credentials,
and remote random-data caching belong to later milestones. See
[the architecture notes](docs/architecture.md) before adding data or providers.
