// Media tag support shared by Inky's player and the exported web player, so that
// images and audio behave the same while writing as they do once published.
//
// Plain browser JavaScript with no dependencies: the web export copies this file
// as-is, and Inky loads it with require().
//
// Supported tags (either "KEY: value" or "KEY value"):
//   # IMAGE temple.png         image shown after the line (from images/)
//   # AUDIO door.wav           sound effect, played once (from audio/)
//   # AUDIOLOOP forest         background loop, replacing any current loop
//   # AUDIOSTOP                fade out everything
//   # AUDIOSTOP: loop          fade out the loop only
//   # AUDIOSTOP: once          fade out sound effects only
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.InkMedia = factory();
}(typeof self !== 'undefined' ? self : this, function () {

    var IMAGE_FOLDER = 'images';
    var AUDIO_FOLDER = 'audio';

    // Extensions to try, in order, when an audio tag leaves the extension off
    var AUDIO_EXTENSIONS = {
        AUDIO:     ['.wav', '.mp3', '.ogg'],
        AUDIOLOOP: ['.mp3', '.ogg', '.wav']
    };

    // Splits "KEY: value", "KEY value" or a bare "KEY" into { property, val }.
    // The property is upper-cased so tags are case-insensitive.
    function parseTag(tag) {
        if (typeof tag !== 'string') return null;
        var match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*|\s+|$)([\s\S]*)$/.exec(tag);
        if (!match) return null;
        return { property: match[1].toUpperCase(), val: match[2].trim() };
    }

    function isMediaProperty(property) {
        return property === 'IMAGE' || property === 'BACKGROUND' ||
               property === 'AUDIO' || property === 'AUDIOLOOP';
    }

    // Paths to try for a media tag, relative to the folder holding the main ink
    // file (or the exported index.html), using forward slashes.
    function candidatePaths(property, val) {
        var name = (val || '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
        if (!name) return [];

        var names, folders;
        if (property === 'IMAGE' || property === 'BACKGROUND') {
            names = [name];
            folders = [IMAGE_FOLDER, ''];
        } else if (property === 'AUDIO' || property === 'AUDIOLOOP') {
            var hasExtension = /\.[a-z0-9]+$/i.test(name);
            names = hasExtension ? [name] : AUDIO_EXTENSIONS[property].map(function (ext) { return name + ext; });
            // images/ is still checked for audio, since older projects kept it there
            folders = [AUDIO_FOLDER, IMAGE_FOLDER, ''];
        } else {
            return [];
        }

        var paths = [];
        folders.forEach(function (folder) {
            names.forEach(function (n) {
                var p = folder ? folder + '/' + n : n;
                if (paths.indexOf(p) === -1) paths.push(p);
            });
        });
        return paths;
    }

    // Returns the first candidate path for which exists(path) is true, or null.
    function resolve(property, val, exists) {
        var paths = candidatePaths(property, val);
        for (var i = 0; i < paths.length; i++) {
            if (exists(paths[i])) return paths[i];
        }
        return null;
    }

    function folderFor(property) {
        return property === 'AUDIO' || property === 'AUDIOLOOP' ? AUDIO_FOLDER : IMAGE_FOLDER;
    }

    // Fades an audio element out over durationMs, then stops it and removes it from the page.
    function fadeOutAndRemove(el, durationMs) {
        function finish() {
            try { el.pause(); } catch (_) {}
            if (el.parentNode) el.parentNode.removeChild(el);
        }
        if (!durationMs || el.paused || el.volume === 0) { finish(); return; }

        var steps = Math.max(1, Math.floor(durationMs / 50));
        var stepAmount = el.volume / steps;
        var count = 0;
        var timer = setInterval(function () {
            count++;
            try { el.volume = Math.max(0, el.volume - stepAmount); } catch (_) {}
            if (count >= steps || el.volume <= 0) {
                clearInterval(timer);
                finish();
            }
        }, 50);
    }

    // Plays one background loop plus any number of overlapping sound effects.
    //   options.fadeMs    - fade-out length when stopping (default 500)
    //   options.onCreate  - called with each new <audio> element, before it plays
    function AudioPlayer(options) {
        options = options || {};
        this.fadeMs = options.fadeMs != null ? options.fadeMs : 500;
        this.onCreate = options.onCreate || null;
        this.muted = false;
        this.loop = null;       // { el, src }
        this.oneShots = [];

        // Browsers block audio until the player has clicked or pressed a key, which
        // silences a loop that starts on the very first line. Retry it on first input.
        var self = this;
        if (typeof document !== 'undefined') {
            var retry = function () {
                if (self.loop && self.loop.el.paused) self._start(self.loop.el);
            };
            document.addEventListener('pointerdown', retry, true);
            document.addEventListener('keydown', retry, true);
        }
    }

    AudioPlayer.prototype._create = function (src, loop) {
        var el = document.createElement('audio');
        el.src = src;
        el.loop = loop;
        el.muted = this.muted;
        el.preload = 'auto';
        if (this.onCreate) this.onCreate(el);
        return el;
    };

    AudioPlayer.prototype._start = function (el) {
        var playing = el.play();
        if (playing && playing.catch) playing.catch(function () {});
    };

    // Plays a sound effect once. Returns its <audio> element.
    AudioPlayer.prototype.playOnce = function (src) {
        var self = this;
        var el = this._create(src, false);
        this.oneShots.push(el);
        el.addEventListener('ended', function () {
            self.oneShots = self.oneShots.filter(function (a) { return a !== el; });
            if (el.parentNode) el.parentNode.removeChild(el);
        });
        this._start(el);
        return el;
    };

    // Starts a background loop, replacing any other loop. If the same file is
    // already looping it carries on uninterrupted. Returns its <audio> element.
    AudioPlayer.prototype.playLoop = function (src) {
        if (this.loop && this.loop.src === src) {
            if (this.loop.el.paused) this._start(this.loop.el);
            return this.loop.el;
        }
        this.stopLoop();
        var el = this._create(src, true);
        this.loop = { el: el, src: src };
        this._start(el);
        return el;
    };

    AudioPlayer.prototype.stopLoop = function (fadeMs) {
        if (!this.loop) return;
        var el = this.loop.el;
        this.loop = null;
        fadeOutAndRemove(el, fadeMs != null ? fadeMs : this.fadeMs);
    };

    AudioPlayer.prototype.stopOneShots = function (fadeMs) {
        var els = this.oneShots;
        this.oneShots = [];
        var ms = fadeMs != null ? fadeMs : this.fadeMs;
        els.forEach(function (el) { fadeOutAndRemove(el, ms); });
    };

    // Handles the AUDIOSTOP tag's value: "" (everything), "loop" or "once".
    AudioPlayer.prototype.stop = function (which) {
        which = (which || '').trim().toLowerCase();
        if (!which || which === 'loop') this.stopLoop();
        if (!which || which === 'once') this.stopOneShots();
    };

    // Stops everything immediately, e.g. when restarting the story.
    AudioPlayer.prototype.stopAllNow = function () {
        this.stopLoop(0);
        this.stopOneShots(0);
    };

    AudioPlayer.prototype.setMuted = function (muted) {
        this.muted = !!muted;
        this.elements().forEach(function (el) { el.muted = !!muted; });
    };

    AudioPlayer.prototype.elements = function () {
        return (this.loop ? [this.loop.el] : []).concat(this.oneShots);
    };

    AudioPlayer.prototype.currentLoopSrc = function () {
        return this.loop ? this.loop.src : null;
    };

    return {
        IMAGE_FOLDER: IMAGE_FOLDER,
        AUDIO_FOLDER: AUDIO_FOLDER,
        parseTag: parseTag,
        isMediaProperty: isMediaProperty,
        candidatePaths: candidatePaths,
        resolve: resolve,
        folderFor: folderFor,
        AudioPlayer: AudioPlayer
    };
}));
