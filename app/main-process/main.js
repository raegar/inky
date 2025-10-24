const {app, BrowserWindow, ipcMain, dialog, ipcRenderer, Menu} = require('electron')
const i18n = require("./i18n/i18n.js")
const {ProjectWindow} = require("./projectWindow.js");
const {DocumentationWindow} = require("./documentationWindow.js");
const {AboutWindow} = require("./aboutWindow.js");
const {AppMenus} = require('./appmenus.js');
const {onForceQuit} = require('./forceQuitDetect');
const {Inklecate} = require("./inklecate.js");
const { fstat } = require('original-fs');
const {fs} = require("fs");


function inkJSNeedsUpdating() {
    return false;
    // dialog.showMessageBox({
    //   type: 'error',
    //   buttons: ['Okay'],
    //   title: 'Export for web unavailable',
    //   message: "Sorry, export for web is currently disabled, until inkjs is updated to support the latest version of ink. You can download a previous version of Inky that supports inkjs and use that instead, although some of the latest features of ink may be missing."
    // });
    // return true;
}

// main
let pendingPathToOpen = null;
let hasFinishedLaunch = false;

// main
ipcMain.on('show-context-menu', (event) => {
    const template = [
        {
            label: 'Cut',
            role: 'cut' 
        },
        {
            label: 'Copy',
            role: 'copy' 
        },
        {
            label: 'Paste',
            role: 'paste' 
        },
      { type: 'separator' },
    ]
    const menu = Menu.buildFromTemplate(template)
    menu.popup(BrowserWindow.fromWebContents(event.sender))
})


ipcMain.handle("showSaveDialog", async (event,saveOptions) => {
    return dialog.showSaveDialog(saveOptions) 

})

ipcMain.handle("try-close", async (event) =>{
    return dialog.showMessageBox({
        type: "warning",
        message: i18n._("Would you like to save changes before exiting?"),
        detail: i18n._("Your changes will be lost if you don't save."),
        buttons: [
            i18n._("Save"),
            i18n._("Don't save"),
            i18n._("Cancel")
        ],
        defaultId: 0
    })
    
})

// Helper: copy selected asset into project folder with conflict prompt
async function importAssetWithPrompt(win, sourcePath, destDir, kindLabel) {
    const path = require('path');
    const fs = require('fs');
    try { fs.mkdirSync(destDir, { recursive: true }); } catch(_) {}

    const basename = path.basename(sourcePath);
    let targetPath = path.join(destDir, basename);

    if (fs.existsSync(targetPath)) {
        const result = await dialog.showMessageBox(win.browserWindow, {
            type: 'question',
            buttons: [ i18n._('Use Existing'), i18n._('Add as New'), i18n._('Cancel') ],
            defaultId: 0,
            cancelId: 2,
            title: i18n._(`${kindLabel} Already Exists`),
            message: i18n._(`${kindLabel} named "${basename}" already exists in this project.`),
            detail: i18n._('Use Existing will reference the current file. Add as New will copy with a unique name.')
        });

        if (result.response === 2) {
            return { cancelled: true };
        }
        if (result.response === 0) {
            // Use existing: no copy, keep original basename
            return { filename: basename, usedExisting: true };
        }
        // Add as new: find unique name and copy
        const ext = path.extname(basename);
        const base = path.basename(basename, ext);
        let idx = 2;
        while (fs.existsSync(targetPath)) {
            const candidate = `${base} (${idx})${ext}`;
            targetPath = path.join(destDir, candidate);
            idx++;
        }
        try { fs.copyFileSync(sourcePath, targetPath); } catch(err) {
            console.warn('importAssetWithPrompt: copy failed', err);
            return { filename: basename };
        }
        return { filename: path.basename(targetPath), copied: true };
    } else {
        try { fs.copyFileSync(sourcePath, targetPath); } catch(err) {
            console.warn('importAssetWithPrompt: copy failed', err);
            return { filename: basename };
        }
        return { filename: basename, copied: true };
    }
}

app.on('will-finish-launching', function () {
    app.on("open-file", function (event, path) {
        ProjectWindow.open(path);
        event.preventDefault();
    });

});

let isQuitting = false;

