import { describe, expect, it } from 'vitest';
import type { FileMetadata, Measurements } from '../../src/types';
import {
  buildDiagnostics,
  deriveOverallVerdict,
  evaluateBitDepth,
  evaluateCodecRisk,
  evaluateLufs,
  evaluateSampleRate,
  evaluateTruePeak
} from '../../src/lib/diagnostics';

function metadata(overrides: Partial<FileMetadata> = {}): FileMetadata {
  return {
    fileName: 'test.wav',
    fileSize: 1000,
    extension: 'wav',
    container: 'WAV',
    codec: 'Linear PCM',
    codecClass: 'lossless',
    sampleRate: 48_000,
    bitDepth: 24,
    bitDepthType: 'integer',
    bitRate: 1_152_000,
    channels: 2,
    duration: 1,
    ...overrides
  };
}

function measurements(overrides: Partial<Measurements> = {}): Measurements {
  return {
    truePeakDbtp: -1.1,
    integratedLufs: -16,
    ...overrides
  };
}

describe('diagnostic rules', () => {
  it('classifies true peak thresholds', () => {
    expect(evaluateTruePeak(-1.0).level).toBe('normal');
    expect(evaluateTruePeak(-0.9).level).toBe('caution');
    expect(evaluateTruePeak(0).level).toBe('warning');
    expect(evaluateTruePeak(0.2).level).toBe('warning');
    expect(evaluateTruePeak(0).reason).toContain('到達');
    expect(evaluateTruePeak(0.2).reason).toContain('超えています');
  });

  it('flags silence and extremely low volume as abnormal', () => {
    const silence = evaluateTruePeak(-Infinity);
    expect(silence.level).toBe('warning');
    expect(silence.reason).toContain('音声信号が検出されませんでした');

    const tooQuiet = evaluateTruePeak(-55);
    expect(tooQuiet.level).toBe('caution');
    expect(tooQuiet.reason).toContain('極端に小さい');

    expect(evaluateTruePeak(-50).level).toBe('normal');
  });

  it('classifies sample rates according to the spec', () => {
    expect(evaluateSampleRate(48_000).level).toBe('normal');
    expect(evaluateSampleRate(44_100).level).toBe('info');
    expect(evaluateSampleRate(96_000).level).toBe('info');
    expect(evaluateSampleRate(32_000).level).toBe('caution');
    expect(evaluateSampleRate(50_000).level).toBe('info');
  });

  it('classifies bit depth only for PCM/lossless masters', () => {
    expect(evaluateBitDepth(metadata({ bitDepth: 24 })).level).toBe('normal');
    const bit16 = evaluateBitDepth(metadata({ bitDepth: 16 }));
    expect(bit16.level).toBe('normal');
    expect(bit16.recommendation).toBe('24-bit PCMも選択肢です。');
    expect(evaluateBitDepth(metadata({ bitDepth: 32, bitDepthType: 'float' })).level).toBe('info');
    expect(evaluateBitDepth(metadata({ bitDepth: 32, bitDepthType: 'integer' })).level).toBe('info');
    expect(evaluateBitDepth(metadata({ bitDepth: 8 })).level).toBe('caution');
    expect(evaluateBitDepth(metadata({ codecClass: 'lossy', codec: 'MP3', bitDepth: null })).level).toBe('info');
  });

  it('flags lossy codecs and keeps high bitrate AAC as caution', () => {
    expect(evaluateCodecRisk(metadata()).level).toBe('normal');
    const mp3 = evaluateCodecRisk(metadata({ codec: 'MP3', codecClass: 'lossy', bitRate: 128_000 }));
    expect(mp3.level).toBe('caution');
    expect(mp3.value).toContain('128 kbps');
    const aac = evaluateCodecRisk(metadata({ codec: 'AAC', codecClass: 'lossy', bitRate: 384_000 }));
    expect(aac.level).toBe('caution');
    expect(aac.recommendation).toContain('良い方');
  });

  it('treats LUFS as reference rather than -14 pass/fail', () => {
    expect(evaluateLufs(-13.5).level).toBe('info');
    expect(evaluateLufs(-16).level).toBe('normal');
    expect(evaluateLufs(-21).level).toBe('caution');

    const nearSilent = evaluateLufs(-70);
    expect(nearSilent.level).toBe('caution');
    expect(nearSilent.reason).toContain('無音');
  });

  it('derives overall verdict from all items', () => {
    expect(deriveOverallVerdict([evaluateTruePeak(-1.2), evaluateSampleRate(48_000)])).toBe('ok');
    expect(deriveOverallVerdict([evaluateTruePeak(-0.5), evaluateSampleRate(48_000)])).toBe('has-caution');
    expect(deriveOverallVerdict([evaluateTruePeak(0), evaluateSampleRate(48_000)])).toBe('has-warning');
  });

  it('produces all required diagnostic items without unassigned branches', () => {
    const result = buildDiagnostics(metadata(), measurements());
    expect(result.diagnostics.map((item) => item.id)).toEqual([
      'true-peak',
      'sample-rate',
      'bit-depth',
      'codec-risk',
      'lufs'
    ]);
    expect(result.overallVerdict).toBe('ok');
  });

  it('keeps LUFS as reference so a quiet mix does not fail the overall verdict', () => {
    const result = buildDiagnostics(metadata(), measurements({ integratedLufs: -25 }));
    expect(result.diagnostics.find((item) => item.id === 'lufs')?.level).toBe('caution');
    expect(result.overallVerdict).toBe('ok');
  });

  it('flags silent files in the overall verdict', () => {
    const result = buildDiagnostics(metadata(), measurements({ truePeakDbtp: -Infinity, integratedLufs: -70 }));
    expect(result.overallVerdict).toBe('has-warning');
  });
});
