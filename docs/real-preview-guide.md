# Real-data generation preview (milestone 3D)

## Launch and test on Windows

1. Stop the previous generator server with Ctrl+C, then double-click
   **Start-Prototype.cmd**. Open **http://127.0.0.1:4173** and refresh the page.
   Your existing Node.js setup and server-side RANDOM.ORG key configuration apply;
   no additional installation is needed. Never put the key in the browser or Git.
2. The page starts in **Fictional mock**. Opening it does not generate a loadout
   or fetch random bits. The new Dataset menu is in the existing notice strip.
3. Choose **Real-data preview**. Check the active dataset ID, target patch, Ready
   status, and eligible count. At milestone 3D the reviewed files report
   `siege-y11s3-3-001`, patch `Y11S3.3`, one eligible attacker and one defender.
   These values are calculated from the files, not hardcoded in the application.
4. Select **Attack → Generate All** to test Sledge. Select **Defense → Generate All**
   to test Smoke. Equipment and attachment names come from the selected database.
   Repeated generation uses the existing RANDOM.ORG bit buffer. No pseudorandom
   fallback has been added.
5. Switch sides or datasets after a successful result. The previous loadout stays
   visible with its original dataset/side label until another generation succeeds.
   Choose Fictional mock and Generate All to return to the original test equipment.

For the currently recorded equipment, check Sledge's Reaper MK2 when it appears:
optic and grip should read **Not available**; its barrel list excludes Extended
Barrel; its underbarrel follows the machine-pistol default. Smoke's SMG-11 uses
the machine-pistol defaults in all four slots. These checks reflect your recorded
verification, not newly researched or invented game compatibility.

The footer's randomness label describes the displayed result. Switching modes does
not change that result's provenance. Its operator card keeps the original dataset
revision and patch even if newer data is loaded later.

## Drafts and ineligible data

The generator never changes readiness or verification. If the real dataset is Draft,
the notice explains why generation is blocked. Only after intentionally reviewing
it, open **Start-Editor.cmd**, select **Dataset**, change **Dataset readiness** to
Ready, and Save changes. Selecting Real-data preview does not mark it Ready.
Your current files were already Ready; milestone 3D does not modify them.

Missing references, duplicate IDs, invalid overrides and other structural errors
block the entire real dataset. Incomplete or unverified operators, stale fingerprints,
and mismatched patch checks remain excluded by the existing validator. If a side
has no eligible operators, generation fails before consuming even buffered bits.
No failure overwrites the previous successful loadout or switches silently to mock.

Unknown category defaults can remain warnings when complete weapon exceptions resolve
them, as allowed by the existing schema. A warning is not automatically a structural
error. Use **Validate-Database.cmd** or the editor's Database checks for full details.

Real files are loaded and validated on every real Generate All request, and when
dataset information is refreshed. After saving an editor change, switch the Dataset
menu away and back or refresh the page to update the displayed counts. A generator
restart is unnecessary for data edits. Even before refreshing the count display,
generation checks the current files. Avoid editing files during an active request:
an in-flight generation uses the complete snapshot it already validated.

An unfinished editor transaction blocks preview loading until its save or recovery
finishes. The generator does not write, recover, approve, or repair the database.

## Security and validation

The local server accepts only `mock` or `real` mode names, never filesystem paths.
The metadata endpoint returns dataset labels, readiness, counts and useful errors.
Generation returns the selected IDs and display names; full catalogs, reviewer names,
verification evidence, fingerprints, `.env`, and server source files are not served.
The existing loopback binding, Host/Origin checks and API key protections remain.

Run `node --test` from PowerShell in this project. The new preview tests cover the
checked-in Sledge/Smoke records, shared weapons, Reaper MK2 exceptions, SMG-11
inheritance, fictional operator-specific exceptions, dataset switching, current-file
revalidation, zero-bit validation failures, result preservation, and HTTP boundaries.
They use synthetic random streams, not a live key. They never edit real records or
refresh real verification fingerprints. The equipment regression assertions intentionally
track these reviewed records; review them alongside intentional future data updates.

Milestone 3D development browser checks used a temporary server with no API key and
outgoing requests disabled. Successful generation was exercised by automated tests;
the Windows steps above are the live RANDOM.ORG acceptance test.

## GitHub Desktop review

- Added `server/datasets.js`, `tests/real-preview.test.js`, and this guide.
- Updated `server/loadout-service.js` and `server/http-server.js` for mode selection,
  metadata, validated real loading, and result-specific display names.
- Updated `src/ui/controller.js`, `src/ui/remote-generator.js`, `src/app.js`,
  `index.html`, and a few selector styles in `styles.css`.
- Updated the obsolete empty-real-workspace test to use an explicit empty fixture,
  and updated README/database/editor/architecture documentation.

No equipment files, verification records, RANDOM.ORG transport/buffer/selection
modules, launch scripts, dependencies or key configuration were changed. No commit
or push is performed automatically.
