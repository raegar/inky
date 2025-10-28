const $ = window.jQuery = require('./jquery-2.2.3.min.js');
const i18n = require('./i18n.js');
const path = require("path");
const url = require('url'); // Add this at the top

var events = {};
var lastFadeTime = 0;
var $textBuffer = null;
var instructionPrefix = null;
var animationEnabled = true;
let _oneShotPool = [];   // holds all current single-shot SFX
let _audioLoopEl  = null; // still just one looping track
let audioControlsVisible = true; // global toggle for <audio> controls
let audioMuted = false; // global mute

// Fade an HTMLAudioElement's volume to 0 over durationMs, then pause and optionally remove
function _fadeOutAndStopAudio(el, durationMs = 500, removeFromDom = true) {
    try {
        if (!el) return Promise.resolve();
        // If already paused or silent, just stop/remove immediately
        if (el.paused || el.volume === 0) {
            try { el.pause(); } catch(_){}
            try { if (removeFromDom) el.remove(); } catch(_){}
            return Promise.resolve();
        }

        const steps = Math.max(1, Math.floor(durationMs / 50));
        const stepAmount = el.volume / steps;
        return new Promise(resolve => {
            let count = 0;
            const id = setInterval(() => {
                try {
                    el.volume = Math.max(0, el.volume - stepAmount);
                    count++;
                    if (count >= steps || el.volume <= 0) {
                        clearInterval(id);
                        try { el.pause(); } catch(_){}
                        try { if (removeFromDom) el.remove(); } catch(_){}
                        // Reset volume back to 1 in case the element is reused (loop element)
                        try { el.volume = 1; } catch(_){}
                        resolve();
                    }
                } catch(_) {
                    clearInterval(id);
                    try { el.pause(); } catch(_2){}
                    try { if (removeFromDom) el.remove(); } catch(_3){}
                    resolve();
                }
            }, 50);
        });
    } catch(_) {
        try { el.pause(); } catch(_2){}
        try { if (removeFromDom) el.remove(); } catch(_3){}
        return Promise.resolve();
    }
}





document.addEventListener("keyup", function(){
    $("#player").removeClass("altKey");
});
document.addEventListener("keydown", function(){
    $("#player").addClass("altKey");
});

// Initial default: append to visible buffer
$textBuffer = $("#player .innerText.active");

function shouldAnimate() {
    return $textBuffer.hasClass("active");
}

function showSessionView(sessionId) {
    var $player = $("#player");

    var $hiddenContainer = $player.find(".hiddenBuffer");
    var $hidden = $hiddenContainer.find(".innerText");

    var $active = $("#player .innerText.active");
    if( $active.data("sessionId") == sessionId ) {
        return;
    }

    if( $hidden.data("sessionId") == sessionId ) {
        // Swap buffers
        $active.removeClass ("active");
        $hiddenContainer.append($active);
        $hidden.insertBefore($hiddenContainer);
        $hidden.addClass("active");

        // Also make this the active buffer
        $textBuffer = $hidden;
    }
}

function fadeIn($jqueryElement) {

    const minimumTimeSeparation = 200;
    const animDuration = 1000;

    var currentTime = Date.now();
    var timeSinceLastFade = currentTime - lastFadeTime;

    var delay = 0;
    if( timeSinceLastFade < minimumTimeSeparation )
        delay = minimumTimeSeparation - timeSinceLastFade;

    $jqueryElement.css("opacity", 0);
    $jqueryElement.delay(delay).animate({opacity: 1.0}, animDuration);

    lastFadeTime = currentTime + delay;
}

function contentReady() {

    var $scrollContainer = $("#player .scrollContainer");
    $scrollContainer.stop();

    // Need to save these ones because we are resetting height, so these are lost
    var savedScrollTop = $scrollContainer.scrollTop();
    var prevHeight = $textBuffer.height();

    // Need to reset first, otherwise ($textBuffer[0].scrollHeight) is always not less than $textBuffer.height() and it only expands (bad when story has huge list of choices)
    $textBuffer.height(0);
    var newHeight = $textBuffer[0].scrollHeight;

    // Expand to fit or keep same (we will shrink it later, after animating scroll, this way scroll animation is prettier)
    if( prevHeight < newHeight ) {
        $textBuffer.height(newHeight);
    } else {
        $textBuffer.height(prevHeight);
    }

    // Scroll?
    if( shouldAnimate() ) {
        
        var offset = newHeight + 60 - $scrollContainer.outerHeight(); // +60 because: ("#player .innerText { padding: 10px 0 50px 0; }")

        // Need to set previous, as it was reset when we reset height
        $scrollContainer.animate({scrollTop: savedScrollTop}, 0);

        $scrollContainer.animate({
            scrollTop: (offset)
        }, animationEnabled ? 500 : 100, function(){
            // Shrink, if needed
            if( prevHeight > newHeight ) {
                $textBuffer.height(newHeight);
            }
        });

    }
}

