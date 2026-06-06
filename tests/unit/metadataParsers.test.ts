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
});

