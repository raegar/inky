// Tracks the route the current playthrough has taken through the story, for the
// Narrative Flow graph. For each turn it records where the text came from (as offsets
// into the story's output, which inklecate can map back to source lines) and which
// choice was taken. Resolving offsets to knots is only done when asked, since it
// needs a round trip to inklecate for each paragraph.

const LiveCompiler = require('./liveCompiler.js').LiveCompiler;
const InkProject = require('./inkProject.js').InkProject;

let turns = [];            // { paragraphs: [{ offset, length, shift }], choices: [{ number, text }], chosen: text|null }
let flowAtOffset = {};     // paragraph offset -> flow id ("knot" or "knot.stitch"), once resolved
let resolving = false;
let generation = 0;        // bumped on reset, so lookups from an old playthrough are dropped

// The player's count of the story's output so far ({ length(), setLength(n) }), which
// inklecate's count can differ from, since it includes spaces from the source that the
// story doesn't show. Measuring inklecate's count re-anchors ours; paragraphs since the
// last time that was done may need shifting.
let outputLength = null;
let anchoredAt = 0;
let sinceAnchor = [];

function currentTurn() {
    return turns[turns.length - 1];
}

function newTurn() {
    return { paragraphs: [], choices: [], chosen: null };
}

function reset() {
    generation++;
    resolving = false;
    turns = [newTurn()];
    flowAtOffset = {};
    anchoredAt = 0;
    sinceAnchor = [];
}
reset();

function trackOutputLength(tracker) {
    outputLength = tracker;
}

// A paragraph of text, at this offset into the story's output, this long (including its newline)
function textAdded(offset, length) {
    const paragraph = { offset, length, shift: 0 };
    currentTurn().paragraphs.push(paragraph);
    sinceAnchor.push(paragraph);
}

function choiceOffered(number, text) {
    currentTurn().choices.push({ number, text });
}

// The story jumped to a knot ("Play from here"): a new turn, reached without a choice
function jumped() {
    turns.push(newTurn());
}

function choiceMade(number) {
    const turn = currentTurn();
    const choice = turn.choices.find(c => c.number == number);
    turn.chosen = choice ? choice.text : null;
    turns.push(newTurn());
}

// The knot or stitch containing a line of source, as the Narrative Flow graph names it
function flowIdAt(filename, lineNumber) {
    const project = InkProject.currentProject;
    const inkFile = project && project.inkFileWithRelativePath(filename);
    if (!inkFile) return null;
    const symbols = inkFile.symbols.flowAtPos({ row: lineNumber - 1, column: 0 });
    if (!symbols) return null;
    if (symbols.Stitch && symbols.Knot) return `${symbols.Knot.name}.${symbols.Stitch.name}`;
    if (symbols.Knot) return symbols.Knot.name;
    return null;
}

// The turns so far, as { flows: [flow ids, in order], chosen: choice text }, using
// whatever has been resolved.
function summary() {
    return turns.map(turn => {
        const flows = [];
        turn.paragraphs.forEach(paragraph => {
            const id = flowAtOffset[paragraph.offset];
            if (id && flows[flows.length - 1] !== id) flows.push(id);
        });
        return { flows, chosen: turn.chosen };
    });
}

// Asks inklecate which line of source an offset into the output came from. Resolves to
// the location (whose filename is missing if inklecate doesn't know, e.g. past the end of
// the output), or null if there's no answer, e.g. because an Alt-click asked for a
// different one at the same time.
function lookUp(offset) {
    return new Promise(resolve => {
        let answered = false;
        const timer = setTimeout(() => { answered = true; resolve(null); }, 1000);
        LiveCompiler.getLocationInSource(offset, (location) => {
            if (answered) return;
            answered = true;
            clearTimeout(timer);
            resolve(location || {});
        });
    });
}

async function isPlaced(offset) {
    const location = await lookUp(offset);
    return location ? !!location.filename : null;
}

// How long the story's output is as inklecate counts it: the first offset it can't place
// in the source. The estimate is usually exact, which takes two lookups to confirm;
// otherwise this searches outwards from it. Resolves to null if inklecate doesn't answer.
async function measureOutputLength(estimate, isStale) {
    if (estimate <= 0) return null;
    const before = await isPlaced(estimate - 1);
    const at = before === null ? null : await isPlaced(estimate);
    if (before === null || at === null || isStale()) return null;
    if (before && !at) return estimate;

    // Find a placed offset (lo) and an unplaced one (hi) either side of the end...
    let lo, hi, step = 1;
    if (at) {
        lo = estimate;
        for (;;) {
            const placed = await isPlaced(lo + step);
            if (placed === null || isStale()) return null;
            if (!placed) { hi = lo + step; break; }
            lo += step;
            step *= 2;
        }
    } else {
        hi = estimate - 1;
        for (;;) {
            const offset = Math.max(0, hi - step);
            const placed = await isPlaced(offset);
            if (placed === null || isStale()) return null;
            if (placed) { lo = offset; break; }
            if (offset == 0) return null; // nothing can be placed at all
            hi = offset;
            step *= 2;
        }
    }

    // ...then narrow them down
    while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        const placed = await isPlaced(mid);
        if (placed === null || isStale()) return null;
        if (placed) lo = mid;
        else hi = mid;
    }
    return hi;
}

async function resolveAll(isStale) {
    // Line our count of the output up with inklecate's. Any difference built up since the
    // last time, so shift those paragraphs by their share of it.
    if (outputLength) {
        const estimate = outputLength.length();
        const actual = await measureOutputLength(estimate, isStale);
        if (isStale()) return;
        if (actual !== null) {
            const difference = actual - estimate;
            const span = Math.max(1, estimate - anchoredAt);
            sinceAnchor.forEach(p => { p.shift = Math.round(difference * (p.offset - anchoredAt) / span); });
            if (difference != 0) outputLength.setLength(actual);
            anchoredAt = actual;
            sinceAnchor = [];
        }
    }

    for (const turn of turns) {
        for (const paragraph of turn.paragraphs) {
            if (paragraph.offset in flowAtOffset) continue;
            // Ask about the middle of the paragraph, so a few characters' difference in
            // where it starts doesn't matter
            const location = await lookUp(Math.max(0, paragraph.offset + paragraph.shift + Math.floor(paragraph.length / 2)));
            if (isStale()) return;
            flowAtOffset[paragraph.offset] = location && location.filename ? flowIdAt(location.filename, location.lineNumber) : null;
        }
    }
}

// Looks up the source of any text not yet resolved, one paragraph at a time, then calls
// back. inklecate can only answer while the story is waiting for a choice, so this is
// called at the end of each turn.
function resolve(callback) {
    if (resolving) { callback(); return; }
    resolving = true;
    const startedIn = generation;
    const isStale = () => startedIn != generation;
    resolveAll(isStale)
        .catch(err => console.error('PlayPath.resolve', err))
        .then(() => {
            if (!isStale()) resolving = false;
            callback();
        });
}

exports.PlayPath = {
    reset,
    trackOutputLength,
    textAdded,
    choiceOffered,
    choiceMade,
    jumped,
    summary,
    resolve
};
