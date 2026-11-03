# Local equipment editor (milestone 3B)

## Launch on Windows 11

Double-click **Start-Editor.cmd**, then open **http://127.0.0.1:4174**. Keep its
terminal window open. Ctrl+C stops it. It uses your existing Node.js 22+ installation;
there are no new packages to install. The equivalent command is:

```powershell
node scripts/edit-database.mjs
```

The original `Start-Prototype.cmd` and generator remain unchanged on port 4173.
The editor binds to 127.0.0.1, reads no `.env`, and never imports or calls RANDOM.ORG.
Only one real editor process can run at a time; multiple browser tabs are supported,
but a stale tab must reload before saving over newer changes.

## Practice first, without changing real data

Double-click **Start-Editor-Practice.cmd**, then open **http://127.0.0.1:4175**.
Each launch creates a fresh copy of the fictional examples under `.local/`.
It uses the same forms, validator, and saving code, with a separate workspace.
Its footer identifies the practice copy. The real database is never changed by this mode.
Practice copies remain in `.local/` for inspection and are ignored by Git.

Try this fictional operator:

1. In **Operators**, choose **+ New** and enter **Fictional Scout**. A stable ID is
   suggested automatically; choose Attack or Defense.
2. Under Primary weapons, uncheck **Not entered yet**, then check **Fictional shared
   rifle**. Do the same for **Fictional sidearm** under Secondary weapons and
   **Fictional smoke device** under Secondary gadgets.
3. In the shared rifle's operator-specific choices, change Optic to **Choose specific
   attachments**, then uncheck **Fictional magnified sight**. The inherited list
   remains visible, while Effective shows the operator's resulting list.
4. Change Underbarrel to **Unavailable slot** if that is the fictional restriction
   you want to demonstrate. This is distinct from checking **No attachment**.
5. Choose **Save changes**. The operator reads **Complete · unverified**. Reload files
   and select it again to confirm the entry was saved.

These steps were browser-tested on a disposable fictional workspace. They are not
claims about any real operator. Do not copy fictional names or verification into
the real workspace. In practice mode only, the manual-verification form can be
tested with clearly labeled simulated evidence. Real verification requires an actual
in-game check.

## Entering real observations

Use the real editor for information you check yourself. Start with **Dataset**:
enter your target patch and a revision name, keeping readiness set to Draft while
collecting data. Ready does not activate this database in the generator.

Use these sections in order when starting with empty catalogs:

1. **Attachments:** add the actual observed names and types. Use **Add the “No
   attachment” choice** for the reserved `none` identity. It does not automatically
   become available on every weapon.
2. **Categories:** enter known defaults. Leave unresearched slots Unknown rather
   than treating them as unavailable.
3. **Weapons:** add a shared weapon, category, and primary/secondary slot. Review
   all four attachment controls, inheriting only where appropriate.
4. **Gadgets:** add the observed secondary gadget identities.
5. **Operators:** assign weapons and gadgets using checkboxes, then review each
   weapon's operator-specific attachment choices.

No JSON typing is required for ordinary entry. IDs identify shared records and are
locked after saving so references cannot be accidentally renamed. The first version
supports creating and editing, not deleting records or renaming saved IDs. To abandon
an unsaved record, export anything you need to keep and use Reload files.

## Attachment controls

| Control | Saved meaning |
| --- | --- |
| Inherit from previous level | No override; follow category/weapon choices |
| Unknown — not checked | `null`; excludes unresolved loadouts |
| Unavailable slot | `[]`; the slot cannot be equipped |
| Choose specific attachments | Explicit list of checked IDs; No attachment is an ordinary checkbox |

If no choice is checked in specific mode, it is saved as Unknown, not as No
attachment or unavailable. The form says this explicitly. Unknown exceptions are
now supported at weapon and operator levels as well as categories.

Existing add/remove overrides from hand-edited JSON are displayed as their effective
choices and preserved unless edited. Changing their checkboxes writes a complete
replacement list for that slot. Select Inherit to remove that exception. Effective
choices are shown beside their inherited source; inheritance never verifies a new
operator automatically.

## Status and manual verification

- **Incomplete:** required inventory or effective compatibility is missing.
- **Complete · unverified:** the structure is complete but no current manual check exists.
- **Verified:** the manual check and its content fingerprint match.
- **Needs review:** a previous check is stale, or you explicitly marked it for review.

