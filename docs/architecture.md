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

## Runtime boundary (milestone 2)

The browser sends only `{ side }` to `POST /api/generate`. The Node server owns the
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
