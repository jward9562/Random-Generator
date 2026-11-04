# Architecture and data contracts

## Boundaries

`app.js` renders DOM elements and connects browser events. `ui/controller.js` owns
selection, optional storage, busy state, errors, and the last successful result.
`domain/generate-loadout.js` only knows the database and a random-provider contract;
it has no DOM, storage, network, or concrete provider dependency.
`domain/compatibility.js` validates data and resolves attachment choices.
`random/selection.js` converts provider words to uniform choices.

Generation validates the database before drawing randomness. It selects an operator
uniformly within the requested side, then selects each equipment item uniformly
within that operator's permitted choices, followed by that item's attachments.
This is conditional uniform selection, not uniform selection across every possible
complete loadout (operators with larger inventories have more combinations).
Only a complete result replaces the previous result. While pending, side changes
and duplicate requests are blocked. Failure leaves the old result intact.

## Database schema, version 1 (active mock data)

- `schemaVersion`: format version; currently 1.
- `dataVersion`: `{ id, kind, verifiedPatch }`. Current ID is `mock-fixtures-v1`,
  kind is `mock`, and verifiedPatch is `null`. Only mock data is supported in this
  legacy format; real-data verification now requires schema version 2.
- `attachments`: stable attachment IDs mapped to display names. The `none` entry
  represents an explicitly allowed choice to equip no attachment.
- `categories`: complete default lists for `optic`, `barrel`, `grip`, and
  `underbarrel`, referencing attachment identities, never counts.
- `weapons`: ID, name, category, primary/secondary slot, optional partial
  `attachmentOverrides` by attachment slot.
- `gadgets`: stable gadget IDs mapped to display names.
- `operators`: unique ID, display name, side, nonempty primary/secondary/gadget ID
  lists, and optional attachment overrides keyed by an available weapon ID.

Attachment resolution order: **category → weapon → operator for that weapon**.
An override replaces the entire choice list for a slot; it does not append or
intersect. An omitted slot inherits. `[]` explicitly removes the slot, while
`['none']` fixes it to no attachment. This allows operator exceptions to narrow or
expand category/weapon defaults deliberately. Duplicate and unknown IDs are errors,
so duplicates cannot accidentally weight a choice. Overrides for weapons outside
the operator inventory are rejected. Choices with one entry consume no randomness;
unavailable slots return `null` and also consume none.

Results retain operator, weapon, attachment, and gadget IDs plus a copy of the
dataset version. Display labels are looked up only at the UI boundary. The model
currently assumes attachment slots are independent once operator and weapon are
known. If verified game data introduces cross-slot exclusions or weapons usable
in multiple equipment slots, extend the schema and tests before entering those cases.

## Database schema, version 2 (preparation workspace)

See [the editing guide](database-guide.md) for examples and exact field semantics.
`server/equipment-files.js` combines catalog arrays and individual operator JSON files
into a v2 dataset; duplicate JSON keys are rejected before use. Arrays retain duplicate
IDs so `src/domain/equipment-v2.js` can report them. The inspector returns structured
issues and an eligible operator list. Structural errors fail closed; incomplete,
unverified, and patch-stale records are excluded. Dataset readiness is a separate gate.

V2 category, weapon, and operator attachment layers support replacement and add/remove.
Unknown (`null`) slots at any layer can be completed by specific replacements;
unresolved slots never enter the pool. `[]` and `['none']` retain their v1 meanings.
Attachments have named IDs and explicit slot types. Manual operator verification
records patch, date, reviewer, evidence, and the list of weapons checked. The pure
`verification.js` module adds a canonical SHA-256 fingerprint of the operator and its
dependencies. The validator excludes missing or mismatched fingerprints, including
same-patch external edits. It remains a human assertion, not an automatic truth check.

