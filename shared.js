// Helpers shared by the engine (deck.html) and the launcher (index.html).
//
// Why this file exists (2026-08-17): index.html deliberately never loads a
// deck's engine or content -- "the launcher stays a reader" (PHASE2_PLAN.md
// §2.2) -- so it used to carry its own copy of every one of these. Copies
// drift silently: nothing fails, the two screens just quietly begin
// disagreeing, which is exactly the class of bug the stats audit that
// prompted this file spent its time chasing. A test guard was written first
// and did catch simulated drift, but a guard only tells you the copies have
// diverged; this removes the copies.
//
// Rules for anything living here:
//   * Pure. No DOM, no S, no globals from either page. Everything a function
//     needs arrives as an argument -- which is why heatRec/heatCellBg take
//     `days` and `mode`/`accent` rather than reading S.days/S.settings the
//     way the engine's own versions once did.
//   * Declared with plain top-level const/function. Classic scripts share
//     one global lexical scope, so these names are visible to any <script>
//     that loads after this one -- and NEITHER page may redeclare them, or
//     the later declaration is a hard SyntaxError.
//
// Loaded as an ordinary parser-blocking <script src> before each page's own
// script, alongside decks/registry.js. It must also be copied by
// tools/make_upload_bundle.sh: a generator script that predates a newly
// required file has already shipped one fully broken deploy in this project.

// Retention's ramp is mixed in OKLCH, not sRGB (2026.08.15.6). Blending
// --good into --again through sRGB walks a straight line in a space where
// that line passes through desaturated mud: the midpoint of a green and a
// red is a murky brown, and two adjacent days at genuinely different recall
// could read as "murky green" and "lush green" with no way to tell which was
// the better one. OKLCH takes the shorter hue path instead, which for
// green -> red descends through yellow and orange -- the familiar
// traffic-light ramp, monotonic to the eye at every step, and the reason the
// legend gradient in deck.html can be read as a scale at all. Volume keeps
// its single-hue accent-into-panel ramp, which was already monotonic; it is
// mixed in OKLCH too purely so the legend and the cells agree exactly.
const HEAT_SPACE='oklch';

// ---- device-created decks (Phase 4, PHASE3_4_HANDOFF.md §2) ----
// decks/registry.js stays the static seed list (its own header comment: "an
// IndexedDB-backed registry only earns its keep once a deck can be *created*
// on the device, at which point this file becomes the seed for that store
// rather than something to rewrite" -- that point is now). A deck created by
// the triage screen adds a row here instead: same shape as a REGISTRY row
// (id/key/title/script/words/blurb/archived), source:'idb' always set, kept
// in localStorage rather than IndexedDB because deck.html's own ?deck=
// lookup runs synchronously in the head, before any IndexedDB open is even
// possible (see that boot script's own comment on why it must stay
// synchronous) -- same "small localStorage mirror of something IndexedDB-
// backed" shape BOOT_KEY already uses for the theme. Device-local only:
// discovering that a deck EXISTS does not sync between devices in this
// build (the deck's own state/log, once created, syncs like any other deck
// once a code is entered for it -- only the "here is a deck" fact stays
// local). Read via a tiny JSON.parse(localStorage...) directly in each page
// rather than a shared loader function, on purpose -- see this file's own
// purity rule above; only the merge logic (where a real bug could hide) is
// pure enough to live here.
const USER_DECKS_KEY='clepsydra.userDecks';
// A user deck can never share an id with a built-in one (minted ids are
// 'd'+base36, disjoint from the short static ids in decks/registry.js) but
// this de-dupes by id anyway, first-wins -- purely defensive, never expected
// to matter, cheaper to have than to explain away later if it ever does.
function mergeRegistry(reg,userDecks){
  const seen=new Set(reg.map(d=>d.id));
  return reg.concat((userDecks||[]).filter(d=>d&&d.id&&!seen.has(d.id)&&seen.add(d.id)));
}

// ---- streaks ----
// A day counts if it has any ratings. `since` is the optional "count my
// streak from this day" reset (S.settings.streakStart); omitted, both
// functions behave as they always did and look at all of history.
// Today not being studied yet does not break the current streak -- only a
// gap strictly before today does.
// What counts as a study day (Clepsydra 2026.09.17.11, his rule): a day he
// finished what was due, or reached his limit, whichever came first -- the app
// notes that on the day itself as rec.met (1 or 0). A day with nothing due
// counts on its own. A record from before the rule has no `met` at all, and
// counts if any study happened on it.
function dayCounts(rec){
  if(!rec) return false;
  if(rec.met!==undefined) return rec.met===1;
  return !!(rec.n||((rec.studyMs|0)+(rec.triMs|0))>0);
}
function metOfLast(days,todayKey,span){ let n=0; for(let k=todayKey-span+1;k<=todayKey;k++) if(dayCounts(days[k])) n++; return n; }
function currentStreak(days,todayKey,since){
  let streak=0;
  for(let k=todayKey;;k--){
    if(since!=null&&k<since) break;
    if(dayCounts(days[k])) streak++;
    else { if(k!==todayKey) break; }
    if(todayKey-k>3650) break;
  }
  return streak;
}
function longestStreak(days,todayKey,since){
  let best=0,run=0;
  const floor=(since!=null)?Math.max(since,todayKey-3650):todayKey-3650;
  for(let k=floor;k<=todayKey;k++){
    if(dayCounts(days[k])){ run++; best=Math.max(best,run); } else run=0;
  }
  return best;
}

