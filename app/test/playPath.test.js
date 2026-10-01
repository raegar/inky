const assert = require('assert');
const path = require('path');

// PlayPath asks LiveCompiler (and so inklecate) where text came from. Stand in for both
// with a fake story output, counted the way inklecate counts it: including the text of
// tags and any extra spaces from the source, which the player doesn't see.
function stub(relativePath, exports) {
    const filename = require.resolve(path.join('..', 'renderer', relativePath));
    require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

let rawOutput = [];   // [{ length, line }] in output order
let lookups = 0;
stub('liveCompiler.js', { LiveCompiler: {
    getLocationInSource: (offset, callback) => {
        lookups++;
        let start = 0;
        for (const segment of rawOutput) {
            if (offset >= start && offset < start + segment.length) {
                setImmediate(() => callback({ filename: 'story.ink', lineNumber: segment.line }));
                return;
            }
            start += segment.length;
        }
        setImmediate(() => callback({ filename: undefined, lineNumber: NaN }));
    }
} });

// Source lines 1-9 are in knot "a", 10-19 in "b", 20+ in "c"
const knotForLine = (line) => line < 10 ? 'a' : line < 20 ? 'b' : 'c';
stub('inkProject.js', { InkProject: { currentProject: {
    inkFileWithRelativePath: () => ({ symbols: { flowAtPos: ({ row }) => ({ Knot: { name: knotForLine(row + 1) } }) } })
} } });

const { PlayPath } = require('../renderer/playPath.js');

// The player's count of the output: just the text it shows
let playerLength = 0;
let correctedTo = null;
PlayPath.trackOutputLength({ length: () => playerLength, setLength: (n) => { correctedTo = n; playerLength = n; } });

// Adds a line of story text from a source line. `hidden` is how many more characters
// inklecate counts than the player shows (a tag's text, extra spaces...).
function addLine(text, line, hidden = 0) {
    PlayPath.textAdded(playerLength, text.length);
    playerLength += text.length;
    rawOutput.push({ length: text.length + hidden, line });
}

const resolve = () => new Promise(done => PlayPath.resolve(done));
const flows = () => PlayPath.summary().map(turn => turn.flows);

describe('PlayPath', function () {

    beforeEach(function () {
        PlayPath.reset();
        rawOutput = [];
        playerLength = 0;
        correctedTo = null;
        lookups = 0;
    });

    it('finds where each paragraph came from when the counts agree', async function () {
        addLine('In the first knot.\n', 2);
        addLine('Still in the first knot.\n', 3);
        PlayPath.choiceOffered(1, 'Go');
        PlayPath.choiceMade(1);
        addLine('In the second knot.\n', 11);
        await resolve();
        assert.deepStrictEqual(flows(), [['a'], ['b']]);
        assert.strictEqual(correctedTo, null);
    });

    it('re-anchors its count when inklecate counts more, e.g. the text of tags', async function () {
        addLine('A picture follows.\n', 2, 19);          // "... # IMAGE clearing.jpg"
        addLine('And a sound.\n', 3, 17);                // "... # AUDIO birds.wav"
        PlayPath.choiceOffered(1, 'Go');
        await resolve();
        assert.strictEqual(correctedTo, 18 + 1 + 19 + 12 + 1 + 17);

        // The next turn carries on from inklecate's count
        PlayPath.choiceMade(1);
        addLine('Short.\n', 12);
        addLine('Shorter.\n', 21);
        await resolve();
        assert.deepStrictEqual(flows(), [['a'], ['b', 'c']]);
    });

    it('takes just two lookups to confirm the count when it was right', async function () {
        addLine('Some text.\n', 2);
        PlayPath.choiceOffered(1, 'Go');
        await resolve();
        lookups = 0;
        PlayPath.choiceMade(1);
        addLine('More text.\n', 12);
        await resolve();
        assert.strictEqual(lookups, 2 + 1);   // measuring, then the new paragraph
    });

    it('copes with drift built up over several turns before the graph is opened', async function () {
        // Each line has a few hidden characters, so by the last turn the player's count is
        // well behind inklecate's
        const lines = [[2, 'a'], [3, 'a'], [12, 'b'], [13, 'b'], [22, 'c'], [23, 'c'], [4, 'a'], [14, 'b']];
        lines.forEach(([line], i) => {
            addLine(`Line number ${i} of the story, long enough to read.\n`, line, 4);
            PlayPath.choiceOffered(1, 'Next');
            PlayPath.choiceMade(1);
        });
        await resolve();
        assert.deepStrictEqual(flows().filter(f => f.length).map(f => f[0]), lines.map(([, knot]) => knot));
    });

    it('finds the end when the player has counted more than inklecate', async function () {
        addLine('No space before the hash.\n', 2, -1);
        addLine('Then another line.\n', 12);
        PlayPath.choiceOffered(1, 'Go');
        await resolve();
        assert.strictEqual(correctedTo, 26 - 1 + 19);
        assert.deepStrictEqual(flows(), [['a', 'b']]);
    });

    it('drops lookups from a playthrough that has been restarted', async function () {
        addLine('Old text.\n', 2);
        const finished = resolve();
        PlayPath.reset();
        await finished;
        assert.deepStrictEqual(flows(), [[]]);
    });
});
