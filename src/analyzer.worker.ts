/// <reference lib="webworker" />

import { FFmpeg } from '@ffmpeg/ffmpeg';
import type { LogEvent } from '@ffmpeg/ffmpeg';
import { parseBlob } from 'music-metadata';
import type { IAudioMetadata } from 'music-metadata';
import type {
  AnalysisReport,
  AnalyzerWorkerCommand,
  AnalyzerWorkerResponse,
  BitDepthType,
  CodecClass,
  FileMetadata
} from './types';
import { buildDiagnostics, codecClassFromBoolean } from './lib/diagnostics';
import { classifyCodec, friendlyCodecName, friendlyContainerName } from './lib/codec';
import { MAX_ANALYSIS_FILE_BYTES } from './lib/fileLimits';
import { AUDIO_EXTENSION_SET, VIDEO_EXTENSION_SET, extensionFromName } from './lib/fileTypes';
import { parseEbur128Summary } from './lib/ffmpegLog';
import { parseHeaderMetadata } from './lib/metadataParsers';

let ffmpegPromise: Promise<FFmpeg> | null = null;

function post(response: AnalyzerWorkerResponse): void {
  self.postMessage(response);
}

function progress(progressValue: number, message: string): void {
  post({ type: 'progress', progress: Math.max(0, Math.min(1, progressValue)), message });
}

function validateInputFile(file: File): string {
  const extension = extensionFromName(file.name);
  if (file.size > MAX_ANALYSIS_FILE_BYTES) {
    throw new Error('500MBを超えるファイルはブラウザのメモリ制限を避けるため解析できません。');
  }
  if (file.size === 0) {
    throw new Error('ファイルサイズが0です。音声データを含むファイルを選択してください。');
  }
  if (extension && !AUDIO_EXTENSION_SET.has(extension) && !VIDEO_EXTENSION_SET.has(extension)) {
    throw new Error('非対応形式です。音声（WAV / AIFF / FLAC / M4A / AAC / MP3 / Opus / OGG）または動画（MP4 / MOV / MKV / WebM / AVI / WMV / FLV / MPG）を選択してください。');
  }
  if (!extension && file.type && !file.type.startsWith('audio/') && !file.type.startsWith('video/')) {
    throw new Error('音声／動画ファイルとして認識できません。対応形式を選択してください。');
  }
  return extension || 'audio';
}

function baseUrl(): URL {
  const base = import.meta.env.BASE_URL || '/';
  return new URL(base, self.location.origin);
}

function assetUrl(pathOrUrl: string, base: URL): string {
  return new URL(pathOrUrl, base).toString();
}

function isVideoInput(file: File, extension: string): boolean {
  return VIDEO_EXTENSION_SET.has(extension) || file.type.startsWith('video/');
}

async function loadFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      progress(0.18, '準備中');
      const ffmpeg = new FFmpeg();
      const root = baseUrl();
      const wasmURL = import.meta.env.VITE_FFMPEG_WASM_URL
        ? assetUrl(import.meta.env.VITE_FFMPEG_WASM_URL, root)
        : assetUrl('ffmpeg-core/ffmpeg-core.wasm', root);
      await ffmpeg.load({
        coreURL: assetUrl('ffmpeg-core/ffmpeg-core.js', root),
        wasmURL
      });
      return ffmpeg;
    })();
  }
  return ffmpegPromise;
}

async function captureExec(ffmpeg: FFmpeg, args: string[], timeout = -1): Promise<string> {
  const logs: string[] = [];
  const handler = ({ message }: LogEvent) => {
    logs.push(message);
  };
  ffmpeg.on('log', handler);
  try {
    const exitCode = await ffmpeg.exec(args, timeout);
    const logText = logs.join('\n');
    if (exitCode !== 0) {
      if (/does not contain any stream|stream (specifier|map).*matches no streams|Output file does not contain any stream|Cannot find a matching stream/i.test(logText)) {
        throw new Error('音声ストリームが見つかりません。音声を含むファイルを選択してください。');
      }
      throw new Error(logText || `ffmpeg exited with code ${exitCode}`);
    }
    return logText;
  } finally {
    ffmpeg.off('log', handler);
  }
}

