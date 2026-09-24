const {ipcRenderer} = require("electron")

// Set by controller.js: returns extra details for the menu about where it was opened,
// e.g. { playFrom: "knot.stitch" } when right-clicking inside a knot in the editor
let infoProvider = () => ({});

// renderer
window.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    let info = {};
    try { info = infoProvider(e) || {}; } catch(_) {}
    ipcRenderer.send('show-context-menu', info)
});

exports.setContextMenuInfoProvider = (provider) => { infoProvider = provider; };
