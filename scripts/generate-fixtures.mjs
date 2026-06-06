import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixturesDir = join(root, 'tests', 'fixtures');
mkdirSync(fixturesDir, { recursive: true });

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-hide_banner', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function parseEbur(log) {
  const section = (name, label) => {
    const match = log.match(new RegExp(`${name}:\\s*([\\s\\S]*?)(?:\\n\\s*\\n|$)`, 'i'));
    if (!match) return null;
    const value = match[1].match(new RegExp(`${label}:\\s*([+-]?(?:\\d+(?:\\.\\d+)?|inf))`, 'i'));
    if (!value) return null;
    return Number.parseFloat(value[1]);
  };
  return {
    integratedLufs: section('Integrated loudness', 'I'),
    samplePeakDbfs: section('Sample peak', 'Peak'),
    truePeakDbtp: section('True peak', 'Peak')
  };
}

function nativeEbur(file) {
  const result = spawnSync(
    'ffmpeg',
    ['-hide_banner', '-nostats', '-i', file, '-filter_complex', 'ebur128=peak=sample+true:framelog=quiet', '-f', 'null', '-'],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `ffmpeg exited with ${result.status}`);
  }
  return parseEbur(`${result.stdout}\n${result.stderr}`);
}

function writeZeroWav(file) {
  const buffer = Buffer.alloc(44);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36, 4);
  buffer.write('WAVEfmt ', 8, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(48000, 24);
  buffer.writeUInt32LE(48000 * 2 * 3, 28);
  buffer.writeUInt16LE(2 * 3, 32);
  buffer.writeUInt16LE(24, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(0, 40);
  writeFileSync(file, buffer);
}

const files = {
  good: join(fixturesDir, 'good-48k24.wav'),
  mp3: join(fixturesDir, 'lossy-128k.mp3'),
  sample441: join(fixturesDir, 'sample-441.wav'),
  clipped: join(fixturesDir, 'clipped-float.wav'),
  videoAudio: join(fixturesDir, 'video-audio.mp4'),
  videoNoAudio: join(fixturesDir, 'video-no-audio.mp4'),
  invalid: join(fixturesDir, 'not-audio.txt'),
  broken: join(fixturesDir, 'broken.wav'),
  zero: join(fixturesDir, 'zero.wav')
};

ffmpeg([
  '-f',
  'lavfi',
  '-i',
  'aevalsrc=sin(2*PI*1000*t):s=48000:d=1',
  '-af',
  'volume=-1dB',
  '-c:a',
  'pcm_s24le',
  files.good
]);

ffmpeg([
  '-f',
  'lavfi',
  '-i',
  'aevalsrc=sin(2*PI*1000*t):s=48000:d=1',
  '-b:a',
  '128k',
  files.mp3
]);

ffmpeg([
  '-f',
  'lavfi',
  '-i',
  'aevalsrc=sin(2*PI*1000*t):s=44100:d=1',
  '-af',
  'volume=-6dB',
  '-c:a',
  'pcm_s16le',
  files.sample441
]);

ffmpeg([
  '-f',
  'lavfi',
  '-i',
  'aevalsrc=1.2*sin(2*PI*1000*t):s=48000:d=1',
  '-c:a',
  'pcm_f32le',
  files.clipped
]);

ffmpeg([
  '-f',
  'lavfi',
  '-i',
  'testsrc=size=160x90:rate=24:d=1',
  '-f',
  'lavfi',
  '-i',
  'aevalsrc=sin(2*PI*1000*t):s=48000:d=1',
  '-shortest',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '128k',
  files.videoAudio
]);

ffmpeg([
  '-f',
  'lavfi',
  '-i',
  'testsrc=size=160x90:rate=24:d=1',
  '-c:v',
  'libx264',
  '-pix_fmt',
  'yuv420p',
  '-an',
  files.videoNoAudio
]);

writeFileSync(files.invalid, 'this is not audio\n', 'utf8');
writeFileSync(files.broken, Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'binary'));
writeZeroWav(files.zero);

const expected = {
  good: nativeEbur(files.good),
  mp3: nativeEbur(files.mp3),
  sample441: nativeEbur(files.sample441),
  clipped: nativeEbur(files.clipped),
  videoAudio: nativeEbur(files.videoAudio)
};
writeFileSync(join(fixturesDir, 'expected-ebur128.json'), JSON.stringify(expected, null, 2));

console.log(`Generated fixtures in ${fixturesDir}`);
