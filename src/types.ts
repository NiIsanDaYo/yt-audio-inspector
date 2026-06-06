export type Severity = 'normal' | 'info' | 'caution' | 'warning';

export type OverallVerdict = 'ok' | 'has-caution' | 'has-warning';

export type CodecClass = 'lossless' | 'lossy' | 'unknown';

export type BitDepthType = 'integer' | 'float' | 'unknown';

export type DiagnosticId =
  | 'true-peak'
  | 'sample-rate'
  | 'bit-depth'
  | 'codec-risk'
  | 'lufs';

export interface DiagnosticItem {
  id: DiagnosticId;
  label: string;
  value: string;
  level: Severity;
  reason: string;
  recommendation: string;
}

export interface FileMetadata {
  fileName: string;
  fileSize: number;
  extension: string;
  container: string;
  codec: string;
  codecClass: CodecClass;
  sampleRate: number | null;
  bitDepth: number | null;
  bitDepthType: BitDepthType | null;
  bitRate: number | null;
  channels: number | null;
  duration: number | null;
}

export interface Measurements {
  truePeakDbtp: number | null;
  integratedLufs: number | null;
}

export interface AnalysisReport {
  metadata: FileMetadata;
  measurements: Measurements;
  diagnostics: DiagnosticItem[];
  overallVerdict: OverallVerdict;
}

export type AnalyzerWorkerCommand = {
  type: 'analyze';
  file: File;
};

export type AnalyzerWorkerResponse =
  | {
      type: 'progress';
      progress: number;
      message: string;
    }
  | {
      type: 'result';
      report: AnalysisReport;
    }
  | {
      type: 'error';
      message: string;
      detail?: string;
    };

export interface Ebur128Measurements {
  integratedLufs: number | null;
  truePeakDbtp: number | null;
}
