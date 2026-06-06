import type {
  AnalysisReport,
  CodecClass,
  DiagnosticId,
  DiagnosticItem,
  FileMetadata,
  Measurements,
  OverallVerdict
} from '../types';
import {
  formatBitDepth,
  formatBitRate,
  formatDb,
  formatLufs,
  formatSampleRate
} from './format';

export const REFERENCE_DIAGNOSTIC_IDS = new Set<DiagnosticId>(['lufs']);

export function evaluateTruePeak(truePeakDbtp: number | null): DiagnosticItem {
  if (truePeakDbtp === null) {
    return {
      id: 'true-peak',
      label: 'True Peak',
      value: '測定不可',
      level: 'warning',
      reason: 'True Peakを測定できませんでした。',
      recommendation: 'ファイルを確認し、別形式でもう一度診断してください。'
    };
  }
  if (!Number.isFinite(truePeakDbtp)) {
    return {
      id: 'true-peak',
      label: 'True Peak',
      value: '-∞ dBTP',
      level: 'warning',
      reason: '音声信号が検出されませんでした。',
      recommendation: 'ファイルの内容を確認してください。'
    };
  }
  if (truePeakDbtp < -50) {
    return {
      id: 'true-peak',
      label: 'True Peak',
      value: formatDb(truePeakDbtp, 'dBTP'),
      level: 'caution',
      reason: '音量が極端に小さいです。',
      recommendation: 'ファイルの内容・ゲイン設定を確認してください。'
    };
  }
  if (truePeakDbtp >= 0) {
    return {
      id: 'true-peak',
      label: 'True Peak',
      value: formatDb(truePeakDbtp, 'dBTP'),
      level: 'warning',
      reason: truePeakDbtp > 0 ? '0 dBTPを超えています。' : '0 dBTPに到達しています。',
      recommendation: '元マスターからTrue Peakを下げて再書き出ししてください。'
    };
  }
  if (truePeakDbtp > -1) {
    return {
      id: 'true-peak',
      label: 'True Peak',
      value: formatDb(truePeakDbtp, 'dBTP'),
      level: 'caution',
      reason: '再エンコード時にクリップする余地があります。',
      recommendation: '-1.0 dBTP以下を目安に調整してください。'
    };
  }
  return {
    id: 'true-peak',
    label: 'True Peak',
    value: formatDb(truePeakDbtp, 'dBTP'),
    level: 'normal',
    reason: '再エンコード時の余裕があります。',
    recommendation:
      truePeakDbtp > -1.5
        ? '基準内です。安全側なら -1.5〜-2.0 dBTP も選択肢です。'
        : 'このままで問題ありません。'
  };
}

export function evaluateSampleRate(sampleRate: number | null): DiagnosticItem {
  if (!sampleRate) {
    return {
      id: 'sample-rate',
      label: 'サンプルレート',
      value: '不明',
      level: 'info',
      reason: 'サンプルレートを特定できませんでした。',
      recommendation: '迷う場合は48 kHzで書き出してください。'
    };
  }
  if (sampleRate === 48_000) {
    return {
      id: 'sample-rate',
      label: 'サンプルレート',
      value: formatSampleRate(sampleRate),
      level: 'normal',
      reason: 'YouTube向けの標準的な値です。',
      recommendation: 'このままで問題ありません。'
    };
  }
  if (sampleRate === 44_100) {
    return {
      id: 'sample-rate',
      label: 'サンプルレート',
      value: formatSampleRate(sampleRate),
      level: 'info',
      reason: '音楽制作では一般的な値です。',
      recommendation: '最終書き出しは48 kHzが無難です。'
    };
  }
  if ([88_200, 96_000, 176_400, 192_000].includes(sampleRate)) {
    return {
      id: 'sample-rate',
      label: 'サンプルレート',
      value: formatSampleRate(sampleRate),
      level: 'info',
      reason: '高品質なサンプルレートです。',
      recommendation: '最終書き出しは48 kHzに揃えると扱いやすくなります。'
    };
  }
  if (sampleRate < 44_100) {
    return {
      id: 'sample-rate',
      label: 'サンプルレート',
      value: formatSampleRate(sampleRate),
      level: 'caution',
      reason: 'YouTube向けとしては低めです。',
      recommendation: '可能なら48 kHzで再書き出ししてください。'
    };
  }
  return {
    id: 'sample-rate',
    label: 'サンプルレート',
    value: formatSampleRate(sampleRate),
    level: 'info',
    reason: '標準表から外れた値です。',
    recommendation: '迷う場合は48 kHzで書き出してください。'
  };
}

