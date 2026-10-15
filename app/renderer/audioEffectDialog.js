const i18n = require('./i18n.js');

// Configure the effect selected through Media > Audio before inserting its tag.
// Leaving the delay blank or at zero keeps the usual immediate playback.
exports.configureAudioEffect = function (tag) {
    return new Promise(resolve => {
        const previousFocus = document.activeElement;
        const dialog = document.createElement('dialog');
        dialog.className = 'audioEffectDialog';
        dialog.setAttribute('aria-labelledby', 'audio-effect-title');
        dialog.innerHTML = `<form method="dialog">
            <h3 id="audio-effect-title"></h3>
            <p class="audioEffectFile"></p>
            <label for="audio-effect-delay"></label>
            <input id="audio-effect-delay" class="form-control" type="number" min="0" max="2147483.647" step="any" value="0" aria-describedby="audio-effect-help">
            <p id="audio-effect-help"></p>
            <div class="audioEffectButtons">
                <button type="button" class="btn btn-default"></button>
                <button type="submit" class="btn btn-primary"></button>
            </div>
        </form>`;
        dialog.querySelector('h3').textContent = i18n._('Insert Audio Effect');
        dialog.querySelector('.audioEffectFile').textContent = tag.replace(/^# AUDIO\s+/, '');
        dialog.querySelector('label').textContent = i18n._('Start delay (seconds)');
        dialog.querySelector('#audio-effect-help').textContent = i18n._('Leave blank or use 0 to play immediately. Decimals are allowed, for example 2.5.');
        const cancel = dialog.querySelector('button[type=button]');
        cancel.textContent = i18n._('Cancel');
        dialog.querySelector('button[type=submit]').textContent = i18n._('Insert');
        const input = dialog.querySelector('input');
        let result = null;
        cancel.addEventListener('click', () => dialog.close());
        dialog.querySelector('form').addEventListener('submit', event => {
            event.preventDefault();
            if (!input.reportValidity()) return;
            const seconds = Number(input.value);
            result = seconds > 0 ? `${tag} delay=${seconds}` : tag;
            dialog.close();
        });
        dialog.addEventListener('close', () => {
            dialog.remove();
            if (previousFocus && previousFocus.isConnected) previousFocus.focus();
            resolve(result);
        }, { once: true });
        (document.querySelector('.window') || document.body).appendChild(dialog);
        dialog.showModal();
        input.focus();
        input.select();
    });
};
