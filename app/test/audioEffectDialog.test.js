const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

describe('audio effect insertion dialog', function () {
  let dom, configureAudioEffect;
  beforeEach(function () {
    dom = new JSDOM('<div class="window"><input id="editor-focus"></div>');
    const { window } = dom;
    // jsdom does not implement native dialog methods; retain their event contract.
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
    window.HTMLDialogElement.prototype.close = function () {
      this.open = false;
      this.dispatchEvent(new window.Event('close'));
    };
    const context = vm.createContext({ document: window.document, exports: {},
      require: () => ({ _: text => text }) });
    vm.runInContext(fs.readFileSync(require.resolve('../renderer/audioEffectDialog.js'), 'utf8'), context);
    configureAudioEffect = context.exports.configureAudioEffect;
    window.document.querySelector('#editor-focus').focus();
  });
  afterEach(function () { dom.window.close(); });

  function submit(value) {
    const dialog = dom.window.document.querySelector('dialog');
    dialog.querySelector('input').value = value;
    dialog.querySelector('form').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  }

  it('offers a zero default and inserts a decimal delay without losing precision', async function () {
    const result = configureAudioEffect('# AUDIO bell.wav');
    const input = dom.window.document.querySelector('dialog input');
    assert.strictEqual(input.value, '0');
    assert.strictEqual(dom.window.document.activeElement, input);
    submit('2.5678');
    assert.strictEqual(await result, '# AUDIO bell.wav delay=2.5678');
    assert.strictEqual(dom.window.document.querySelector('dialog'), null);
    assert.strictEqual(dom.window.document.activeElement.id, 'editor-focus');
  });

  it('keeps the original immediate tag when delay is zero or blank', async function () {
    for (const value of ['0', '']) {
      const result = configureAudioEffect('# AUDIO bell.wav');
      submit(value);
      assert.strictEqual(await result, '# AUDIO bell.wav');
    }
  });

  it('prevents inserting a negative or oversized delay', async function () {
    const result = configureAudioEffect('# AUDIO bell.wav');
    for (const value of ['-1', '2147484']) {
      submit(value);
      assert.ok(dom.window.document.querySelector('dialog').open);
    }
    submit('1.5');
    assert.strictEqual(await result, '# AUDIO bell.wav delay=1.5');
  });

  it('cancels without inserting, and renders filenames as text', async function () {
    const result = configureAudioEffect('# AUDIO <script>bad</script>.wav');
    const dialog = dom.window.document.querySelector('dialog');
    assert.strictEqual(dialog.querySelector('script'), null);
    dialog.querySelector('button[type=button]').click();
    assert.strictEqual(await result, null);
  });
});

describe('delayed effects in the exported web player', function () {
  it('compiles Ink tags, resolves filenames, and cancels pending audio when restarted', function () {
    const inkjs = require('inkjs');
    const compiled = new inkjs.Compiler('VAR wait = 2.5\nLightning. # AUDIO thunder delay={wait}\n* Continue\n    -> END\n').Compile();
    const dom = new JSDOM(fs.readFileSync(require.resolve('../export-for-web-template/index.html'), 'utf8'),
      { runScripts: 'outside-only', url: 'https://example.test' });
    const window = dom.window;
    const timers = new Map();
    const audioElements = [];
    let timerId = 0;
    window.matchMedia = () => ({ matches: false });
    window.document.querySelector('.outerContainer').scrollTo = () => {};
    window.setTimeout = (callback, ms) => { const id = ++timerId; timers.set(id, { callback, ms }); return id; };
    window.clearTimeout = id => timers.delete(id);
    window.HTMLMediaElement.prototype.play = function () { audioElements.push(this); return Promise.resolve(); };
    window.HTMLMediaElement.prototype.pause = function () {};
    window.inkjs = inkjs;
    window.storyContent = compiled.ToJson();
    window.inkMediaFiles = ['audio/thunder.wav'];
    window.eval(fs.readFileSync(require.resolve('../export-for-web-template/inkMedia.js'), 'utf8'));
    window.eval(fs.readFileSync(require.resolve('../export-for-web-template/main.js'), 'utf8'));
    assert.strictEqual(audioElements.length, 0);
    assert.strictEqual(timers.size, 1);
    const firstTimer = [...timers.keys()][0];
    assert.strictEqual(timers.get(firstTimer).ms, 2500);
    window.document.querySelector('#rewind').click();
    assert.ok(!timers.has(firstTimer), 'Restart cancels the previous pending sound');
    assert.strictEqual(timers.size, 1, 'Restart schedules the new playthrough sound once');
    [...timers.values()][0].callback();
    assert.strictEqual(audioElements.length, 1);
    assert.strictEqual(audioElements[0].getAttribute('src'), 'audio/thunder.wav');
    dom.window.close();
  });
});