The existing domain generator uses the same compatibility entry points for v1 and v2.
`availableOperators` derives the v2 pool from the inspector; validation runs before
randomness is consumed. The static server serves the new pure validation module because
the existing browser compatibility module imports it. No data files, key files, or
server modules are added to the public allowlist. Mock remains the default; milestone
3D optionally loads the real v2 data on the server as described below.

## Real-data preview (milestone 3D)

`server/datasets.js` owns the fixed real-directory loader and a compact public dataset
summary. `GET /api/datasets` reads/validates without drawing randomness. Draft,
structural failure and empty-side gates run before generation can consume any bits.
Fingerprints, per-operator completeness and patch matching remain the v2 validator's
responsibility; the preview neither restamps nor edits equipment.

`POST /api/generate` accepts `{ side, dataset: 'mock' | 'real' }`; omitting dataset
keeps the old mock behavior. One loadout service and one bit buffer serve both modes.
Every real request reloads and validates the files and rejects outstanding editor
recovery journals. Results include dataset provenance and only the selected display
names from that same snapshot. Raw catalogs and verification evidence stay private.

The controller holds the selected mode independently of the previous successful
result. Changing sides/modes never generates automatically. Result display labels
are retained through failures and later dataset edits. Metadata reads cannot overwrite
a newer generation summary. See [the preview guide](real-preview-guide.md).

## Local editor (milestone 3B)

`editor/` is a separate interface; its editing model preserves unsaved drafts and
cancels pending verification confirmations when dependencies change. Attachment
forms use the v2 resolver for inherited/effective choices. Explicit confirmation is
required before the store stamps a new verification fingerprint.

`scripts/edit-database.mjs` binds port 4174 to loopback and fixes the workspace to
`database/real/`. Optional `--practice` uses a fresh fictional copy under `.local/`
on port 4175. A process lock prevents competing editor processes for one workspace.
`server/editor-http.js` exposes only allowlisted assets and two JSON endpoints,
with Host/Origin/content-type/size checks. It imports no RANDOM.ORG or key configuration.

`server/editor-store.js` validates before saving, serializes reads/writes, rejects
stale disk revisions and linked paths, and preserves existing IDs and filenames.
It uses flushed temporary-file renames, backup transactions, and a recovery journal
to roll back interrupted multi-file saves. External conflicts during recovery fail
closed. External programs do not honor the editor lock, so concurrent external
writes at the precise save instant remain outside its coordination guarantees.
See [the editor guide](editor-guide.md) for recovery and first-version limits.

## Runtime boundary (milestone 2)

The browser sends `{ side, dataset }` to `POST /api/generate`. The Node server owns the
key, RANDOM.ORG transport, bit buffer, and generation. The browser controller injects
a generation function, commits only successful results, and performs no generation
at startup. The server rejects simultaneous generation requests rather than creating
an unbounded queue. All tabs share one buffer in that server process.

Static serving uses an explicit allowlist. `.env`, server modules, Git metadata,
and tests are never served. The listener binds to 127.0.0.1. Host, same-origin, JSON
content type, and request-size checks protect the generation endpoint. No CORS
permission is granted to unrelated sites. Application errors are deliberately mapped
to safe messages; raw request bodies, API responses, keys, and transport errors are
never logged or returned to the browser.

## Bit provider and unbiased selection

`BitBuffer` implements `async nextBits(k)` for 1 through 32 bits. It reads each byte
in order, most significant bit first. It serializes overlapping reads, fetches only
when empty, retains partial bytes, and can span blocks. Every read advances a
forward-only cursor. Rejected patterns, bits used by a failed generation, and bits
in an incomplete read are consumed permanently. No state is rolled back. A failed
refill installs no partial block.

For n choices, `choose` returns immediately if n = 1. Otherwise it asks for
k = ceil(log2(n)) bits, giving an integer uniformly distributed in [0, 2^k).
It accepts values below n and discards all others. Each accepted index has exactly
one bit pattern, so conditioning on acceptance is uniform. Repeating after rejection
preserves that distribution. This uses only the necessary bits instead of spending
32 bits for a two-choice decision. A 1024-rejection guard fails rather than hanging
on a broken source; it never substitutes a fallback. Empty attachment slots consume
nothing, as do single-option equipment and attachment choices.

