import type { Ebur128Measurements } from '../types';

function parseNumericToken(token: string): number | null {
  const normalized = token.trim().toLowerCase();
  if (normalized === '-inf' || normalized === '-∞') return Number.NEGATIVE_INFINITY;
  if (normalized === 'inf' || normalized === '+inf' || normalized === '+∞') return Number.POSITIVE_INFINITY;
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

function parseSectionValue(logText: string, section: string, label: string): number | null {
  const pattern = new RegExp(`${section}:\\s*([\\s\\S]*?)(?:\\n\\s*\\n|$)`, 'i');
  const sectionMatch = logText.match(pattern);
  if (!sectionMatch) return null;
  const valuePattern = new RegExp(`${label}:\\s*([+-]?(?:\\d+(?:\\.\\d+)?|inf)|[-+]?∞)`, 'i');
  const valueMatch = sectionMatch[1].match(valuePattern);
  return valueMatch ? parseNumericToken(valueMatch[1]) : null;
}

export function parseEbur128Summary(logText: string): Ebur128Measurements {
  const summaryIndex = logText.toLowerCase().lastIndexOf('summary:');
  const summaryText = summaryIndex >= 0 ? logText.slice(summaryIndex) : logText;
  return {
    integratedLufs: parseSectionValue(summaryText, 'Integrated loudness', 'I'),
    truePeakDbtp: parseSectionValue(summaryText, 'True peak', 'Peak')
  };
}
