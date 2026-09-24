// Tracks the route the current playthrough has taken through the story, for the
// Narrative Flow graph. For each turn it records where the text came from (as offsets
// into the story's output, which inklecate can map back to source lines) and which
// choice was taken. Resolving offsets to knots is only done when asked, since it
// needs a round trip to inklecate for each paragraph.

const LiveCompiler = require('./liveCompiler.js').LiveCompiler;
const InkProject = require('./inkProject.js').InkProject;

let turns = [];            // { offsets: [], choices: [{ number, text }], chosen: text|null }
let flowAtOffset = {};     // offset -> flow id ("knot" or "knot.stitch"), once resolved
let resolving = false;
let generation = 0;        // bumped on reset, so lookups from an old playthrough are dropped

function currentTurn() {
    return turns[turns.length - 1];
}

function reset() {
    generation++;
    resolving = false;
    turns = [{ offsets: [], choices: [], chosen: null }];
    flowAtOffset = {};
}
reset();

function textAdded(offset) {
    currentTurn().offsets.push(offset);
}

function choiceOffered(number, text) {
    currentTurn().choices.push({ number, text });
}

// The story jumped to a knot ("Play from here"): a new turn, reached without a choice
function jumped() {
    turns.push({ offsets: [], choices: [], chosen: null });
}

function choiceMade(number) {
    const turn = currentTurn();
    const choice = turn.choices.find(c => c.number == number);
    turn.chosen = choice ? choice.text : null;
    turns.push({ offsets: [], choices: [], chosen: null });
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
        turn.offsets.forEach(offset => {
            const id = flowAtOffset[offset];
            if (id && flows[flows.length - 1] !== id) flows.push(id);
        });
        return { flows, chosen: turn.chosen };
    });
}

// Looks up the source of any text not yet resolved, one paragraph at a time, then calls
// back. inklecate can only answer while the story is waiting for a choice, so this is
// called at the end of each turn. A lookup that gets no answer (e.g. because an Alt-click
// asked for a different one at the same time) is skipped after a short wait.
function resolve(callback) {
    if (resolving) { callback(); return; }
    const pending = [];
    turns.forEach(turn => turn.offsets.forEach(offset => { if (!(offset in flowAtOffset)) pending.push(offset); }));
    if (pending.length == 0) { callback(); return; }

    resolving = true;
    const startedIn = generation;
    const next = () => {
        if (startedIn != generation) {
            callback();
            return;
        }
        if (pending.length == 0) {
            resolving = false;
            callback();
            return;
        }
        const offset = pending.shift();
        let answered = false;
        const done = (flowId) => {
            if (answered) return;
            answered = true;
            clearTimeout(timer);
            flowAtOffset[offset] = flowId;
            next();
        };
        const timer = setTimeout(() => done(null), 1000);
        // +1 so the offset is inside the paragraph's first word
        LiveCompiler.getLocationInSource(offset + 1, (location) => {
            done(location && location.filename ? flowIdAt(location.filename, location.lineNumber) : null);
        });
    };
    next();
}

exports.PlayPath = {
    reset,
    textAdded,
    choiceOffered,
    choiceMade,
    jumped,
    summary,
    resolve
};
