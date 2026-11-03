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

## Database schema, version 1

- `schemaVersion`: format version; currently 1.
- `dataVersion`: `{ id, kind, verifiedPatch }`. Current ID is `mock-fixtures-v1`,
  kind is `mock`, and verifiedPatch is `null`. Future `verified` data requires a
  nonempty patch identifier; setting it must follow an actual data verification.
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

## Random-provider boundary

Providers implement `async nextUint32()` and return an integer in `[0, 2^32)` or
throw. Uniformity of those words is the provider's responsibility. Production UI
uses `LocalRandomProvider`, backed by the browser's `crypto.getRandomValues`,
explicitly labeled “Local browser randomness · not RANDOM.ORG.” Tests inject
deterministic streams and failing providers. No RANDOM.ORG connection exists.

For `n > 1`, selection computes `limit = 2^32 - (2^32 mod n)`, rejects values
`>= limit`, then returns `value mod n`. The accepted range contains an equal number
of values for every result index. For example, `n = 3` rejects `4294967295`.
For `n = 1`, selection returns immediately. A guard fails after 1024 consecutive
rejections rather than hanging on a broken provider; it never substitutes a biased
fallback value. Provider errors propagate so the controller retains the last result.

## Future RANDOM.ORG milestone — plan, not implemented

1. Verify the current official API contract, quotas, response encoding, and allowed
   block sizes before implementation. No endpoint or numeric API limit is assumed here.
2. Add a buffered provider with the same `nextUint32()` contract. Fetch uniform
   random bits/bytes in blocks, decode complete unsigned 32-bit words using a fixed
   byte order, and consume each word once. Keep unused words for subsequent loadouts.
   Block size and a refill threshold should minimize network calls within verified
   API limits; serialize overlapping refills to prevent duplicates and wasted quota.
3. Keep API credentials in a local server process, outside browser source and Git.
   Expose only the minimum loopback endpoint the UI needs. Never embed keys in client
   bundles, browser storage, logs, or repository data.
4. Validate response structure and provenance; use request timeouts and explicit
   quota/network errors. Do not silently fall back to local randomness while retaining
   a RANDOM.ORG label. A failed/incomplete refill must not expose partial state.
5. Keep unbiased rejection sampling in `selection.js`, above the buffer. Retain
   tests for rejection boundaries and add buffer exhaustion, partial blocks,
   concurrent refill, timeout, quota, and provenance tests. Inject stub API responses.

In-memory buffering is the default plan. Persistent caching needs a separate design
for atomic consumption, crash recovery, and preventing accidental reuse of random
words. The current loopback server only serves static application files.
