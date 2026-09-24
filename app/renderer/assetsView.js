// Assets panel: shows the images and audio in the project's images/ and audio/ folders,
// so they can be previewed and added to the story by clicking or dragging, and flags
// files no tag uses and tags whose file is missing.

const $ = window.jQuery = require('./jquery-2.2.3.min.js');
const path = require("path");
const url = require("url");
const { shell } = require("electron");
const InkMedia = require('../export-for-web-template/inkMedia.js');
const { ProjectMedia } = require('./projectMedia.js');
const InkProject = require('./inkProject.js').InkProject;
const EditorView = require('./editorView.js').EditorView;
const NavView = require('./navView.js').NavView;

// Drag data type for tags dragged from this panel into the editor (see controller.js)
const TAG_DRAG_TYPE = "application/x-inky-tag";

let events = {
    gotoLine: (inkFile, row) => {}
};

// One audio element for previewing files, separate from the story's audio
let preview = null;

function ensurePanel() {
    let $panel = $('#assets-wrapper');
    if ($panel.length) return $panel;

    $panel = $(`<div class="nav-wrapper hidden" id="assets-wrapper">
        <nav class="nav-group">
            <h5 class="nav-group-title">Assets</h5>
        </nav>
        <div class="assetsBody"></div>
    </div>`);
    $('.sidebar').append($panel);
    return $panel;
}

function stopPreview() {
    if (preview) {
        preview.el.pause();
        preview.$button.removeClass('playing').find('.icon').removeClass('icon-stop').addClass('icon-play');
        preview = null;
    }
}

function togglePreview(fileUrl, $button) {
    const wasThis = preview && preview.$button[0] === $button[0];
    stopPreview();
    if (wasThis) return;
    const el = new Audio(fileUrl);
    el.addEventListener('ended', stopPreview);
    el.play().catch(() => {});
    preview = { el, $button };
    $button.addClass('playing').find('.icon').removeClass('icon-play').addClass('icon-stop');
}

// Makes an element add a tag at the cursor when clicked, or where it's dropped in the editor
function makeTagSource($el, tag) {
    $el.attr('draggable', 'true');
    $el.attr('title', `Click to add "${tag}" at the cursor, or drag it into the story`);
    $el.on('click', (e) => {
        e.preventDefault();
        EditorView.insertTag(tag);
    });
    $el.on('dragstart', (e) => {
        const dt = e.originalEvent.dataTransfer;
        dt.setData(TAG_DRAG_TYPE, tag);
        dt.setData('text/plain', tag);
        dt.effectAllowed = 'copy';
    });
}

function section(title, count) {
    return $(`<div class="assetsSection"><h6 class="assetsSectionTitle"></h6></div>`)
        .find('h6').text(count === undefined ? title : `${title} (${count})`).end();
}

function folderButton(projectDir, folder) {
    return $(`<a href="#" class="assetsFolderLink">Open folder</a>`).on('click', (e) => {
        e.preventDefault();
        const dir = path.join(projectDir, folder);
        require('fs').mkdirSync(dir, { recursive: true });
        shell.openPath(dir);
    });
}

