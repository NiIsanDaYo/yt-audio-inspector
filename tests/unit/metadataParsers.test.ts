import { describe, expect, it } from 'vitest';
import { parseHeaderMetadata } from '../../src/lib/metadataParsers';

function writeAscii(target: Uint8Array, offset: number, value: string): void {
  for (let i = 0; i < value.length; i += 1) target[offset + i] = value.charCodeAt(i);
}

function u16le(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >> 8) & 0xff;
}

function u32le(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >> 8) & 0xff;
  target[offset + 2] = (value >> 16) & 0xff;
  target[offset + 3] = (value >> 24) & 0xff;
}

function u16be(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >> 8) & 0xff;
  target[offset + 1] = value & 0xff;
}

function u32be(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >> 24) & 0xff;
  target[offset + 1] = (value >> 16) & 0xff;
  target[offset + 2] = (value >> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function aifcHeader(compression: string): Uint8Array {
  // FORM + size + AIFC + COMM chunk (size=26: 18 base + 4 compression + 4 name)
  const commSize = 26;
  const totalSize = 4 + 8 + commSize; // AIFC + COMM header + COMM body
  const data = new Uint8Array(12 + 8 + commSize);
  writeAscii(data, 0, 'FORM');
  u32be(data, 4, totalSize);
  writeAscii(data, 8, 'AIFC');
  // COMM chunk
  writeAscii(data, 12, 'COMM');
  u32be(data, 16, commSize);
  u16be(data, 20, 2);           // channels
  u32be(data, 22, 48000);       // numFrames
  u16be(data, 26, 16);          // bitDepth
  // IEEE 754 extended 80-bit for 48000 Hz: exponent=16397, mantissa=0xBB80...
  data.set([0x40, 0x0d, 0xbb, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00], 28);
  // compression type (4 bytes) at offset 38
  writeAscii(data, 38, compression.padEnd(4, ' '));
  // compression name (pascal string, 1 byte length + 3 padding)
  data[42] = 0; // empty name
  return data;
}

function wavHeader(formatCode: number, bits: number, extra?: Uint8Array): Uint8Array {
  const fmtSize = 16 + (extra?.length ?? 0);
  const data = new Uint8Array(12 + 8 + fmtSize + 8);
  writeAscii(data, 0, 'RIFF');
  u32le(data, 4, data.length - 8);
  writeAscii(data, 8, 'WAVE');
  writeAscii(data, 12, 'fmt ');
  u32le(data, 16, fmtSize);
  u16le(data, 20, formatCode);
  u16le(data, 22, 2);
  u32le(data, 24, 48_000);
  u32le(data, 28, 48_000 * 2 * (bits / 8));
  u16le(data, 32, 2 * (bits / 8));
  u16le(data, 34, bits);
  if (extra) data.set(extra, 36);
  const dataChunk = 20 + fmtSize;
  writeAscii(data, dataChunk, 'data');
  u32le(data, dataChunk + 4, 0);
  return data;
}

describe('parseHeaderMetadata', () => {
  it('detects integer PCM WAV bit depth', () => {
    const hint = parseHeaderMetadata(wavHeader(1, 24));
    expect(hint.container).toBe('WAV');
    expect(hint.codec).toBe('Linear PCM');
    expect(hint.codecClass).toBe('lossless');
    expect(hint.bitDepth).toBe(24);
    expect(hint.bitDepthType).toBe('integer');
    expect(hint.sampleRate).toBe(48_000);
  });

  it('detects 32-bit float WAV', () => {
    const hint = parseHeaderMetadata(wavHeader(3, 32));
    expect(hint.codec).toBe('Linear PCM float');
    expect(hint.bitDepth).toBe(32);
    expect(hint.bitDepthType).toBe('float');
  });

  it('detects WAV extensible PCM valid bits', () => {
    const extra = new Uint8Array(24);
    u16le(extra, 0, 22);
    u16le(extra, 2, 24);
    u32le(extra, 4, 3);
    extra.set([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71], 8);

    const hint = parseHeaderMetadata(wavHeader(0xfffe, 32, extra));
    expect(hint.codec).toBe('Linear PCM');
    expect(hint.bitDepth).toBe(24);
    expect(hint.bitDepthType).toBe('integer');
  });

  it('returns an empty hint for unknown headers', () => {
    expect(parseHeaderMetadata(new Uint8Array([1, 2, 3]))).toEqual({});
  });

  it('classifies AIFF-C NONE as lossless', () => {
    const hint = parseHeaderMetadata(aifcHeader('NONE'));
    expect(hint.container).toBe('AIFC');
    expect(hint.codecClass).toBe('lossless');
    expect(hint.codec).toBe('AIFF-C PCM');
  });

  it('classifies AIFF-C ulaw/alaw as lossy', () => {
    const ulaw = parseHeaderMetadata(aifcHeader('ulaw'));
    expect(ulaw.codecClass).toBe('lossy');
    expect(ulaw.codec).toBe('AIFF-C ulaw');

    const alaw = parseHeaderMetadata(aifcHeader('alaw'));
    expect(alaw.codecClass).toBe('lossy');
  });

  it('classifies AIFF-C with unknown compression as unknown', () => {
    const hint = parseHeaderMetadata(aifcHeader('XYZW'));
    expect(hint.codecClass).toBe('unknown');
    expect(hint.codec).toBe('AIFF-C XYZW');
  });

  it('classifies AIFF-C sowt as lossless', () => {
    const hint = parseHeaderMetadata(aifcHeader('sowt'));
    expect(hint.codecClass).toBe('lossless');
    expect(hint.codec).toContain('sowt');
  });
});