function prepareForNewPlaythrough(sessionId) {
    // stop and clear all one-shot sounds
    _oneShotPool.forEach(a => { try { a.pause(); } catch(_){} });
    _oneShotPool = [];

    // stop and clear loop
    if (_audioLoopEl) { _audioLoopEl.pause(); _audioLoopEl.src = ""; _audioLoopEl = null; }

    $textBuffer = $("#player .hiddenBuffer .innerText");
    $textBuffer.data("sessionId", sessionId);

    $textBuffer.text("");
    $textBuffer.height(0);
    try { _ensureImageSizer(); _refreshImageSizingSoon(); } catch(_) {}
}


function addTextSection(text)
{
    var $paragraph = $("<p class='storyText'></p>");

    // Game-specific instruction prefix, e.g. >>> START CAMERA: Wide shot
    if( instructionPrefix && text.trim().startsWith(instructionPrefix) ) {
        $paragraph.addClass("customInstruction");
    }

    // Split individual words into span tags, so that they can be underlined
    // when the user holds down the alt key, and so that they can be individually
    // clicked in order to jump to the source.
    var splitIntoSpans = text.split(" ");
    var textAsSpans = "<span>" + splitIntoSpans.join("</span> <span>") + "</span>";

    $paragraph.html(textAsSpans);

    // Keep track of the offset of each word into the content,
    // starting from the end of the last choice (it's global in the current play session)
    var previousContentLength = 0;
    var $existingLastContent = $textBuffer.children(".storyText").last();
    if( $existingLastContent ) {
        var range = $existingLastContent.data("range");
        if( range ) {
            previousContentLength = range.start + range.length + 1; // + 1 for newline
        }
    }
    $paragraph.data("range", {start: previousContentLength, length: text.length});

    // Append the actual content
    $textBuffer.append($paragraph);

    // Find the offset of each word in the content, for clickability
    var offset = previousContentLength;
    $paragraph.children("span").each((i, element) => {
        var $span = $(element);
        var length = $span.text().length;
        $span.data("range", {start: offset, length: length});
        offset += length + 1; // extra 1 for space
    });

    // Alt-click handler to jump to source
    $paragraph.find("span").click(function(e) {
        if( e.altKey ) {

            var range = $(this).data("range");
            if( range ) {
                var midOffset = Math.floor(range.start + range.length/2);
                events.jumpToSource(midOffset);
            }

            e.preventDefault();
        }
    });

    if( animationEnabled && shouldAnimate() )
        fadeIn($paragraph);
}

let currentInkFile = null;

function setCurrentInkFile(inkFile) {
    currentInkFile = inkFile;
}

function _splitPropertyTagFlexible(tag) {
    // Accept both "KEY value" and "KEY: value"
    if (!tag || typeof tag !== "string") return null;
    const trimmed = tag.trim();
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx > -1) {
        return {
            property: trimmed.substring(0, colonIdx).trim().toUpperCase(),
            val: trimmed.substring(colonIdx + 1).trim()
        };
    } else {
        const firstSpace = trimmed.indexOf(" ");
        if (firstSpace > -1) {
            return {
                property: trimmed.substring(0, firstSpace).trim().toUpperCase(),
                val: trimmed.substring(firstSpace + 1).trim()
            };
        }
    }
    return null;
}


