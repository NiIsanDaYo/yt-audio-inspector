import type { OverallVerdict, Severity } from '../types';

export const severityLabels: Record<Severity, string> = {
  normal: '正常',
  info: '情報',
  caution: '注意',
  warning: '警告'
};

export const overallLabels: Record<OverallVerdict, string> = {
  ok: 'OK',
  'has-caution': '注意あり',
  'has-warning': '警告あり'
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '不明';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatDb(value: number | null, unit: 'dBTP' | 'dBFS'): string {
  if (value === null || Number.isNaN(value)) return '測定不可';
  if (value === Number.NEGATIVE_INFINITY) return `-∞ ${unit}`;
  if (value === Number.POSITIVE_INFINITY) return `+∞ ${unit}`;
  return `${value.toFixed(1)} ${unit}`;
}

export function formatLufs(value: number | null): string {
  if (value === null || Number.isNaN(value)) return '測定不可';
  if (value === Number.NEGATIVE_INFINITY) return '-∞ LUFS';
  if (value === Number.POSITIVE_INFINITY) return '+∞ LUFS';
  return `${value.toFixed(1)} LUFS`;
}

export function formatSampleRate(sampleRate: number | null): string {
  if (!sampleRate) return '不明';
  return sampleRate >= 1000 ? `${(sampleRate / 1000).toFixed(sampleRate % 1000 === 0 ? 0 : 1)} kHz` : `${sampleRate} Hz`;
}

export function formatBitDepth(bitDepth: number | null, type?: string | null): string {
  if (!bitDepth) return 'N/A';
  if (type === 'float') return `${bitDepth}-bit float`;
  if (type === 'integer') return `${bitDepth}-bit`;
  return `${bitDepth}-bit`;
}

export function formatBitRate(bitRate: number | null): string {
  if (!bitRate) return '不明';
  return `${Math.round(bitRate / 1000)} kbps`;
}