The provider-independent generator and compatibility resolver remain shared pure
domain modules. Successful server results add `randomness` metadata: source,
method, and bits consumed. If a future dataset has a completely fixed loadout, the
source is `none-required`, not RANDOM.ORG. The UI's label describes the currently
displayed result and remains correct after a later failed attempt.

## RANDOM.ORG transport

Implemented against the official Release 4 documentation reviewed November 3, 2026:

- [Basic API / generateBlobs](https://api.random.org/json-rpc/4/basic#generateBlobs)
- [Transport fundamentals](https://api.random.org/json-rpc/4/fundamentals)
- [Error codes](https://api.random.org/json-rpc/4/error-codes)
- [API key management](https://api.random.org/api-keys)

The server POSTs JSON-RPC 2.0 to `https://api.random.org/json-rpc/4/invoke`, using
`generateBlobs`, `n: 1`, `size: 8192` bits (1 KiB), and `format: 'hex'`. It deliberately
omits `pregeneratedRandomization` so historical deterministic replay is not requested.
The block size is our application default, within the documented API bounds.

The transport validates the RPC version and request ID, mutually exclusive
result/error, usage metadata, exact blob length, and hexadecimal encoding. It does
not accept a zero-bits-used result as fresh randomness. There is a 15-second timeout
including response-body reading, a 64 KiB response limit, and no redirect following.

The server's `advisoryDelay` sets the earliest allowed next refill. HTTP Retry-After
(seconds or date) is also respected. While a delay is active, available buffered bits
remain usable; an empty buffer returns an understandable retry message. Transient
errors apply exponential cooldowns of 5, 10, 20, 40, then 60 seconds; a longer server
delay takes precedence. The app makes no automatic retries, polling calls, startup
calls, low-water prefetches, or `getUsage` requests.

Known `bitsLeft` can reduce the next request to a whole-byte size. A remaining
allowance smaller than 8 bits, or zero requests, blocks refills until the next UTC
day. Quota errors update that state; a bit-quota error with a positive remaining
allowance allows a smaller request on a later user retry. A stopped/invalid key or
insufficient credit produces a specific safe error. Quotas are estimates; the API
remains authoritative if another application also consumes the same key's allowance.
Use a dedicated key and one server instance for this app.

## Configuration and lifecycle

`server/config.js` reads `RANDOM_ORG_API_KEY` from the process environment first,
otherwise from project-root `.env`, using Node's built-in environment-file parser.
The tracked `.env.example` contains no key. The existing ignore rules exclude `.env`.
Keys are loaded once per process; restart after changing configuration. No key is
accepted in a browser request, query string, or UI field.

Buffers, quotas, and cooldowns live only in server memory. A browser reload does not
refetch or rewind the server's bits. Restarting the server discards unused bits and
resets local quota/delay estimates; avoid restarting to bypass a service delay.
The next explicit generation fetches a fresh block. There is no persistent random
cache and no retry of an uncertain completed request. On a timeout/disconnect, any
bits the server already consumed remain consumed even if the browser gets no result.

The Basic API's HTTPS origin and validated response determine the source label;
there is no Signed API signature or independent certificate of authenticity.
Fictional equipment remains clearly labeled separately from the random source.

## Testing and review

Tests inject fake fetch responses and synthetic bit streams; none use a live key,
read the user's `.env`, or contact RANDOM.ORG. They enumerate small selection ranges
to check equal mapping, exercise boundaries and consumption, simulate quota/delay
and transport failures, and run the full controller-to-loopback-server-to-provider
path with a failed refill. Additional HTTP checks verify private files and other
origins cannot reach the key-backed service. See the README for Windows acceptance
steps and the backup file list.