function addTags(tags)
{
    if (!tags || !Array.isArray(tags) || tags.length === 0) return;

    const fs = require('fs');

    // Collect any tags we don't explicitly handle so we can show them as text.
    const remaining = [];
    let handledSomething = false;

    // Helper: append-and-fade convenience
    const appendAndMaybeFade = ($el) => {
        $textBuffer.append($el);
        if (animationEnabled && shouldAnimate()) fadeIn($el);
    };

    // Iterate every tag on the line; handle all that we recognise
    for (const rawTag of tags) {
        const s = _splitPropertyTagFlexible(rawTag);
        if (!s) { remaining.push(rawTag); continue; }

        switch (s.property) {

            case "IMAGE": {
                if (!currentInkFile || !s.val) { remaining.push(rawTag); break; }

                const imgAbsPath = path.join(currentInkFile.projectDir, 'images', s.val);
                const fileUrl = url.pathToFileURL(imgAbsPath).href;

                const $img = $(`<img class='storyImage' src='${fileUrl}' alt='${s.val}'/>`);
                $img.on('error', () => {
                    appendAndMaybeFade($(`<p class='error'>Image not found: ${s.val}</p>`));
                    try { $img.remove(); } catch(_) {}
                });
                appendAndMaybeFade($img);
                // Ensure images never exceed the visible player height
                try { _ensureImageSizer(); _refreshImageSizingSoon(); } catch(_) {}
                handledSomething = true;
                break;
            }

            case "AUDIO": {
                if (!currentInkFile || !s.val) { remaining.push(rawTag); break; }

                /* 1. Resolve filename (adds .wav/.mp3/.ogg if omitted) */
                const hasExt = /\.[a-z0-9]+$/i.test(s.val.trim());
                const names = hasExt
                    ? [s.val.trim()]
                    : [s.val.trim(), s.val.trim()+'.wav', s.val.trim()+'.mp3', s.val.trim()+'.ogg'];

                const candidates = [];
                for (const name of names) {
                    candidates.push(path.join(currentInkFile.projectDir, 'audio', name));
                    candidates.push(path.join(currentInkFile.projectDir, 'images', name)); // legacy
                }

                const audioAbsPath = candidates.find(p => fs.existsSync(p));
                if (!audioAbsPath) {
                    appendAndMaybeFade($(`<p class='error'>AUDIO not found: ${s.val}</p>`));
                    console.warn('[Inky AUDIO] tried:', candidates);
                    handledSomething = true;
                    break;
                }

                const audioUrl = url.pathToFileURL(audioAbsPath).href;

                /* 2. Create a fresh <audio> element */
                const el = document.createElement('audio');
                el.src      = audioUrl;
                el.controls = audioControlsVisible;
                el.muted    = audioMuted;
                el.preload  = 'auto';

                // Start only when buffered ⇒ avoids 0:00/0:00 race
                el.addEventListener('canplaythrough', () => {
                    el.play().catch(()=>{});
                }, { once:true });

                // Remove from pool & DOM when finished
                el.addEventListener('ended', () => {
                    try { el.remove(); } catch(_) {}
                    _oneShotPool = _oneShotPool.filter(a => a !== el);
                });

                /* 3. Track and display it */
                _oneShotPool.push(el);
                appendAndMaybeFade($(el).css({ display:'block', margin:'0.5em 0' }));

                handledSomething = true;
                break;
            }


            /* ----------  AUDIOLOOP (background loop)  ---------- */
            case "AUDIOLOOP": {
                if (!currentInkFile || !s.val) { remaining.push(rawTag); break; }

                const hasExt = /\.[a-z0-9]+$/i.test(s.val.trim());
                const names = hasExt
                    ? [s.val.trim()]
                    : [s.val.trim()+'.mp3', s.val.trim()+'.ogg', s.val.trim()+'.wav']; // prefer streaming formats first

                const candidates = [];
                for (const name of names) {
                    candidates.push(path.join(currentInkFile.projectDir, 'audio', name));
                    candidates.push(path.join(currentInkFile.projectDir, 'images', name));
                }

                let loopAbsPath = candidates.find(p => fs.existsSync(p));
                if (!loopAbsPath) {
                    appendAndMaybeFade($(`<p class='error'>AUDIOLOOP not found: ${s.val}</p>`));
                    console.warn('[Inky AUDIOLOOP] tried:', candidates);
                    handledSomething = true;
                    break;
                }

                const loopUrl = url.pathToFileURL(loopAbsPath).href;
                console.log('[Inky AUDIOLOOP] resolved ->', loopUrl);

                // stop previous loop
                if (_audioLoopEl) { _audioLoopEl.pause(); _audioLoopEl.src=''; _audioLoopEl=null; }

                _audioLoopEl = document.createElement('audio');
                _audioLoopEl.src      = loopUrl;
                _audioLoopEl.loop     = true;
                _audioLoopEl.controls = audioControlsVisible;
                _audioLoopEl.muted    = audioMuted;
                _audioLoopEl.preload  = 'auto';

                // Start when ready
                _audioLoopEl.addEventListener('canplaythrough', () => {
                    _audioLoopEl.play().catch(()=>{});
                }, { once: true });

                // Extra safety: ensure looping continues even if the 'loop' flag fails in some environments
                _audioLoopEl.addEventListener('ended', () => {
                    try {
                        if (_audioLoopEl) {
                            _audioLoopEl.currentTime = 0;
                            _audioLoopEl.play().catch(()=>{});
                        }
                    } catch(_) {}
                });

                const $audioLoop = $(_audioLoopEl).css({ display:'block', margin:'0.5em 0' });
                appendAndMaybeFade($audioLoop);
                handledSomething = true;
                break;
            }

            /* ----------  AUDIOSTOP  ---------- */
            case "AUDIOSTOP": {
                // Accept forms:
                //   # AUDIOSTOP          → stop loop + all one-shots
                //   # AUDIOSTOP: loop    → stop loop only
                //   # AUDIOSTOP: once    → stop all one-shots only
                const arg = (s.val || "").trim().toLowerCase();

                // New behavior: fade and stop audio gracefully
                const doLoop = (!arg || arg === "loop");
                const doOnce = (!arg || arg === "once");

                // Capture references to avoid affecting newer audio started later in the same turn
                const loopToStop = doLoop ? _audioLoopEl : null;
                const oneShotsToStop = doOnce ? _oneShotPool.slice() : [];

                const fades = [];
                if (loopToStop) {
                    fades.push(_fadeOutAndStopAudio(loopToStop, 500));
                }
                if (oneShotsToStop.length > 0) {
                    for (const el of oneShotsToStop) fades.push(_fadeOutAndStopAudio(el, 500));
                }

                Promise.allSettled(fades).finally(() => {
                    if (loopToStop && _audioLoopEl === loopToStop) {
                        try { _audioLoopEl.src = ""; } catch(_){}
                        _audioLoopEl = null;
                    }
                    if (doOnce) {
                        _oneShotPool = _oneShotPool.filter(a => oneShotsToStop.indexOf(a) === -1);
                    }
                });

                handledSomething = true;
                break;

                // stop loop?
                if (!arg || arg === "loop") {
                    if (_audioLoopEl) {
                        _audioLoopEl.pause();
                        _audioLoopEl.src = "";
                        try { _audioLoopEl.remove(); } catch(_) {}
                        _audioLoopEl = null;
                    }
                }

                // stop single-shot pool?
                if (!arg || arg === "once") {
                    _oneShotPool.forEach(a => { try { a.pause(); a.remove(); } catch(_){} });
                    _oneShotPool = [];
                }

                handledSomething = true;
                break;
            }


            default:
                remaining.push(rawTag);
                break;
        }
    }

    // Show any unhandled tags as plain text (keeps your previous behaviour)
    if (remaining.length > 0) {
        const tagsStr = remaining.join(", ");
        const $tags = $(`<p class='tags'># ${tagsStr}</p>`);
        appendAndMaybeFade($tags);
    }

    // If we handled something (image/audio), we’re done.
    if (handledSomething) return;
}