app.on("open-file", function (event, path) {

    // e.g. Drag and drop onto app to open it.
    // "open-file" seems to come before "will-finish-launching"
    if( !hasFinishedLaunch ) {
        pendingPathToOpen = path;
    }
    
    // Drag and drop onto app while it's already open
    else {

        // See if this root file is already open in an existing window
        let existingWin = ProjectWindow.withMainkInkPath(path);
        if( existingWin ) {
            existingWin.browserWindow.focus();
            existingWin.browserWindow.webContents.send('open-main-ink');
        } else {
            ProjectWindow.open(path);       
        }
    }
    
    event.preventDefault();
});

app.on('before-quit', function () {
    // We need this to differentiate between pressing quit (which should quit) or closing all windows
    // (which leaves the app open)
    isQuitting = true;
});

ipcMain.on("project-cancelled-close", (event) => {
    isQuitting = false;
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', function () {
    
    app.on('window-all-closed', function () {
        if (process.platform != 'darwin' || isQuitting) {
            app.quit();
        }
    });
    
    AppMenus.setCallbacks({
        new: () => {
            ProjectWindow.createEmpty();
        },
        newInclude: () => {
            var win = ProjectWindow.focused();
            if (win) win.newInclude();
        },
        open: () => {
            console.log("Test!")
            ProjectWindow.open();
        },
        clearRecent: () => {
            ProjectWindow.clearRecentFiles();
            AppMenus.setRecentFiles([]);
            AppMenus.refresh();
        },
        save: () => {
            var win = ProjectWindow.focused();
            if (win) win.save();
        },
        exportJson: () => {
            var win = ProjectWindow.focused();
            if (win) win.exportJson();
        },
        exportForWeb: () => {
            if( inkJSNeedsUpdating() ) return;
            var win = ProjectWindow.focused();
            if (win) win.exportForWeb();
        },
        exportJSOnly: () => {
            if( inkJSNeedsUpdating() ) return;
            var win = ProjectWindow.focused();
            if (win) win.exportJSOnly();
        },
        toggleTags: (item, focusedWindow, event) => {
            focusedWindow.webContents.send("set-tags-visible", item.checked);
        },
        nextIssue: (item, focusedWindow) => {
            focusedWindow.webContents.send("next-issue");
        },
        gotoAnything: (item, focusedWindow) => {
            focusedWindow.webContents.send("goto-anything");
        },
        showFlow: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.webContents.send('toggle-flow-view');
        },
        addWatchExpression: (item, focusedWindow) => {
            focusedWindow.webContents.send("add-watch-expression");
        },
        showDocs: () => {
            DocumentationWindow.openDocumentation(ProjectWindow.getViewSettings().theme);
        },
        showAbout: () => {
            AboutWindow.showAboutWindow(ProjectWindow.getViewSettings().theme);
        },
        keyboardShortcuts: () => {
            var win = ProjectWindow.focused();
            if (win) win.keyboardShortcuts();
        },
        stats: () => {
            var win = ProjectWindow.focused();
            if (win) win.stats();
        },
        zoomIn: () => {
            var win = ProjectWindow.focused();
            if (win != null) {
                win.zoom(2);
                // Convert change from font size to zoom percentage
                let zoom = ProjectWindow.getViewSettings().zoom;
                zoom = (parseInt(zoom) + Math.floor(2*100/12)).toString();
                ProjectWindow.addOrChangeViewSetting('zoom', zoom);
            }
        },
        zoomOut: () => {
          var win = ProjectWindow.focused();
          if (win != null) {
              win.zoom(-2);
              // Convert change from font size to zoom percentage
              let zoom = ProjectWindow.getViewSettings().zoom
              zoom = (parseInt(zoom) - Math.floor(2*100/12)).toString();
              ProjectWindow.addOrChangeViewSetting('zoom', zoom);
            }
        },
        zoom: (zoom_percent) => {
            var win = ProjectWindow.focused();
            if (win != null) {
                win.zoom(zoom_percent);
                let zoom = zoom_percent.toString();
                ProjectWindow.addOrChangeViewSetting('zoom', zoom)
            }
        },
        toggleAnimation: () => {
            let animEnabled = !ProjectWindow.getViewSettings().animationEnabled;
            ProjectWindow.addOrChangeViewSetting('animationEnabled', animEnabled)

            for(let i=0; i<ProjectWindow.all().length; i++) {
                let eachWindow = ProjectWindow.all()[i];
                eachWindow.browserWindow.webContents.send("set-animation-enabled", animEnabled);
            }
        },
        toggleAutoComplete: () => {
            let autoCompleteDisabled = !ProjectWindow.getViewSettings().autoCompleteDisabled;
            ProjectWindow.addOrChangeViewSetting('autoCompleteDisabled', autoCompleteDisabled)

            for(let i=0; i<ProjectWindow.all().length; i++) {
                let eachWindow = ProjectWindow.all()[i];
                eachWindow.browserWindow.webContents.send("set-autocomplete-disabled", autoCompleteDisabled);
            }
        },
        toggleAudioControls: () => {
            let current = ProjectWindow.getViewSettings().audioControlsVisible;
            let next = !(current === undefined ? true : !!current);
            ProjectWindow.addOrChangeViewSetting('audioControlsVisible', next)

            for(let i=0; i<ProjectWindow.all().length; i++) {
                let eachWindow = ProjectWindow.all()[i];
                eachWindow.browserWindow.webContents.send('set-audio-controls-visible', next);
            }
        },
        toggleAudioMuted: () => {
            let current = ProjectWindow.getViewSettings().audioMuted;
            let next = !!(!current);
            ProjectWindow.addOrChangeViewSetting('audioMuted', next)

            for(let i=0; i<ProjectWindow.all().length; i++) {
                let eachWindow = ProjectWindow.all()[i];
                eachWindow.browserWindow.webContents.send('set-audio-muted', next);
            }
        },
        insertSnippet: (focussedWindow, snippet) => {
            if( focussedWindow )
            focussedWindow.webContents.send('insertSnippet', snippet);
        },
        insertImage: async (item, focussedWindow) => {
            const win = ProjectWindow.focused();
            if (!win) return;

            // Pick an image file
            const result = await dialog.showOpenDialog(win.browserWindow, {
                title: i18n._('Insert Image'),
                properties: ['openFile'],
                filters: [
                    { name: 'Images', extensions: ['png','jpg','jpeg','gif','webp','bmp','svg'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });
            if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;

            const selectedPath = result.filePaths[0];
            const path = require('path');
            const fs = require('fs');

            let filename = path.basename(selectedPath);

            // If the project has a known path, copy to its images/ folder with conflict prompt
            const mainInk = win.mainInkAbsPath;
            if (mainInk && typeof mainInk === 'string') {
                try {
                    const projectDir = path.dirname(mainInk);
                    const imagesDir = path.join(projectDir, 'images');
                    const res = await importAssetWithPrompt(win, selectedPath, imagesDir, i18n._('Image'));
                    if (res && res.cancelled) return;
                    if (res && res.filename) filename = res.filename;
                } catch (err) {
                    console.warn('Insert Image: copy failed', err);
                }
            }

            if (focussedWindow) {
                // Insert the tag at the cursor
                focussedWindow.webContents.send('insertSnippet', `# IMAGE ${filename}`);
            }
        },
        insertAudioLoop: async (item, focussedWindow) => {
            const win = ProjectWindow.focused();
            if (!win) return;

            const result = await dialog.showOpenDialog(win.browserWindow, {
                title: i18n._('Insert Audio Loop'),
                properties: ['openFile'],
                filters: [
                    { name: 'Audio', extensions: ['mp3','ogg','wav','m4a','aac','flac','aiff','aif','opus','webm'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });
            if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;

            const selectedPath = result.filePaths[0];
            const path = require('path');
            const fs = require('fs');

            let filename = path.basename(selectedPath);

            const mainInk = win.mainInkAbsPath;
            if (mainInk && typeof mainInk === 'string') {
                try {
                    const projectDir = path.dirname(mainInk);
                    const audioDir = path.join(projectDir, 'audio');
                    const res = await importAssetWithPrompt(win, selectedPath, audioDir, i18n._('Audio'));
                    if (res && res.cancelled) return;
                    if (res && res.filename) filename = res.filename;
                } catch (err) {
                    console.warn('Insert Audio Loop: copy failed', err);
                }
            }

            if (focussedWindow) {
                focussedWindow.webContents.send('insertSnippet', `# AUDIOLOOP ${filename}`);
            }
        },
        insertAudioSFX: async (item, focussedWindow) => {
            const win = ProjectWindow.focused();
            if (!win) return;

            const result = await dialog.showOpenDialog(win.browserWindow, {
                title: i18n._('Insert Audio Effect'),
                properties: ['openFile'],
                filters: [
                    { name: 'Audio', extensions: ['mp3','ogg','wav','m4a','aac','flac','aiff','aif','opus','webm'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });
            if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;

            const selectedPath = result.filePaths[0];
            const path = require('path');
            const fs = require('fs');

            let filename = path.basename(selectedPath);

            const mainInk = win.mainInkAbsPath;
            if (mainInk && typeof mainInk === 'string') {
                try {
                    const projectDir = path.dirname(mainInk);
                    const audioDir = path.join(projectDir, 'audio');
                    const res = await importAssetWithPrompt(win, selectedPath, audioDir, i18n._('Audio'));
                    if (res && res.cancelled) return;
                    if (res && res.filename) filename = res.filename;
                } catch (err) {
                    console.warn('Insert Audio SFX: copy failed', err);
                }
            }

            if (focussedWindow) {
                focussedWindow.webContents.send('insertSnippet', `# AUDIO ${filename}`);
            }
        },
        insertAudioStopAll: (item, focussedWindow) => {
            if (focussedWindow) {
                focussedWindow.webContents.send('insertSnippet', `# AUDIOSTOP`);
            }
        },
        insertAudioStopLoop: (item, focussedWindow) => {
            if (focussedWindow) {
                focussedWindow.webContents.send('insertSnippet', `# AUDIOSTOP: loop`);
            }
        },
        insertAudioStopOnce: (item, focussedWindow) => {
            if (focussedWindow) {
                focussedWindow.webContents.send('insertSnippet', `# AUDIOSTOP: once`);
            }
        },
        changeTheme: (newTheme) => {
            AboutWindow.changeTheme(newTheme);
            DocumentationWindow.changeTheme(newTheme);
            ProjectWindow.addOrChangeViewSetting('theme', newTheme)
        }
    });
    
    console.log("Testing!")
    AppMenus.setRecentFiles(ProjectWindow.getRecentFiles());
    AppMenus.setTheme(ProjectWindow.getViewSettings().theme);
    AppMenus.setZoom(ProjectWindow.getViewSettings().zoom);
    AppMenus.setAnimationEnabled(ProjectWindow.getViewSettings().animationEnabled);
    AppMenus.setAutoCompleteDisabled(ProjectWindow.getViewSettings().autoCompleteDisabled)
    AppMenus.setAudioControlsVisible(ProjectWindow.getViewSettings().audioControlsVisible)

    AppMenus.refresh();
    ProjectWindow.setEvents({
        onRecentFilesChanged: (recentFiles) => {
            AppMenus.setRecentFiles(recentFiles);
            AppMenus.refresh();
        },
        onProjectSettingsChanged: (settings) => {
            settings = settings || {};
            AppMenus.setCustomSnippetMenus(settings.customInkSnippets || []);
            AppMenus.refresh();
        },
        onViewSettingsChanged: (viewSettings) => {
            AppMenus.setTheme(viewSettings.theme);
            AppMenus.setZoom(viewSettings.zoom);
            AppMenus.setAnimationEnabled(viewSettings.animationEnabled);
            AppMenus.setAutoCompleteDisabled(viewSettings.autoCompleteDisabled);
            AppMenus.setAudioControlsVisible(viewSettings.audioControlsVisible);
            AppMenus.setAudioMuted(viewSettings.audioMuted);
            AppMenus.refresh();
        }
    });

    // Windows passed file to open on command line?
    if (process.platform == "win32" && process.argv.length > 1 && !pendingPathToOpen) {
        for (let i = 1; i < process.argv.length; i++) {
            var arg = process.argv[i].toLowerCase();
            if (arg.endsWith(".ink")) {
                pendingPathToOpen = process.argv[1];
                break;
            }
        }
    }

    // Opened Inky with specific file (e.g. drag and drop or windows command line)
    if( pendingPathToOpen ) {
        ProjectWindow.open(pendingPathToOpen);
        pendingPathToOpen = null;
    }
    
    // Otherwise, show new empty window
    else {
        ProjectWindow.createEmpty();
    }

    // Setup last stored theme
    let theme = ProjectWindow.getViewSettings().theme;
    AboutWindow.changeTheme(theme);
    DocumentationWindow.changeTheme(theme);

    hasFinishedLaunch = true;

    // Debug
    //w.openDevTools();
});

function finalQuit() {
    Inklecate.killSessions();
}

onForceQuit(finalQuit);
app.on("will-quit", finalQuit);
