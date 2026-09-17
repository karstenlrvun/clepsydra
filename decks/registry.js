// The deck registry -- the one list of decks that exist. Phase 2
// (PHASE2_PLAN.md §2.1). Read by both index.html (renders the deck cards
// and the dashboard from this instead of a hand-written DECKS array) and
// deck.html's boot script (the ?deck= allowlist becomes a REGISTRY lookup
// instead of a hardcoded array). Loaded as a real, ordinary <script src>
// tag -- unlike decks/<id>.js, its filename never depends on the URL, so it
// doesn't need the document.write trick, just script-tag load order.
//
// Static on purpose: decks are still files today; an IndexedDB-backed
// registry only earns its keep once a deck can be *created* on the device
// (Phase 4), at which point this file becomes the seed for that store
// rather than something to rewrite.
//
// Fields:
//   id       -- URL param value (deck.html?deck=<id>) and the localStorage/
//               IndexedDB key suffix used throughout this file's own name.
//   key      -- the deck's real storage key (state/log/sync slot), i.e.
//               each content file's own `KEY` const. Kept here too so the
//               launcher never has to load a deck's content just to find it.
//   title    -- display name.
//   script   -- writing system ('latin'/'greek'), matching that deck's own
//               DECK.script inside decks/<id>.js. Metadata only here, so
//               the launcher can know it without fetching full content.
//   words    -- word count, for display; not load-bearing anywhere.
//   blurb    -- one-line description shown on the launcher's nav card.
//   archived -- hides the card and the calendar row on the launcher (D3:
//               archive, not delete -- state/log/sync stay untouched, and
//               the deck is still reachable directly by its old URL/icon).
const REGISTRY=[
  {id:'latin', key:'clepsydra.latin.v2', title:'Latin', script:'latin', words:3034,
   blurb:'3,034 words, Parts I–VIII, both directions', archived:false},
  {id:'greek', key:'clepsydra.greek.v1', title:'Greek', script:'greek', words:1031,
   blurb:'1,031 words, freshers + agon, both directions', archived:false}
];
