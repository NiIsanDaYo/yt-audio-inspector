import { describe, expect, it } from 'vitest';
import { parseEbur128Summary } from '../../src/lib/ffmpegLog';

describe('parseEbur128Summary', () => {
  it('parses integrated loudness and peak summaries', () => {
    const log = `
[Parsed_ebur128_0 @ 000001] Summary:

  Integrated loudness:
    I:          -16.2 LUFS
    Threshold: -26.2 LUFS

  Loudness range:
    LRA:         0.0 LU

  Sample peak:
    Peak:       -1.3 dBFS

  True peak:
    Peak:       -0.8 dBFS
`;
    expect(parseEbur128Summary(log)).toEqual({
      integratedLufs: -16.2,
      truePeakDbtp: -0.8
    });
  });

  it('returns null for missing sections', () => {
    expect(parseEbur128Summary('no summary')).toEqual({
      integratedLufs: null,
      truePeakDbtp: null
    });
  });
});