export function evaluateBitDepth(metadata: Pick<FileMetadata, 'codecClass' | 'bitDepth' | 'bitDepthType'>): DiagnosticItem {
  if (metadata.codecClass === 'lossy') {
    return {
      id: 'bit-depth',
      label: 'ビット深度',
      value: 'N/A',
      level: 'info',
      reason: '非可逆形式では評価対象外です。',
      recommendation: '二重圧縮リスクを確認してください。'
    };
  }
  const { bitDepth, bitDepthType } = metadata;
  if (!bitDepth) {
    return {
      id: 'bit-depth',
      label: 'ビット深度',
      value: '不明',
      level: 'info',
      reason: 'ビット深度を特定できませんでした。',
      recommendation: '完成マスターは24-bit PCMが目安です。'
    };
  }
  if (bitDepth === 24 && bitDepthType !== 'float') {
    return {
      id: 'bit-depth',
      label: 'ビット深度',
      value: formatBitDepth(bitDepth, bitDepthType),
      level: 'normal',
      reason: '完成マスター向けの推奨値です。',
      recommendation: 'このままで問題ありません。'
    };
  }
  if (bitDepth === 16 && bitDepthType !== 'float') {
    return {
      id: 'bit-depth',
      label: 'ビット深度',
      value: formatBitDepth(bitDepth, bitDepthType),
      level: 'normal',
      reason: '実用上十分なビット深度です。',
      recommendation: '24-bit PCMも選択肢です。'
    };
  }
  if (bitDepth === 32 && bitDepthType === 'float') {
    return {
      id: 'bit-depth',
      label: 'ビット深度',
      value: formatBitDepth(bitDepth, bitDepthType),
      level: 'info',
      reason: '中間ファイルとして有用な形式です。',
      recommendation: '完成マスターは24-bit PCMで十分です。'
    };
  }
  if (bitDepth === 32) {
    return {
      id: 'bit-depth',
      label: 'ビット深度',
      value: formatBitDepth(bitDepth, bitDepthType),
      level: 'info',
      reason: '過剰気味ですが問題ありません。',
      recommendation: '完成マスターは24-bit PCMで十分です。'
    };
  }
  if (bitDepth <= 8) {
    return {
      id: 'bit-depth',
      label: 'ビット深度',
      value: formatBitDepth(bitDepth, bitDepthType),
      level: 'caution',
      reason: '完成マスターとしては低すぎます。',
      recommendation: '24-bit PCMでの再書き出しを推奨します。'
    };
  }
  return {
    id: 'bit-depth',
    label: 'ビット深度',
    value: formatBitDepth(bitDepth, bitDepthType),
    level: 'info',
    reason: '標準外ですが極端に低くはありません。',
    recommendation: '迷う場合は24-bit PCMで書き出してください。'
  };
}

export function evaluateCodecRisk(metadata: Pick<FileMetadata, 'codec' | 'codecClass' | 'bitRate'>): DiagnosticItem {
  if (metadata.codecClass === 'lossless') {
    return {
      id: 'codec-risk',
      label: '二重圧縮リスク',
      value: metadata.codec,
      level: 'normal',
      reason: 'ロスレス形式です。',
      recommendation: 'このままマスターとして扱えます。'
    };
  }
  if (metadata.codecClass === 'lossy') {
    const highBitrateAac =
      metadata.codec.toLowerCase().includes('aac') && metadata.bitRate !== null && metadata.bitRate >= 384_000;
    return {
      id: 'codec-risk',
      label: '二重圧縮リスク',
      value: `${metadata.codec}${metadata.bitRate ? ` / ${formatBitRate(metadata.bitRate)}` : ''}`,
      level: 'caution',
      reason: 'すでに非可逆圧縮されています。',
      recommendation: highBitrateAac
        ? 'MP4しか選べない場合は良い方ですが、判定は注意です。'
        : 'WAV/FLACなどのロスレスから書き出すのが理想です。'
    };
  }
  return {
    id: 'codec-risk',
    label: '二重圧縮リスク',
    value: metadata.codec || '不明',
    level: 'info',
    reason: '可逆/非可逆を確定できませんでした。',
    recommendation: 'WAV/FLAC/ALACなどのロスレス形式が無難です。'
  };
}

export function evaluateLufs(integratedLufs: number | null): DiagnosticItem {
  const fixed =
    'YouTubeの-14 LUFS処理は再生時のゲイン調整です。仕上がり優先で問題ありません。';
  if (integratedLufs === null) {
    return {
      id: 'lufs',
      label: 'Integrated LUFS',
      value: '測定不可',
      level: 'info',
      reason: 'Integrated LUFSを測定できませんでした。',
      recommendation: fixed
    };
  }
  if (integratedLufs < -50) {
    return {
      id: 'lufs',
      label: 'Integrated LUFS',
      value: formatLufs(integratedLufs),
      level: 'caution',
      reason: '事実上無音に近い音量です。',
      recommendation: 'ファイルの内容を確認してください。'
    };
  }
  if (integratedLufs >= -14) {
    return {
      id: 'lufs',
      label: 'Integrated LUFS',
      value: formatLufs(integratedLufs),
      level: 'info',
      reason: '音圧は高めです。',
      recommendation: fixed
    };
  }
  if (integratedLufs >= -20) {
    return {
      id: 'lufs',
      label: 'Integrated LUFS',
      value: formatLufs(integratedLufs),
      level: 'normal',
      reason: '標準〜やや控えめです。',
      recommendation: fixed
    };
  }
  return {
    id: 'lufs',
    label: 'Integrated LUFS',
    value: formatLufs(integratedLufs),
    level: 'caution',
    reason: '他の動画より小さく聞こえる可能性があります。',
    recommendation: '意図したダイナミクスなら問題ありません。'
  };
}

export function deriveOverallVerdict(items: DiagnosticItem[]): OverallVerdict {
  const core = items.filter((item) => !REFERENCE_DIAGNOSTIC_IDS.has(item.id));
  if (core.some((item) => item.level === 'warning')) return 'has-warning';
  if (core.some((item) => item.level === 'caution')) return 'has-caution';
  return 'ok';
}

export function buildDiagnostics(metadata: FileMetadata, measurements: Measurements): Pick<AnalysisReport, 'diagnostics' | 'overallVerdict'> {
  const diagnostics = [
    evaluateTruePeak(measurements.truePeakDbtp),
    evaluateSampleRate(metadata.sampleRate),
    evaluateBitDepth(metadata),
    evaluateCodecRisk(metadata),
    evaluateLufs(measurements.integratedLufs)
  ];
  return {
    diagnostics,
    overallVerdict: deriveOverallVerdict(diagnostics)
  };
}

export function codecClassFromBoolean(lossless: boolean | undefined): CodecClass {
  if (lossless === true) return 'lossless';
  if (lossless === false) return 'lossy';
  return 'unknown';
}