function numberFromUnknown(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringFromUnknown(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function mmFormat(metadata: IAudioMetadata | null): Record<string, unknown> {
  return metadata?.format ? (metadata.format as unknown as Record<string, unknown>) : {};
}

function selectBitDepth(
  headerBitDepth: number | undefined,
  mm: Record<string, unknown>
): number | null {
  const candidates = [
    headerBitDepth,
    numberFromUnknown(mm.bitsPerSample)
  ];
  const selected = candidates.find((value) => typeof value === 'number' && value > 0);
  return selected ?? null;
}

function inferBitDepthType(codec: string, headerType?: BitDepthType): BitDepthType | null {
  if (headerType) return headerType;
  const lower = codec.toLowerCase();
  if (lower.includes('float') || lower.includes('f32') || lower.includes('f64')) return 'float';
  if (lower.includes('pcm') || lower.includes('flac') || lower.includes('alac') || lower.includes('aiff')) return 'integer';
  return null;
}

function buildMetadata(
  file: File,
  extension: string,
  musicMetadata: IAudioMetadata | null,
  headerData: Uint8Array
): FileMetadata {
  const header = parseHeaderMetadata(headerData);
  const mm = mmFormat(musicMetadata);
  const rawCodec = header.codec ?? stringFromUnknown(mm.codec) ?? '不明';
  const rawContainer = header.container ?? stringFromUnknown(mm.container) ?? extension.toUpperCase();
  const classified = classifyCodec(rawCodec, rawContainer);
  const codecClass =
    header.codecClass ??
    (classified === 'unknown'
      ? codecClassFromBoolean(typeof mm.lossless === 'boolean' ? (mm.lossless as boolean) : undefined)
      : classified);
  const bitDepth = selectBitDepth(header.bitDepth, mm);
  const sampleRate =
    header.sampleRate ??
    numberFromUnknown(mm.sampleRate);
  const duration =
    header.duration ??
    numberFromUnknown(mm.duration);
  const bitRate =
    numberFromUnknown(mm.bitrate);
  const channels =
    header.channels ??
    numberFromUnknown(mm.numberOfChannels);

  if (duration !== null && duration <= 0) {
    throw new Error('長さ0の音声ファイルは解析できません。音声データを含むファイルを選択してください。');
  }
  if (channels !== null && channels <= 0) {
    throw new Error('音声チャンネルが見つかりません。音声ファイルのみを選択してください。');
  }

  return {
    fileName: file.name,
    fileSize: file.size,
    extension,
    container: friendlyContainerName(rawContainer, extension),
    codec: friendlyCodecName(rawCodec),
    codecClass: codecClass as CodecClass,
    sampleRate,
    bitDepth,
    bitDepthType: inferBitDepthType(rawCodec, header.bitDepthType),
    bitRate,
    channels,
    duration
  };
}

function ebur128Timeout(fileSize: number, durationSec: number | undefined): number {
  const baseMs = 120_000;
  const fromSize = (fileSize / (1024 * 1024)) * 600;
  const fromDuration = durationSec ? durationSec * 2_000 : 0;
  return Math.max(baseMs, Math.round(baseMs + Math.max(fromSize, fromDuration)));
}

async function runEbur128(
  ffmpeg: FFmpeg,
  inputPath: string,
  fileSize: number,
  durationSec: number | undefined
): Promise<ReturnType<typeof parseEbur128Summary>> {
  const logText = await captureExec(
    ffmpeg,
    [
      '-hide_banner',
      '-nostats',
      '-i',
      inputPath,
      '-map',
      '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      '-af',
      'ebur128=peak=true',
      '-f',
      'null',
      '-'
    ],
    ebur128Timeout(fileSize, durationSec)
  );
  const parsed = parseEbur128Summary(logText);
  if (parsed.integratedLufs === null || parsed.truePeakDbtp === null) {
    throw new Error('True PeakまたはIntegrated LUFSを取得できませんでした。ファイルが破損している可能性があります。');
  }
  return parsed;
}

async function analyze(file: File): Promise<AnalysisReport> {
  const extension = validateInputFile(file);
  progress(0.05, '確認中');
  const videoInput = isVideoInput(file, extension);

  let musicMetadata: IAudioMetadata | null = null;
  try {
    musicMetadata = await parseBlob(file, { duration: true });
  } catch {
    musicMetadata = null;
  }

  progress(0.12, videoInput ? '動画ファイルを読み込み中' : '読み込み中');
  const buffer = await file.arrayBuffer();
  const fileData = new Uint8Array(buffer);
  const headerSample = fileData.subarray(0, Math.min(fileData.length, 256 * 1024));
  const metadata = buildMetadata(file, extension, musicMetadata, headerSample);
  const inputPath = `input.${extension.replace(/[^a-z0-9]/gi, '') || 'audio'}`;
  const ffmpeg = await loadFFmpeg();

  progress(0.28, '解析エンジンへ転送中');
  await ffmpeg.writeFile(inputPath, fileData);
  try {
    progress(0.42, '測定中');
    const overall = await runEbur128(ffmpeg, inputPath, file.size, metadata.duration ?? undefined);

    const measurements = {
      truePeakDbtp: overall.truePeakDbtp,
      integratedLufs: overall.integratedLufs
    };
    const diagnostics = buildDiagnostics(metadata, measurements);

    progress(0.96, '集計中');
    return {
      metadata,
      measurements,
      diagnostics: diagnostics.diagnostics,
      overallVerdict: diagnostics.overallVerdict
    };
  } finally {
    await ffmpeg.deleteFile(inputPath).catch(() => undefined);
  }
}

self.onmessage = async (event: MessageEvent<AnalyzerWorkerCommand>) => {
  if (event.data.type !== 'analyze') return;
  try {
    const report = await analyze(event.data.file);
    post({ type: 'result', report });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'string' && error.trim()
          ? error
          : '解析中に不明なエラーが発生しました。';
    const detail = error instanceof Error ? error.stack : typeof error === 'string' ? error : undefined;
    post({ type: 'error', message, detail });
  }
};
