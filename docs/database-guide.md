# Equipment database: editing and verification

Milestone 3A introduced this preparation workspace; milestone 3B adds a
[graphical editor](editor-guide.md) for ordinary data entry without JSON typing.
This document remains the JSON format reference. **The running application still uses
the original fictional mock database.** Its interface, RANDOM.ORG integration,
and launch process are unchanged. No real Siege equipment has been entered or inferred.

## Recommended editing approach

Use the local graphical editor for everyday entry, with one JSON file per operator
and shared catalog files for equipment underneath. Direct JSON editing remains
available in Notepad or your existing text editor. JSON keeps the data
separate from code, represents attachment lists directly, and makes individual
changes visible in GitHub Desktop. A validator catches mistakes before generation.

The tradeoff is punctuation: use double quotes, separate entries with commas, and
do not leave a comma after the last entry. JSON does not allow comments; put notes
in the optional `notes` field. Keep file extensions visible so `.json` does not
become `.json.txt`. The examples are copyable templates, not game facts.

## Where things go

| Location inside `database/real/` | What to enter |
| --- | --- |
| `metadata.json` | Format version, your data revision, target Siege patch, draft/ready status |
| `attachments.json` | Each observed attachment's name, stable ID, and slot |
| `categories.json` | Starting attachment lists for each weapon category |
| `weapons.json` | Shared weapons, their categories, equipment slots, and exceptions |
| `gadgets.json` | Secondary gadget identities and names |
| `operators/<operator-id>.json` | One operator's side, equipment choices, restrictions, and manual verification |

`database/example/` contains an entirely fictional worked example, including two
operators sharing a rifle and an unfinished operator. Its verification entries are
**simulated examples only**, clearly marked as such. Never copy those verification
claims into real data. `database/templates/operator.json` starts safely in draft mode.

The real workspace is deliberately empty. Do not use fictional entries to fill it.
`operators/.gitkeep` simply keeps its empty directory in Git; it is not data.

## IDs and names

An ID is a permanent reference, such as `demo-shared-rifle`. Use lowercase letters,
digits, and hyphens. IDs must be unique within each catalog; operator IDs must be
unique across all operator files. The display `name` is the actual name you observed,
not a count of available choices. Keep the ID when correcting a display name.

For example, this fictional attachment goes in `attachments.json`:

```json
{ "id": "demo-dot", "name": "Fictional dot sight", "slot": "optic" }
```

The attachment slot keys are `optic`, `barrel`, `grip`, and `underbarrel` (singular
for compatibility with the existing app). An optic cannot be listed as a grip.
The one reserved entry is:

```json
{ "id": "none", "name": "No attachment", "slot": "any" }
```

`none` represents an explicitly allowed choice; including it in the catalog does
not automatically make it available in any weapon slot.

## Unknown, unavailable, and no attachment are different

| Value | Meaning |
| --- | --- |
| `null` | Unknown/not entered yet. Never treated as an empty slot or a valid choice. |
| `[]` | Confirmed unavailable attachment slot. Consumes no random bits. |
| `["none"]` | Available slot, with only the No attachment choice. Consumes no random bits. |
| `["none", "demo-dot"]` | Available slot with two specific choices. |

Every category has all four slot keys. Use `null` for unresearched defaults. Primary,
secondary, and gadget lists on an operator must each contain at least one confirmed
ID before that operator is complete. For those inventory lists, `[]` means incomplete,
not “this operator needs no weapon.” Future game cases requiring a different model
must extend the schema explicitly; do not disguise them with made-up entries.

## Defaults and exceptions

Resolve lists in this order: **category defaults → weapon exceptions → operator
exceptions for that weapon**. A category is only a starting template. Do not assume
two weapons in the same category have the same attachments, and check shared weapons
separately for each operator.

An omitted override inherits the previous layer. A plain list replaces it completely:

```json
"attachmentOverrides": {
  "optic": ["none", "demo-dot"],
  "grip": []
}
```

For smaller changes, use `add` and/or `remove`:

```json
"attachmentOverrides": {
  "barrel": { "remove": ["demo-brake"], "add": ["demo-suppressor"] }
}
```

Removal happens before addition. The validator rejects removal of something that
is not inherited, addition of an already inherited item, duplicate choices, and
adding/removing the same ID together. To add/remove from an unknown (`null`) base,
first enter a complete replacement list. To remove every option, use `[]`. A
replacement can resolve an unknown category slot for one specific weapon.

An operator puts the same override rules inside the relevant weapon ID:

```json
"attachmentOverrides": {
  "demo-shared-rifle": {
    "optic": { "remove": ["demo-scope"] },
    "underbarrel": []
  }
}
```

That restriction affects only this operator. It does not change the shared weapon
for other operators. Adding a known attachment at the operator layer is supported
when a manually observed exception grants it. Overrides for a weapon outside the
operator's inventory are invalid.

## Entering an operator

1. Copy `database/templates/operator.json` into `database/real/operators/`, naming
   it after the operator ID. Replace the ID, name, and side (`attack` or `defense`).
2. Enter only information you have checked. Add referenced attachments, categories,
   shared weapons, and gadgets to their catalogs before referencing their IDs.
3. List the full inventory and every needed weapon/operator exception. Leave the
   operator in `draft` while anything is unknown. An unresolved final slot excludes it.
