const assert = require('assert');
const InkMedia = require('../export-for-web-template/inkMedia.js');

describe('InkMedia.parseTag', function () {
  it('accepts "KEY: value", "KEY value" and a bare "KEY"', function () {
    assert.deepStrictEqual(InkMedia.parseTag('IMAGE: temple.png'), { property: 'IMAGE', val: 'temple.png' });
    assert.deepStrictEqual(InkMedia.parseTag('IMAGE temple.png'), { property: 'IMAGE', val: 'temple.png' });
    assert.deepStrictEqual(InkMedia.parseTag('AUDIOSTOP'), { property: 'AUDIOSTOP', val: '' });
    assert.deepStrictEqual(InkMedia.parseTag(' audiostop : loop '), { property: 'AUDIOSTOP', val: 'loop' });
  });

  it('only splits on the first colon or space', function () {
    assert.deepStrictEqual(InkMedia.parseTag('LINK https://example.com'), { property: 'LINK', val: 'https://example.com' });
    assert.deepStrictEqual(InkMedia.parseTag('LINK: https://example.com'), { property: 'LINK', val: 'https://example.com' });
    assert.deepStrictEqual(InkMedia.parseTag('colour it blue'), { property: 'COLOUR', val: 'it blue' });
  });

  it('returns null for tags that do not start with a name', function () {
    assert.strictEqual(InkMedia.parseTag(''), null);
    assert.strictEqual(InkMedia.parseTag('!!!'), null);
    assert.strictEqual(InkMedia.parseTag(null), null);
  });

  it('separates an optional audio delay from the filename', function () {
    assert.deepStrictEqual(InkMedia.parseTag('AUDIO: thunder clap.wav delay=2.5'),
      { property: 'AUDIO', val: 'thunder clap.wav', delaySeconds: 2.5 });
    assert.deepStrictEqual(InkMedia.parseTag(' audio bell DELAY = 0 '),
      { property: 'AUDIO', val: 'bell', delaySeconds: 0 });
    assert.strictEqual(InkMedia.parseTag('AUDIO bell delay=.5').delaySeconds, 0.5);
    assert.strictEqual(InkMedia.parseTag('AUDIO bell delay=1e-7').delaySeconds, 1e-7);
    assert.strictEqual(InkMedia.parseTag('IMAGE delay=2.png').val, 'delay=2.png');
  });

  it('reports invalid delays instead of playing immediately or looking for a bogus file', function () {
    for (const delay of ['-1', 'nope', 'Infinity', '', '2147484']) {
      const tag = InkMedia.parseTag(`AUDIO bell.wav delay=${delay}`);
      assert.strictEqual(tag.val, 'bell.wav');
      assert.ok(tag.error, delay);
    }
  });
});

