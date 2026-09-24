// Generates the example sounds for the "New Illustrated Story" template, so that
// they're original (no licensing questions) and can be regenerated if needed:
//
//   node build/generateTemplateAudio.js
//
// Writes app/resources/templates/illustrated-story/audio/rain.wav (a seamless loop)
// and chime.wav (a short bell).

const fs = require("fs");
const path = require("path");

const SAMPLE_RATE = 22050;
const outDir = path.join(__dirname, "../app/resources/templates/illustrated-story/audio");

function writeWav(filePath, samples) {
    const data = Buffer.alloc(samples.length * 2);
    samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2));
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);                 // PCM
    header.writeUInt16LE(1, 22);                 // mono
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(SAMPLE_RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(data.length, 40);
    fs.writeFileSync(filePath, Buffer.concat([header, data]));
}

// Deterministic random numbers, so regenerating gives identical files
function random(seed) {
    return () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
    };
}

function normalise(samples, peak) {
    const max = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
    return samples.map(s => s / max * peak);
}

// Rain: low rumble plus brighter patter from filtered noise, with scattered drops.
// The end is crossfaded into the start so it loops without a click.
function rain(seconds) {
    const rand = random(1234);
    const fade = Math.floor(SAMPLE_RATE * 0.5);
    const total = Math.floor(SAMPLE_RATE * seconds) + fade;
    const raw = new Array(total);
    let low = 0, band = 0, prevBand = 0, drop = 0;
    for (let i = 0; i < total; i++) {
        const white = rand() * 2 - 1;
        low += 0.02 * (white - low);             // rumble
        band += 0.35 * (white - band);           // patter (low-passed...)
        const patter = band - prevBand;          // ...then high-passed
        prevBand = band;
        if (rand() < 0.0009) drop = 0.6 + rand() * 0.4;
        drop *= 0.992;
        const swell = 0.85 + 0.15 * Math.sin(2 * Math.PI * i / total * 3);
        raw[i] = (low * 3.0 + patter * 0.9 + drop * white * 0.5) * swell;
    }
    const length = total - fade;
    const loop = raw.slice(0, length);
    for (let i = 0; i < fade; i++) {
        const t = i / fade;
        loop[i] = raw[i] * t + raw[length + i] * (1 - t);
    }
    return normalise(loop, 0.5);
}

// Chime: a few inharmonic partials with different decays, like a small bell
function chime(seconds) {
    const partials = [
        { ratio: 1.0,  amp: 1.0,  decay: 1.6 },
        { ratio: 2.76, amp: 0.45, decay: 2.8 },
        { ratio: 5.40, amp: 0.25, decay: 4.5 },
        { ratio: 8.93, amp: 0.12, decay: 7.0 }
    ];
    const base = 784; // G5
    const total = Math.floor(SAMPLE_RATE * seconds);
    const samples = new Array(total);
    for (let i = 0; i < total; i++) {
        const t = i / SAMPLE_RATE;
        const attack = Math.min(1, t / 0.004);
        samples[i] = attack * partials.reduce((sum, p) =>
            sum + p.amp * Math.exp(-p.decay * t) * Math.sin(2 * Math.PI * base * p.ratio * t), 0);
    }
    return normalise(samples, 0.6);
}

fs.mkdirSync(outDir, { recursive: true });
writeWav(path.join(outDir, "rain.wav"), rain(6));
writeWav(path.join(outDir, "chime.wav"), chime(2.5));
console.log("Wrote rain.wav and chime.wav to " + outDir);