function addChoice(choice, callback)
{
    // New format (since ink can have tags directly on choices)
    // choice: {
    //    choice: {
    //      text: "this is a choice",
    //      tags: ["a tag", "another tag"]
    //    },
    //    ... other stuff, e.g. choice number ...
    // }
    var $choice = $("<a href='#'>"+choice.choice.text+"</a>");
    var $tags = null;
    if( choice.choice.tags != null && choice.choice.tags.length > 0 ) {
        var tagsStr = "# " + choice.choice.tags.join(" # ");
        $tags = $(` <span class='tags'>${tagsStr}</span>`);
    }

    // Append the choice
    var $choicePara = $("<p class='choice'></p>");
    $choicePara.append($choice);
    if( $tags != null ) $choicePara.append($tags);
    $textBuffer.append($choicePara);

    // Fade it in
    if( animationEnabled && shouldAnimate() )
        fadeIn($choicePara);

    // When this choice is clicked...
    $choice.on("click", (event) => {

        var existingHeight = $textBuffer.height();
        $textBuffer.height(existingHeight);

        // Remove any existing choices, and add a divider
        $(".choice").remove();

        addHorizontalDivider();

        event.preventDefault();

        callback();
    });
}

function addTerminatingMessage(message, cssClass)
{
    var $message = $(`<p class='${cssClass}'>${message}</p>`);
    $textBuffer.append($message);

    if( animationEnabled && shouldAnimate() )
        fadeIn($message);
}