// Run the browser copy with a small fake clock and audio elements. No real sound
// or wall-clock sleeps: advancing time verifies exactly when effects start.
function audioHarness() {
  const vm = require('vm');
  const fs = require('fs');
  let now = 0, nextTimer = 0;
  const timers = new Map();
  const inputListeners = {};
  const elements = [];
  const document = {
    addEventListener: (type, fn) => { inputListeners[type] = fn; },
    createElement: () => {
      const listeners = {};
      const el = {
        paused: true, volume: 1, playCount: 0,
        addEventListener: (type, fn) => { (listeners[type] || (listeners[type] = [])).push(fn); },
        emit: type => { (listeners[type] || []).forEach(fn => fn()); },
        play() { this.playCount++; this.paused = false; this.emit('play'); return Promise.resolve(); },
        pause() { this.paused = true; this.emit('pause'); }
      };
      elements.push(el);
      return el;
    }
  };
  const context = vm.createContext({ document,
    setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  vm.runInContext(fs.readFileSync(require.resolve('../export-for-web-template/inkMedia.js'), 'utf8'), context);
  const advance = ms => {
    const until = now + ms;
    while (true) {
      const next = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
    }
    now = until;
  };
  return { player: new context.InkMedia.AudioPlayer({ fadeMs: 0 }), advance, elements, inputListeners };
}

describe('InkMedia.AudioPlayer delayed effects', function () {
  it('preserves immediate playback, and starts a delayed effect exactly once at the requested time', function () {
    const { player, advance } = audioHarness();
    assert.strictEqual(player.playOnce('immediate.wav').playCount, 1);
    assert.strictEqual(player.playOnce('zero.wav', 0).playCount, 1);
    const el = player.playOnce('thunder.wav', 2.5);
    advance(2499);
    assert.strictEqual(el.playCount, 0);
    advance(1);
    assert.strictEqual(el.playCount, 1);
    advance(10000);
    assert.strictEqual(el.playCount, 1);
    el.emit('ended');
    assert.ok(!player.elements().includes(el));
  });

  it('keeps independent delays for overlapping effects and applies mute while waiting', function () {
    const { player, advance } = audioHarness();
    const a = player.playOnce('a.wav', 1), b = player.playOnce('b.wav', 2);
    player.setMuted(true);
    advance(1000);
    assert.strictEqual(a.playCount, 1);
    assert.strictEqual(b.playCount, 0);
    assert.strictEqual(a.muted, true);
    assert.strictEqual(b.muted, true);
    player.setMuted(false);
    advance(1000);
    assert.strictEqual(b.playCount, 1);
    assert.strictEqual(b.muted, false);
  });

  it('cancels pending effects on Stop Effects, Stop All and Restart', function () {
    for (const stop of [p => p.stop('once'), p => p.stop(''), p => p.stopAllNow()]) {
      const { player, advance } = audioHarness();
      const el = player.playOnce('a.wav', 2);
      stop(player);
      advance(3000);
      assert.strictEqual(el.playCount, 0);
      assert.strictEqual(player.elements().length, 0);
      assert.strictEqual(player.pendingOneShots.size, 0);
    }
  });

  it('does not cancel effects when stopping only the loop', function () {
    const { player, advance } = audioHarness();
    const loop = player.playLoop('loop.ogg');
    const el = player.playOnce('a.wav', 1);
    player.stop('loop');
    advance(1000);
    assert.strictEqual(loop.paused, true);
    assert.strictEqual(el.playCount, 1);
  });

  it('cancels scheduled starts on replay while retaining effects that already started', function () {
    const { player, advance } = audioHarness();
    const playing = player.playOnce('a.wav');
    const waiting = player.playOnce('b.wav', 1);
    player.cancelPendingOneShots();
    advance(2000);
    assert.strictEqual(waiting.playCount, 0);
    assert.strictEqual(playing.paused, false);
    assert.strictEqual(player.elements().length, 1);
  });

  it('does not restart an effect after the player starts it manually', function () {
    const { player, advance } = audioHarness();
    const el = player.playOnce('a.wav', 2);
    el.play();
    el.pause();
    advance(3000);
    assert.strictEqual(el.playCount, 1);
    assert.strictEqual(el.paused, true);
  });

  it('retries an effect blocked by browser autoplay on the next interaction', async function () {
    const { player, advance, inputListeners } = audioHarness();
    const el = player.playOnce('a.wav', 1);
    const originalPlay = el.play;
    el.play = () => Promise.reject({ name: 'NotAllowedError' });
    advance(1000);
    await Promise.resolve();
    assert.strictEqual(el.autoplayBlocked, true);
    el.play = originalPlay;
    inputListeners.pointerdown();
    assert.strictEqual(el.playCount, 1);
  });
});

describe('delayed effects in project media warnings', function () {
  const { ProjectMedia } = require('../renderer/projectMedia.js');
  const path = require('path');
  const projectDir = path.join(__dirname, '../resources/templates/the-forest');
  function projectFor(tag) {
    const file = { isMain: () => true, projectDir, relativePath: () => 'story.ink',
      getAceSession: () => ({ getLength: () => 1, getTokens: () => [{ type: 'tag', value: tag }] }) };
    return { mainInk: file, files: [file] };
  }

  it('resolves the audio file without treating the delay as part of its name', function () {
    const file = ProjectMedia.listFiles(projectDir, 'AUDIO')[0];
    assert.ok(file, 'Template contains an audio fixture');
    const tags = ProjectMedia.scanTags(projectFor(`# AUDIO ${file} delay=2.5`));
    assert.strictEqual(tags[0].path, `audio/${file}`);
    assert.strictEqual(tags[0].error, undefined);
    assert.ok(ProjectMedia.isFileUsed(tags, `audio/${file}`));
  });

  it('reports a delay warning at the source line for invalid values', function () {
    const issues = ProjectMedia.findIssues(projectFor('# AUDIO birds.wav delay=-1'));
    assert.strictEqual(issues.length, 1);
    assert.strictEqual(issues[0].lineNumber, 1);
    assert.match(issues[0].message, /Audio delay/);
  });

  it('allows an Ink expression for the delay while checking the filename', function () {
    const file = ProjectMedia.listFiles(projectDir, 'AUDIO')[0];
    const tags = ProjectMedia.scanTags(projectFor(`# AUDIO ${file} delay={wait}`));
    assert.strictEqual(tags[0].path, `audio/${file}`);
    assert.strictEqual(tags[0].error, undefined);
  });
});

describe('InkMedia.candidatePaths', function () {
  it('looks in images/ first, then next to the story', function () {
    assert.deepStrictEqual(InkMedia.candidatePaths('IMAGE', 'temple.png'), ['images/temple.png', 'temple.png']);
    assert.deepStrictEqual(InkMedia.candidatePaths('IMAGE', 'art\\temple.png'), ['images/art/temple.png', 'art/temple.png']);
  });

  it('tries extensions for audio without one', function () {
    assert.deepStrictEqual(InkMedia.candidatePaths('AUDIO', 'bell').slice(0, 3), ['audio/bell.wav', 'audio/bell.mp3', 'audio/bell.ogg']);
    assert.deepStrictEqual(InkMedia.candidatePaths('AUDIOLOOP', 'drone').slice(0, 3), ['audio/drone.mp3', 'audio/drone.ogg', 'audio/drone.wav']);
    assert.deepStrictEqual(InkMedia.candidatePaths('AUDIO', 'bell.wav'), ['audio/bell.wav', 'images/bell.wav', 'bell.wav']);
  });

  it('returns nothing for other tags or empty values', function () {
    assert.deepStrictEqual(InkMedia.candidatePaths('CLASS', 'red'), []);
    assert.deepStrictEqual(InkMedia.candidatePaths('IMAGE', ''), []);
  });
});

describe('InkMedia.resolve', function () {
  it('returns the first path that exists', function () {
    const files = new Set(['audio/drone.ogg', 'audio/drone.wav']);
    assert.strictEqual(InkMedia.resolve('AUDIOLOOP', 'drone', p => files.has(p)), 'audio/drone.ogg');
    assert.strictEqual(InkMedia.resolve('IMAGE', 'missing.png', p => files.has(p)), null);
  });
});
