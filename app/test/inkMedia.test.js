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