function addLongMessage(message, cssClass)
{
    var $message = $(`<pre class='${cssClass}'>${message}</pre>`);
    $textBuffer.append($message);

    if( animationEnabled && shouldAnimate() )
        fadeIn($message);
}

function addHorizontalDivider()
{
    if (($textBuffer[0].lastChild == null) || ($textBuffer[0].lastChild.tagName != "HR")) {
        $textBuffer.append("<hr/>");
    }
}

function addLineError(error, callback)
{
    var $aError = $(`<a href='#'>${i18n._("Line")} ${error.lineNumber}: ${error.message}</a>`);
    $aError.on("click", callback);

    var $paragraph = $("<p class='error'></p>");
    $paragraph.append($aError);
    $textBuffer.append($paragraph);
}

function addEvaluationResult(result, error)
{   
    var $result;
    if( error ) {
        $result = $(`<div class="evaluationResult error"><span>${error}</span></div>`);
    } else {
        $result = $(`<div class="evaluationResult"><span>${result}</span></div>`);
    }
    $textBuffer.append($result);
}

function previewStepBack()
{
    var $lastDivider = $("#player .innerText.active").find("hr").last();
    $lastDivider.nextAll().remove();
    $lastDivider.remove();
}

function setInstructionPrefix(prefix) {
    if( instructionPrefix == prefix ) return;

    instructionPrefix = prefix;

    // Refresh any existing content
    let $storyChunks = $textBuffer.find("p.storyText");
    for(let storyChunk of $storyChunks) {
        let $storyChunk = $(storyChunk);
        $storyChunk.removeClass("customInstruction");

        if( storyChunk.textContent.trim().startsWith(instructionPrefix) ) {
            $storyChunk.addClass("customInstruction");
        }
    }
}

function setAnimationEnabled(animEnabled) {
    animationEnabled = animEnabled;
}

// --- Responsive image sizing -------------------------------------------------
let _imgSizerRO = null;
function _refreshImageSizing() {
    try {
        const sc = document.querySelector('#player .scrollContainer');
        if (!sc) return;
        // Leave a little breathing room for margins/padding
        const avail = Math.max(1, sc.clientHeight - 24);
        const imgs = document.querySelectorAll('#player img.storyImage');
        imgs.forEach(img => { img.style.maxHeight = avail + 'px'; });
    } catch(_) {}
}
function _refreshImageSizingSoon() { setTimeout(_refreshImageSizing, 0); }
function _ensureImageSizer() {
    try {
        const sc = document.querySelector('#player .scrollContainer');
        if (!sc) return;
        if (!_imgSizerRO) {
            _imgSizerRO = new ResizeObserver(() => _refreshImageSizing());
            _imgSizerRO.observe(sc);
            window.addEventListener('resize', _refreshImageSizing);
        }
    } catch(_) {}
}

exports.PlayerView = {
    setEvents: (e) => { events = e; },
    contentReady: contentReady,
    prepareForNewPlaythrough: prepareForNewPlaythrough,
    addTextSection: addTextSection,
    addTags: addTags,
    addChoice: addChoice,
    addTerminatingMessage: addTerminatingMessage,
    addLongMessage: addLongMessage,
    addHorizontalDivider: addHorizontalDivider,
    addLineError: addLineError,
    addEvaluationResult: addEvaluationResult,
    showSessionView: showSessionView,
    previewStepBack: previewStepBack,
    setInstructionPrefix: setInstructionPrefix,
    setAnimationEnabled: setAnimationEnabled,
    setCurrentInkFile: setCurrentInkFile,
    setAudioControlsVisible: (visible) => {
        audioControlsVisible = !!visible;
        try {
            const nodes = document.querySelectorAll('#player audio');
            nodes.forEach(n => { n.controls = audioControlsVisible; });
        } catch(_) {}
    },
    setAudioMuted: (muted) => {
        audioMuted = !!muted;
        try {
            const nodes = document.querySelectorAll('#player audio');
            nodes.forEach(n => { n.muted = audioMuted; });
        } catch(_) {}
    }
};