4. Check the actual in-game operator selection for the target patch: every primary,
   every secondary, each attachment menu on each weapon, and secondary gadgets.
5. Record the verification fields below and use the editor's Confirm manual
   verification button to stamp the fingerprint. Do not mark something verified based only
   on another operator's copy of the same weapon or on a category default.
6. Run validation. Review resolved restrictions and the GitHub Desktop changes before
   backing up the data. Validation is an error checker, not a substitute for gameplay
   verification.

A short fictional draft record looks like this (its referenced IDs must exist):

```json
{
  "id": "demo-vector",
  "name": "Fictional Vector",
  "side": "attack",
  "primary": ["demo-shared-rifle"],
  "secondary": ["demo-pistol"],
  "gadgets": ["demo-smoke"],
  "attachmentOverrides": {
    "demo-shared-rifle": { "optic": ["none", "demo-dot"] }
  },
  "verification": { "status": "draft" }
}
```

This record is excluded from the generation pool until manually verified.

## Verification and patch rules

`metadata.json` uses `schemaVersion: 2`. `dataVersion.id` is your dataset revision
(for example `siege-draft-001`), while `dataVersion.patch` is the exact patch you
are targeting. It starts as `null`; no patch has been assumed. `kind` is `real`
for the real workspace and `mock` for examples. `status` is `draft` until you
explicitly set it to `ready` for a reviewed pool.

Per-operator `verification` fields:

| Field | Required to become eligible |
| --- | --- |
| `status` | `verified`; other states are `draft` or `needs-review` |
| `patch` | Exactly matches the dataset target patch |
| `checkedOn` | Actual valid check date in YYYY-MM-DD format |
| `checkedBy` | Reviewer name/nickname |
| `evidence` | Nonempty list of meaningful manual-check notes or evidence references |
| `weaponsChecked` | Every primary and secondary weapon ID whose attachment menus were checked for this operator |
| `fingerprint` | Generated by explicit confirmation in the editor; must still match the checked content and dependencies |

The dataset must be `ready`, with a known target patch and no structural errors.
Each included operator must have complete resolved data and valid verification.
Incomplete/unverified operators can coexist in a ready dataset, but they remain
excluded. Counts are derived from the eligible entries for each side. If no eligible
operator exists, generation fails before any random bits are consumed.

On a new patch, update the target patch and put affected operators in `needs-review`.
Changing the target patch automatically makes old patch verification ineligible.
If you edit a shared category/weapon, recheck **every operator using it** and mark
those operators `needs-review` before editing. An inventory addition also requires
updating the weapon checklist after the new option is checked.

Milestone 3B records a content fingerprint when you confirm manual verification in
the editor. Changes to the operator, review details, patch, or shared dependencies
make the previous check stale, including edits outside the editor. The validator
excludes stale fingerprints; the editor presents them as Needs review. Old records
without a fingerprint also require rechecking. Do not manufacture fingerprints by hand.

**Limits:** software cannot determine whether a recorded manual check really happened
or whether a real weapon/gadget was omitted. Verification remains a human assertion.
The model assumes attachment slots are independent and each weapon has one equipment
slot. Extend the schema before entering game cases that do not fit those assumptions.

## Run validation on Windows

Double-click **Validate-Database.cmd** to check `database/real/`. It uses the same
Node.js installation as the app, reads no API key, and makes no network calls.

Or open PowerShell in the project folder:

```powershell
node scripts/validate-data.mjs database/real
node scripts/validate-data.mjs database/example
node scripts/validate-data.mjs database/real --strict
```

The report lists field paths, issue codes, and messages, followed by eligible
attacker/defender counts. For example, `operators[demo-unfinished].primary` identifies
the operator and field to fix. Find that ID in its operator file. Category and weapon
paths similarly point to records in the shared catalog files.

- **Errors**: malformed structure, unknown IDs, duplicate IDs, invalid restrictions,
  wrong attachment slots, or misspelled fields. These block the whole dataset.
- **Warnings**: unfinished data, draft status, missing verification, or stale patch
  verification. Affected operators are excluded. Draft warnings are expected while editing.
- Ordinary mode exits with failure only for errors. `--strict` also fails on any
  warning or an empty eligible pool, making it useful for a clean release check.

Duplicate JSON properties are rejected rather than silently overwritten. File and
JSON syntax failures are reported before semantic validation. Fix those first and
run the command again. Normal validation reports semantic issues together.

The example intentionally includes an unfinished operator: normal validation succeeds
with warnings and reports one eligible attacker and one defender; strict mode fails.
The empty real workspace reports zero eligible operators. Neither command activates
that workspace in the app or modifies files.

## Compatibility, activation, and backup

The existing schema-v1 **mock** dataset remains supported unchanged. A legacy global
`kind: verified` flag is no longer accepted as sufficient verification: real data
must use version 2 with per-operator checks. The domain generator already accepts v2
datasets returned by the file loader; tests exercise that path with fictional data.

The running browser and server deliberately remain connected to the original mock
dataset. Activating real data in the UI will be a separate milestone, with the correct
labels and shared catalog delivery. Once activated, adding operators or equipment
uses these JSON files and the validator, not application logic. The separate local
editor now maintains these files; a live dataset switch remains deferred.

Back up `database/`, `docs/database-guide.md`, the validator command/script, the loader,
validation module, tests, and small integration changes through GitHub Desktop.
Continue excluding your existing `.env` key file. No commit or push happens automatically.
