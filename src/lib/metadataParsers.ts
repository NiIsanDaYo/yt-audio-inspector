import type { BitDepthType, CodecClass } from '../types';

export interface HeaderMetadataHint {
  container?: string;
  codec?: string;
  codecClass?: CodecClass;
  sampleRate?: number;
  bitDepth?: number;
  bitDepthType?: BitDepthType;
  channels?: number;
  duration?: number;
}

function ascii(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.subarray(offset, offset + length));
}

function readU16LE(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

function readU16BE(data: Uint8Array, offset: number): number {
  return (data[offset] << 8) | data[offset + 1];
}

function readU32LE(data: Uint8Array, offset: number): number {
  return (
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24)
  ) >>> 0;
}

function readU32BE(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) >>> 0) +
    (data[offset + 1] << 16) +
    (data[offset + 2] << 8) +
    data[offset + 3]
  );
}

function parseIeeeExtended80(data: Uint8Array, offset: number): number | undefined {
  const sign = data[offset] & 0x80 ? -1 : 1;
  const exponent = ((data[offset] & 0x7f) << 8) | data[offset + 1];
  let mantissa = 0n;
  for (let i = 0; i < 8; i += 1) {
    mantissa = (mantissa << 8n) | BigInt(data[offset + 2 + i]);
  }
  if (exponent === 0 && mantissa === 0n) return 0;
  const value = Number(mantissa) * 2 ** (exponent - 16383 - 63);
  return Number.isFinite(value) ? sign * value : undefined;
}

function extensibleSubformat(data: Uint8Array, offset: number): 'pcm' | 'float' | 'unknown' {
  const guid = Array.from(data.subarray(offset, offset + 16))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (guid === '0100000000001000800000aa00389b71') return 'pcm';
  if (guid === '0300000000001000800000aa00389b71') return 'float';
  return 'unknown';
}

function parseWave(data: Uint8Array): HeaderMetadataHint | null {
  if (data.length < 44) return null;
  const riff = ascii(data, 0, 4);
  if ((riff !== 'RIFF' && riff !== 'RF64') || ascii(data, 8, 4) !== 'WAVE') return null;

  const hint: HeaderMetadataHint = {
    container: 'WAV',
    codecClass: 'lossless'
  };
  let offset = 12;
  let dataBytes: number | null = null;
  let bytesPerSecond: number | null = null;

  while (offset + 8 <= data.length) {
    const id = ascii(data, offset, 4);
    const size = readU32LE(data, offset + 4);
    const body = offset + 8;
    if (body + size > data.length) break;

    if (id === 'fmt ' && size >= 16) {
      const formatCode = readU16LE(data, body);
      const channels = readU16LE(data, body + 2);
      const sampleRate = readU32LE(data, body + 4);
      bytesPerSecond = readU32LE(data, body + 8);
      const bitsPerSample = readU16LE(data, body + 14);
      let bitDepth = bitsPerSample;
      let bitDepthType: BitDepthType = 'integer';
      let codec = 'Linear PCM';

      if (formatCode === 3) {
        bitDepthType = 'float';
        codec = 'Linear PCM float';
      } else if (formatCode === 0xfffe && size >= 40) {
        const validBits = readU16LE(data, body + 18);
        if (validBits > 0) bitDepth = validBits;
        const subformat = extensibleSubformat(data, body + 24);
        if (subformat === 'float') {
          bitDepthType = 'float';
          codec = 'Linear PCM float';
        } else if (subformat === 'pcm') {
          codec = 'Linear PCM';
        } else {
          bitDepthType = 'unknown';
          codec = 'WAV extensible';
          hint.codecClass = 'unknown';
        }
      } else if (formatCode !== 1) {
        codec = `WAV format code ${formatCode}`;
        bitDepthType = 'unknown';
        hint.codecClass = 'unknown';
      }

      Object.assign(hint, {
        codec,
        channels,
        sampleRate,
        bitDepth,
        bitDepthType
      });
    } else if (id === 'data') {
      dataBytes = size;
    }

    offset = body + size + (size % 2);
  }

  if (dataBytes !== null && bytesPerSecond && bytesPerSecond > 0) {
    hint.duration = dataBytes / bytesPerSecond;
  }
  return hint;
}