function render() {
    const $panel = ensurePanel();
    if ($panel.hasClass('hidden')) return;
    const $body = $panel.find('.assetsBody');
    const scrollTop = $body.scrollTop();
    stopPreview();
    $body.empty();

    const project = InkProject.currentProject;
    const projectDir = project && ProjectMedia.projectDirFor(project.mainInk);
    if (!projectDir) {
        $body.append($(`<p class="assetsEmpty">Save your project to add images and audio. They're kept in folders next to your main ink file.</p>`));
        $body.append($(`<p class="assetsEmpty">Or start with File → New Illustrated Story, which sets everything up for you.</p>`));
        return;
    }

    const tags = ProjectMedia.scanTags(project);
    const usedLabel = (relPath) => ProjectMedia.isFileUsed(tags, relPath) ? null : $(`<span class="assetsUnused" title="No tag in your story uses this file yet">unused</span>`);

    // Images: thumbnails, click or drag to add
    const images = ProjectMedia.listFiles(projectDir, 'IMAGE');
    const $images = section('Images', images.length);
    $images.find('h6').append(folderButton(projectDir, InkMedia.IMAGE_FOLDER));
    if (images.length == 0) {
        $images.append($(`<p class="assetsEmpty">No images yet. Drag pictures onto the editor, or use Media → Images → Insert Image.</p>`));
    } else {
        const $grid = $(`<div class="assetsGrid"></div>`);
        for (const name of images) {
            const relPath = `${InkMedia.IMAGE_FOLDER}/${name}`;
            const $item = $(`<div class="assetsImage"><div class="assetsThumb"><img loading="lazy"/></div><div class="assetsName"></div></div>`);
            $item.find('img').attr('src', url.pathToFileURL(path.join(projectDir, relPath)).href).attr('alt', name);
            $item.find('.assetsName').text(name).append(usedLabel(relPath));
            makeTagSource($item, `# IMAGE ${name}`);
            $grid.append($item);
        }
        $images.append($grid);
    }
    $body.append($images);

    // Audio: preview, and add as a sound effect or a loop
    const sounds = ProjectMedia.listFiles(projectDir, 'AUDIO');
    const $audio = section('Audio', sounds.length);
    $audio.find('h6').append(folderButton(projectDir, InkMedia.AUDIO_FOLDER));
    if (sounds.length == 0) {
        $audio.append($(`<p class="assetsEmpty">No audio yet. Drag sound files onto the editor, or use Media → Audio.</p>`));
    } else {
        for (const name of sounds) {
            const relPath = `${InkMedia.AUDIO_FOLDER}/${name}`;
            const fileUrl = url.pathToFileURL(path.join(projectDir, relPath)).href;
            const $row = $(`<div class="assetsAudio">
                <a href="#" class="assetsPlay" title="Listen"><span class="icon icon-play"></span></a>
                <span class="assetsName"></span>
                <span class="assetsAdd">
                    <a href="#" class="assetsAddButton effect">Effect</a>
                    <a href="#" class="assetsAddButton loop">Loop</a>
                </span>
            </div>`);
            $row.find('.assetsName').text(name).attr('title', name).append(usedLabel(relPath));
            $row.find('.assetsPlay').on('click', (e) => { e.preventDefault(); togglePreview(fileUrl, $(e.currentTarget)); });
            makeTagSource($row.find('.effect'), `# AUDIO ${name}`);
            makeTagSource($row.find('.loop'), `# AUDIOLOOP ${name}`);
            $audio.append($row);
        }
    }
    $body.append($audio);

    // Tags whose file doesn't exist: click to go to the line
    const missing = tags.filter(tag => tag.error);
    if (missing.length > 0) {
        const $missing = section('Missing', missing.length);
        for (const tag of missing) {
            const $row = $(`<a href="#" class="assetsMissing"><span class="assetsMissingName"></span> <span class="assetsMissingWhere"></span></a>`);
            $row.find('.assetsMissingName').text(tag.val);
            $row.find('.assetsMissingWhere').text(`${tag.inkFile.relativePath()}:${tag.row + 1}`);
            $row.attr('title', tag.error);
            $row.on('click', (e) => { e.preventDefault(); events.gotoLine(tag.inkFile, tag.row); });
            $missing.append($row);
        }
        $body.append($missing);
    }

    $body.scrollTop(scrollTop);
}

let refreshTimer = null;

exports.AssetsView = {
    TAG_DRAG_TYPE: TAG_DRAG_TYPE,
    setEvents: (e) => { events = e; },
    // Re-reads the media folders and tags, after a short delay so bursts of edits only
    // cause one refresh
    requestRefresh: () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(render, 300);
    },
    toggle: (buttonId) => {
        ensurePanel();
        NavView.toggle('#assets-wrapper', buttonId);
        if ($('#assets-wrapper').hasClass('hidden')) stopPreview();
        else render();
    }
};
