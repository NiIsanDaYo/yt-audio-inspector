import { describe, expect, it } from 'vitest';
import { classifyCodec, friendlyCodecName, friendlyContainerName } from '../../src/lib/codec';

describe('codec helpers', () => {
  it('classifies common lossy and lossless codec names', () => {
    expect(classifyCodec('Linear PCM', 'WAV')).toBe('lossless');
    expect(classifyCodec('MPEG 1 Layer 3', 'MPEG')).toBe('lossy');
    expect(classifyCodec('MPEG-4/AAC', 'isom/iso2/avc1/mp41')).toBe('lossy');
    expect(classifyCodec('unknown', 'unknown')).toBe('unknown');
  });

  it('normalizes codec names for display', () => {
    expect(friendlyCodecName('MPEG 1 Layer 3')).toBe('MP3');
    expect(friendlyCodecName('MPEG-4/AAC')).toBe('AAC');
    expect(friendlyCodecName('Linear PCM float')).toBe('Linear PCM float');
    expect(friendlyCodecName(null)).toBe('不明');
  });

  it('normalizes container names for display', () => {
    expect(friendlyContainerName('MPEG', 'mp3')).toBe('MP3');
    expect(friendlyContainerName('isom/iso2/avc1/mp41', 'mp4')).toBe('MP4');
    expect(friendlyContainerName('QuickTime / MOV', 'mov')).toBe('MOV');
    expect(friendlyContainerName(null, 'wav')).toBe('WAV');
  });
});