function parseAiff(data: Uint8Array): HeaderMetadataHint | null {
  if (data.length < 30 || ascii(data, 0, 4) !== 'FORM') return null;
  const formType = ascii(data, 8, 4);
  if (formType !== 'AIFF' && formType !== 'AIFC') return null;
  const hint: HeaderMetadataHint = {
    container: formType,
    codec: formType === 'AIFC' ? 'AIFF-C' : 'AIFF PCM',
    codecClass: 'lossless',
    bitDepthType: 'integer'
  };
  let offset = 12;
  while (offset + 8 <= data.length) {
    const id = ascii(data, offset, 4);
    const size = readU32BE(data, offset + 4);
    const body = offset + 8;
    if (body + size > data.length) break;
    if (id === 'COMM' && size >= 18) {
      const channels = readU16BE(data, body);
      const frames = readU32BE(data, body + 2);
      const bitDepth = readU16BE(data, body + 6);
      const sampleRate = parseIeeeExtended80(data, body + 8);
      Object.assign(hint, {
        channels,
        bitDepth,
        sampleRate: sampleRate ? Math.round(sampleRate) : undefined,
        duration: sampleRate ? frames / sampleRate : undefined
      });
      if (formType === 'AIFC' && size >= 22) {
        const compression = ascii(data, body + 18, 4).trim();
        const compUp = compression.toUpperCase();
        if (compUp === 'FL32' || compUp === 'FL64') {
          hint.codec = 'AIFF float';
          hint.bitDepthType = 'float';
        } else if (compUp === 'NONE' || compUp === 'SOWT' || compUp === 'TWOS' || compUp === 'IN24' || compUp === 'IN32') {
          hint.codec = compUp === 'NONE' ? 'AIFF-C PCM' : `AIFF-C ${compression}`;
        } else if (compUp === 'ULAW' || compUp === 'ALAW' || compUp === 'IMA4' || compUp === 'MAC3' || compUp === 'MAC6') {
          hint.codec = `AIFF-C ${compression}`;
          hint.codecClass = 'lossy';
        } else {
          hint.codec = `AIFF-C ${compression}`;
          hint.codecClass = 'unknown';
        }
      }
    }
    offset = body + size + (size % 2);
  }
  return hint;
}

function parseFlac(data: Uint8Array): HeaderMetadataHint | null {
  if (data.length < 42 || ascii(data, 0, 4) !== 'fLaC') return null;
  let offset = 4;
  while (offset + 4 <= data.length) {
    const header = data[offset];
    const blockType = header & 0x7f;
    const length = (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
    const body = offset + 4;
    if (body + length > data.length) break;
    if (blockType === 0 && length >= 34) {
      let packed = 0n;
      for (let i = 10; i < 18; i += 1) {
        packed = (packed << 8n) | BigInt(data[body + i]);
      }
      const sampleRate = Number((packed >> 44n) & 0xfffffn);
      const channels = Number((packed >> 41n) & 0x7n) + 1;
      const bitDepth = Number((packed >> 36n) & 0x1fn) + 1;
      const totalSamples = Number(packed & 0xfffffffffn);
      return {
        container: 'FLAC',
        codec: 'FLAC',
        codecClass: 'lossless',
        sampleRate,
        channels,
        bitDepth,
        bitDepthType: 'integer',
        duration: sampleRate > 0 && totalSamples > 0 ? totalSamples / sampleRate : undefined
      };
    }
    offset = body + length;
  }
  return null;
}

export function parseHeaderMetadata(data: Uint8Array): HeaderMetadataHint {
  return parseWave(data) ?? parseAiff(data) ?? parseFlac(data) ?? {};
}

