// Finds the image and audio files that media tags refer to, in the project's images/ and
// audio/ folders. Used by the player, the missing-file warnings and tag autocompletion.
// The rules for which paths to try live in inkMedia.js, shared with the web export.

const path = require("path");
const fs = require("fs");
const url = require("url");
const InkMedia = require('../export-for-web-template/inkMedia.js');

// Directory listings, cached so that replaying a long story or checking every tag doesn't
// hit the disk each time. Cleared whenever the story is recompiled.
let dirCache = {};

function clearCache() {
    dirCache = {};
}

function listDir(dir) {
    if (!(dir in dirCache)) {
        try { dirCache[dir] = fs.readdirSync(dir); } catch(_) { dirCache[dir] = null; }
    }
    return dirCache[dir];
}

// Media folders live next to the main ink file, whichever file is being edited.
// Returns null if the project hasn't been saved yet.
function projectDirFor(inkFile) {
    if (!inkFile) return null;
    const mainInk = inkFile.isMain() ? inkFile : inkFile.mainInkFile;
    return (mainInk && mainInk.projectDir) || null;
}

// Looks for relPath under root, matching each folder/file name case-insensitively.
// Returns the path with its real capitalisation (and whether it matched exactly), or null.
function findFile(root, relPath) {
    let dir = root;
    const actual = [];
    for (const part of relPath.split('/')) {
        const entries = listDir(dir);
        if (!entries) return null;
        const found = entries.includes(part) ? part : entries.find(e => e.toLowerCase() === part.toLowerCase());
        if (!found) return null;
        actual.push(found);
        dir = path.join(dir, found);
    }
    return { path: actual.join('/'), exact: actual.join('/') === relPath };
}

// Finds the file for a media tag. Returns { url, path } (path relative to the project
// folder), or { error } with a message for the writer.
function resolve(projectDir, property, val) {
    const kind = property === 'IMAGE' || property === 'BACKGROUND' ? 'Image' : 'Audio';
    if (!projectDir) {
        return { error: `Save your project to use images and audio (${val})` };
    }

    const exact = InkMedia.resolve(property, val, p => { const f = findFile(projectDir, p); return f && f.exact; });
    if (exact) {
        return { url: url.pathToFileURL(path.join(projectDir, exact)).href, path: exact };
    }

    // Windows and macOS ignore capitalisation but web hosts don't, so a game that works
    // here would break once exported. Treat it as missing and say what's wrong.
    const loose = InkMedia.resolve(property, val, p => !!findFile(projectDir, p));
    if (loose) {
        // Suggest the name as they'd write it in the tag (i.e. without the folder, if they left it off)
        const actual = findFile(projectDir, loose).path;
        const suggestion = actual.split('/').slice(-val.split('/').length).join('/');
        return { error: `${kind} not found: ${val} - did you mean ${suggestion}? Capital letters matter once your game is on the web` };
    }

    return { error: `${kind} not found: ${val} (put it in the ${InkMedia.folderFor(property)}/ folder)` };
}

// Files a media tag could refer to, as they'd be written in the tag (relative to the
// images/ or audio/ folder), for autocompletion.
function listFiles(projectDir, property) {
    if (!projectDir) return [];
    const isAudio = property === 'AUDIO' || property === 'AUDIOLOOP';
    const extensions = isAudio ? InkMedia.AUDIO_FILE_TYPES : InkMedia.IMAGE_FILE_TYPES;
    const files = [];
    const walk = (dir, prefix) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch(_) { return; }
        for (const entry of entries) {
            if (entry.name.startsWith('.')) continue;
            if (entry.isDirectory()) walk(path.join(dir, entry.name), prefix + entry.name + '/');
            else if (extensions.includes(path.extname(entry.name).slice(1).toLowerCase())) files.push(prefix + entry.name);
        }
    };
    walk(path.join(projectDir, InkMedia.folderFor(property)), '');
    return files.sort();
}

// The media tags in a line's tag text, e.g. "# IMAGE: a.png # AUDIO b" (as the editor
// tokenises it). A tag whose file name is worked out as the story runs, like
// "# IMAGE panel{n}.png", is marked dynamic, with a pattern for the files it could mean.
function mediaTagsIn(tagText) {
    const tags = [];
    for (const part of tagText.split('#')) {
        let text = part;
        // A tag inside {cond: ... # IMAGE a.png} is tokenised with the closing brace
        if (text.indexOf('}') !== -1 && text.indexOf('{') === -1) text = text.slice(0, text.indexOf('}'));
        const tag = InkMedia.parseTag(text);
        if (!tag || !InkMedia.isMediaProperty(tag.property) || tag.property === 'BACKGROUND' || !tag.val) continue;
        if (tag.val.indexOf('{') !== -1) {
            const pattern = tag.val.split(/\{[^}]*\}?/).map(s => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&')).join('.*');
            tag.dynamic = new RegExp('^' + pattern + '$', 'i');
        }
        tags.push(tag);
    }
    return tags;
}

// Every media tag in the project: { property, val, inkFile, row, path, error, dynamic }.
// path is the file it refers to (relative to the project folder, e.g. "images/a.png"),
// or null if it's missing, with error saying why. Dynamic tags aren't resolved.
function scanTags(project) {
    const tags = [];
    if (!project) return tags;
    clearCache();
    const projectDir = projectDirFor(project.mainInk);

    for (const inkFile of project.files || []) {
        const session = inkFile.getAceSession();
        for (let row = 0; row < session.getLength(); row++) {
            for (const token of session.getTokens(row)) {
                if (token.type !== 'tag') continue;
                for (const tag of mediaTagsIn(token.value)) {
                    tag.inkFile = inkFile;
                    tag.row = row;
                    tag.path = null;
                    if (!tag.dynamic) {
                        const result = resolve(projectDir, tag.property, tag.val);
                        tag.path = result.path || null;
                        tag.error = result.error;
                    }
                    tags.push(tag);
                }
            }
        }
    }
    return tags;
}

// Whether any of the scanned tags uses the file at relPath (relative to the project
// folder), including tags whose file name is worked out as the story runs.
function isFileUsed(tags, relPath) {
    const name = relPath.split('/').pop();
    return tags.some(tag => tag.path === relPath || (tag.dynamic && tag.dynamic.test(name)));
}

// Returns an issue for each media tag whose file is missing, in the same form as the
// compiler's warnings, so they show in the issue list and the editor.
function findIssues(project) {
    return scanTags(project)
        .filter(tag => tag.error)
        .map(tag => ({
            type: "WARNING",
            filename: tag.inkFile.relativePath(),
            lineNumber: tag.row + 1,
            message: tag.error
        }));
}

exports.ProjectMedia = {
    clearCache,
    projectDirFor,
    resolve,
    listFiles,
    mediaTagsIn,
    scanTags,
    isFileUsed,
    findIssues
};