// ---- the heatmap's baseline ----
// Daily average of ratings made, over a configurable trailing window
// (the heatmap stat chip's own inline picker, S.settings.heatmapAvgWindow).
// 'week'/'month'/'year' are fixed spans ending today, same windowing shape
// recentPace() uses; 'all' walks every recorded day rather than a fixed
// count -- no invented cutoff.
const AVG_WINDOW_DAYS={week:7,month:30,year:365};
function windowedDailyAverage(days,todayKey,window){
  if(window==='all'){
    let sum=0,n=0;
    for(const k in days){ const r=days[k]; if(r&&r.n){ sum+=r.n; n++; } }
    return n?Math.round(sum/n):0;
  }
  const span=AVG_WINDOW_DAYS[window]||AVG_WINDOW_DAYS.month;
  let sum=0,n=0;
  for(let k=todayKey;k>todayKey-span;k--){ const r=days[k]; if(r&&r.n){ sum+=r.n; n++; } }
  return n?Math.round(sum/n):0;
}
// Average ratings-per-studied-day across the whole collection (Review
// Heatmap's own approach: colour relative to *your* average, not a fixed
// number, so a light or heavy user both get a readable spread rather than
// one all-coral wall or one that never leaves the palest tint). Only the
// fallback baseline now -- see heatmapBaseline().
function heatmapAvgRatings(days){
  let sum=0,n=0;
  for(const k in days){ const r=days[k]; if(r&&r.n){ sum+=r.n; n++; } }
  return n?sum/n:0;
}
// Trailing-window average ms/rating (2026-08-20, moved here from index.html
// so deck.html's own "~N min left" top-bar estimate can share the exact same
// number rather than a second, possibly-drifting implementation). Gated the
// same way the Stats page's own seconds/review readout is (a couple of data
// points is noise, not a real pace) -- returns null rather than guess off
// too little, and every caller must degrade gracefully.
function avgMsPerRating(days,todayKey,windowDays){
  let sumMs=0,sumN=0,daysWithData=0;
  for(let k=todayKey-windowDays;k<todayKey;k++){
    const r=days[k];
    if(r&&r.n&&r.studyMs){ sumMs+=r.studyMs; sumN+=r.n; daysWithData++; }
  }
  return (daysWithData>=3&&sumN>=10)?(sumMs/sumN):null;
}
// The one baseline both the "Daily average" chip and the Volume colour ramp
// read (2026-08-17). They used to disagree: the chip showed
// windowedDailyAverage() under the user's own picker while every cell was
// coloured against the all-time heatmapAvgRatings(). On a history that
// changed pace -- a heavy ramp-up then a review-heavy taper, which is the
// shape this app is actually used in -- that was measured at 35 shown
// against 105 painted, so a day the chip called average rendered at a fifth
// of the fill. The legend says "against your own average"; this makes that
// sentence true of the number actually on screen.
//
// The all-time fallback matters: a window with no studied days in it (a week
// off, with the picker on 'week') averages zero, and a zero baseline paints
// every cell as empty panel -- a grid that looks like it holds no data at
// all. Falling back keeps the ramp meaningful, and the chip shows the same
// fallback number, so the two still never disagree.
function heatmapBaseline(days,todayKey,window){
  return windowedDailyAverage(days,todayKey,window) || heatmapAvgRatings(days);
}

// ---- one cell ----
function volumePct(ratings,avg){
  if(!avg) return 0;
  return Math.max(0,Math.min(1,ratings/(avg*1.6)))*100;
}
// Stretched so the readable band sits over 60-100% recall (below 60% is
// rare enough in practice, and this app's own retention target lives at
// 90-95%, that spending colour resolution below 60 would waste it) --
// same "compress the scale where the data actually lives" reasoning as
// BRACKETS/CALENDAR_BUCKETS elsewhere.
function retentionPct(ok,tot){
  if(!tot) return 0;
  const r=100*ok/tot;
  return Math.max(0,Math.min(1,(r-60)/40))*100;
}
function heatRec(days,dk){
  const r=days[dk];
  return {ratings:(r&&r.n)||0, ok:(r&&r.ok)||0, tot:(r&&r.tot)||0};
}
// A CSS background string for one day cell/dot, or '' for a day with no
// data (left to the plain --panel base). color-mix() with a `var(--x)`
// reference is resolved by the browser at paint time, not here -- this never
// reads an actual colour, so the same string paints correctly under any
// palette and either mode with no re-render.
//
// That was never the same as the RAMP meaning the same thing under any
// palette, though (2026-08-30, in-progress/FOUR_QUIRKS_FINDINGS.md §3):
// --good/--again/--coral/--easy/--amber all vary BY palette, and --good
// alone spans hue 57 (a yellow) to 198 (a cyan) and lightness 22 to 76 across
// the file's 24 blocks, so the exact same 82%-recall day rendered olive in
// one palette and violet in another -- worse under daily rotation, which
// hands you a new scale each morning. Retention now reads --heat-good/
// --heat-again (palettes.css), fixed pairs, one per mode, not per palette --
// a day means the same colour every day. Volume's FAR end (the accent) is
// fixed the same way, via --heat-<accent>; its near end still mixes into
// --panel on purpose, so a quiet day still disappears into whatever ground
// the palette is wearing -- only the scale's far end needed to stop moving.
function heatCellBg(rec,avg,mode,accent){
  if(!rec||!rec.ratings) return '';
  if(mode==='retention'&&rec.tot){
    const p=retentionPct(rec.ok,rec.tot);
    return 'background:color-mix(in '+HEAT_SPACE+', var(--heat-good) '+p+'%, var(--heat-again) '+(100-p)+'%)';
  }
  const p=volumePct(rec.ratings,avg);
  return 'background:color-mix(in '+HEAT_SPACE+', var(--heat-'+accent+') '+p+'%, var(--panel))';
}
