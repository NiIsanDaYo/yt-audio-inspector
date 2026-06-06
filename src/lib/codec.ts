import type { CodecClass } from '../types';

const LOSSLESS_PATTERNS = [
  'pcm',
  'linear pcm',
  'wave',
  'wav',
  'aiff',
  'aifc',
  'flac',
  'alac'
];

const LOSSY_PATTERNS = [
  'aac',
  'mp3',
  'mpeg 1 layer 3',
  'mpeg audio',
  'opus',
  'vorbis',
  'mp4a',
  'lossy'
];

const EXTENSION_LABELS: Record<string, string> = {
  aac: 'AAC',
  aif: 'AIFF',
  aiff: 'AIFF',
  flac: 'FLAC',
  m4a: 'M4A',
  m4v: 'MP4',
  mkv: 'MKV',
  mov: 'MOV',
  mp3: 'MP3',
  mp4: 'MP4',
  oga: 'OGG',
  ogg: 'OGG',
  opus: 'Opus',
  wav: 'WAV',
  wave: 'WAV',
  webm: 'WebM'
};

export function classifyCodec(codec: string | null | undefined, container?: string | null): CodecClass {
  const text = `${codec ?? ''} ${container ?? ''}`.toLowerCase();
  if (LOSSLESS_PATTERNS.some((pattern) => text.includes(pattern))) return 'lossless';
  if (LOSSY_PATTERNS.some((pattern) => text.includes(pattern))) return 'lossy';
  return 'unknown';
}

export function friendlyCodecName(codec: string | null | undefined): string {
  const text = codec?.trim();
  if (!text) return '不明';

  const lower = text.toLowerCase();
  if (lower.includes('mpeg 1 layer 3') || lower.includes('mpeg layer 3') || lower.includes('mp3')) return 'MP3';
  if (lower.includes('mpeg-4/aac') || lower.includes('aac') || lower.includes('mp4a')) return 'AAC';
  if (lower.includes('pcm') && lower.includes('float')) return 'Linear PCM float';
  if (lower.includes('linear pcm') || lower === 'pcm' || lower.includes('pcm_')) return 'Linear PCM';
  if (lower.includes('flac')) return 'FLAC';
  if (lower.includes('alac')) return 'ALAC';
  if (lower.includes('opus')) return 'Opus';
  if (lower.includes('vorbis')) return 'Vorbis';
  return text;
}

export function friendlyContainerName(container: string | null | undefined, extension?: string | null): string {
  const extLabel = extension ? EXTENSION_LABELS[extension.toLowerCase()] : undefined;
  const text = container?.trim();
  if (!text) return extLabel ?? '不明';

  const lower = text.toLowerCase();
  if (extLabel && (
    lower === 'mpeg' ||
    lower.includes('isom') ||
    lower.includes('iso2') ||
    lower.includes('avc1') ||
    lower.includes('mp41') ||
    lower.includes('mp42') ||
    lower.includes('mpeg-4') ||
    lower.includes('quicktime') ||
    lower.includes('matroska') ||
    lower.includes('webm')
  )) {
    return extLabel;
  }
  if (lower.includes('wave') || lower === 'wav') return 'WAV';
  if (lower.includes('aiff') || lower === 'aifc') return 'AIFF';
  if (lower.includes('flac')) return 'FLAC';
  if (lower.includes('ogg')) return 'OGG';
  if (lower.includes('mpeg') && extLabel) return extLabel;
  return text;
}