Database checks also show structural errors, review notes, and the eligible count.
A verified operator may still be outside the generation pool when the dataset is
Draft or another structural error blocks the dataset. The real pool is not activated
in the generator in this milestone.

After checking an operator in-game, enter reviewer, actual check date, patch, and
evidence notes. Check the confirmation for each weapon's attachment menus and the
complete inventory/gadgets confirmation, then choose **Confirm manual verification**.
Finally choose **Save changes**. Confirmation refuses incomplete or invalid records.

A SHA-256 content fingerprint covers the operator, review details, target patch and
dataset kind, referenced weapons, their category defaults, referenced attachments,
and gadgets. Changes to shared dependencies invalidate affected operators. This is
conservative: even a default currently hidden by a replacement can require review.
Unrelated equipment changes and JSON property ordering do not invalidate checks.

Fingerprints are checked by the shared validator, not just the UI. External JSON edits
cannot silently keep an eligible verified record: a mismatch reports STALE_CONTENT
and excludes the operator. Loading the editor presents it as Needs review; the next
save records that status. Old verified records without fingerprints require rechecking.
The two shipped fictional verified examples have simulated fingerprints only.

Editing equipment after pressing Confirm cancels that pending confirmation. Merely
saving a draft does not refresh approval. A fingerprint detects changes; it cannot
prove someone performed a check or prevent an intentional false assertion in JSON.

## Saving and conflicts

Save changes writes the catalogs and individual operator files directly under
`database/real/`. Draft warnings do not block saves. Structural errors do: the form
shows the findings and retains your unsaved entries. You can continue across tabs
without losing edits. The page warns before closing with unsaved changes.

Save failures also retain the in-memory edits. **Export unsaved copy** downloads a
combined JSON snapshot you can keep for reference or recovery; this first version
does not import that snapshot automatically. It contains equipment data only.

Every load has a disk revision. If another tab or an external editor changes files,
the next stale save is rejected. Export your edits before Reload files, then reapply
the intended changes to the latest version. Do not edit JSON in another program during
a save: external programs do not honor the editor's process lock, and an arbitrary
write at exactly the same instant cannot be fully coordinated.

## Safe writes and recovery

Each save keeps a backup transaction under `database/real/.editor-backups/`, writes a
recovery journal, and writes each changed file to a same-directory temporary file.
The temporary file is flushed and renamed into place. Saves are serialized. A failure
rolls the transaction back; a process interruption leaves a journal for automatic
recovery on the next load. This is recovery-backed multi-file saving, not a claim
that the operating system offers one atomic operation across all JSON files.

If recovery detects a third-party edit that is neither the old nor the planned new
content, it refuses to overwrite it. Keep your browser edits exported, stop the editor,
and preserve the whole data folder before resolving the conflict. The journal and
backup JSON contain `path`, `before`, and `after` for each affected file. Restore a
consistent set of `before` contents with help if needed; do not blindly delete a
recovery journal. Do not publish backups containing private evidence notes.

Backups and lock/journal files are Git-ignored. Equipment source files are not. A
stale process lock after a crash is detected on the next launch; if Windows has
reused that PID or the lock is malformed, startup conservatively refuses. Check that
no editor process is running before removing only `.editor-session.lock`.

The server accepts no browser-supplied paths and serves only an explicit asset list.
It checks Host, Origin, content type, body size, IDs, and linked data paths. No API keys,
arbitrary file reads, or remote access are provided. The HTTP interface is intended
for your trusted Windows account, not as protection from other programs already
running with that account's filesystem access.

## Tests and GitHub Desktop

Run `node --test` from the project folder. Tests use fictional copies under `.local/`,
temporary loopback servers, and mocked RANDOM.ORG responses. They cover fingerprints,
editing state, save/load, conflicts, failure rollback, recovery, and HTTP restrictions.

Review these additions/changes:

- `Start-Editor.cmd`, `Start-Editor-Practice.cmd`, `scripts/edit-database.mjs`
- `editor/` (forms, styling, editing state)
- `server/editor-store.js`, `server/editor-http.js`
- `src/domain/verification.js`, updates to `equipment-v2.js`
- `server/http-server.js` (serves the shared pure verification module only)
- fictional example fingerprints and validation/editor tests
- `.gitignore`, README, architecture/database guides, and this guide

The generator interface, active mock data, RANDOM.ORG modules, and real equipment
files are unchanged. No commit or push is performed automatically.
