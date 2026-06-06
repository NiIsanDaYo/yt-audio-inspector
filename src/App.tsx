import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisReport, AnalyzerWorkerResponse, DiagnosticItem, Severity } from './types';
import { formatBytes, overallLabels, severityLabels } from './lib/format';
import { REFERENCE_DIAGNOSTIC_IDS } from './lib/diagnostics';
import { LARGE_FILE_NOTICE_BYTES, MAX_ANALYSIS_FILE_BYTES } from './lib/fileLimits';
import { FILE_INPUT_ACCEPT, VIDEO_EXTENSION_SET, extensionFromName } from './lib/fileTypes';

const SEVERITY_RANK: Record<Severity, number> = { normal: 0, info: 1, caution: 2, warning: 3 };

type AppState = 'idle' | 'analyzing' | 'done' | 'error';
type TestHookWindow = typeof window & {
  __YTMI_ENABLE_TEST_HOOKS?: boolean;
  __YTMI_APP_READY?: boolean;
  __YTMI_LAST_REPORT?: AnalysisReport;
};

function createAnalyzerWorker(): Worker {
  return new Worker(new URL('./analyzer.worker.ts', import.meta.url), { type: 'module' });
}

function browserCompatibilityError(): string | null {
  if (typeof SharedArrayBuffer === 'undefined') {
    return 'このブラウザでは解析に必要なSharedArrayBufferを利用できません。最新版のブラウザで開いてください。';
  }
  if (!window.crossOriginIsolated) {
    return 'この配信環境では解析に必要なSharedArrayBufferを利用できません。サイト管理者はCOOP/COEPヘッダー設定を確認してください。';
  }
  return null;
}

function fileNotices(file: File): string[] {
  if (file.size > MAX_ANALYSIS_FILE_BYTES) return [];

  const extension = extensionFromName(file.name);
  const isVideo = VIDEO_EXTENSION_SET.has(extension) || file.type.startsWith('video/');
  const notices: string[] = [];
  if (isVideo) {
    notices.push('動画は音声トラックのみを解析します。可能なら音声ファイル（WAV / FLAC など）での確認を推奨します。');
  }
  if (file.size > LARGE_FILE_NOTICE_BYTES) {
    notices.push('大容量ファイルは解析に時間がかかることがあります。2GBを超える場合は音声ファイルを書き出してから確認してください。');
  }
  return notices;
}

function SeverityBadge({ level }: { level: Severity }) {
  return <span className={`badge badge-${level}`}>{severityLabels[level]}</span>;
}

function DiagnosticRow({ item }: { item: DiagnosticItem }) {
  return (
    <article className={`diagnostic diagnostic-${item.level}`}>
      <div className="diagnostic-heading">
        <div>
          <h3>{item.label}</h3>
          <p className="diagnostic-value">{item.value}</p>
        </div>
        <SeverityBadge level={item.level} />
      </div>
      <p className="diagnostic-reason">{item.reason}</p>
      <p className="diagnostic-reco">{item.recommendation}</p>
    </article>
  );
}

function resultSummary(worst: DiagnosticItem | null): string {
  if (!worst || SEVERITY_RANK[worst.level] < SEVERITY_RANK.caution) {
    return '必須項目に注意・警告はありません';
  }
  if (worst.id === 'true-peak') {
    return `True Peak ${worst.value}（${worst.reason.replace(/。$/, '')}）`;
  }
  return `${worst.label}：${worst.recommendation.replace(/。$/, '')}`;
}

function ResultView({ report }: { report: AnalysisReport }) {
  const core = report.diagnostics.filter((item) => !REFERENCE_DIAGNOSTIC_IDS.has(item.id));
  const reference = report.diagnostics.filter((item) => REFERENCE_DIAGNOSTIC_IDS.has(item.id));
  const worst = core.reduce<DiagnosticItem | null>(
    (acc, item) => (acc && SEVERITY_RANK[acc.level] >= SEVERITY_RANK[item.level] ? acc : item),
    null
  );
  const needsAction = worst !== null && SEVERITY_RANK[worst.level] >= SEVERITY_RANK.caution;
  const summaryClass = !needsAction
    ? 'summary-ok'
    : worst?.level === 'warning'
      ? 'summary-warning'
      : 'summary-action';

  return (
    <section className="result" aria-live="polite">
      <div className="result-header">
        <div>
          <p className="eyebrow">結果</p>
          <h2>{report.metadata.fileName}</h2>
          <p className="file-meta">
            {formatBytes(report.metadata.fileSize)} / {report.metadata.container}
          </p>
        </div>
        <span className={`overall overall-${report.overallVerdict}`}>{overallLabels[report.overallVerdict]}</span>
      </div>

      <p className={`summary ${summaryClass}`}>
        {resultSummary(worst)}
      </p>

      <section className="diagnostics" aria-labelledby="core-title">
        <h2 id="core-title">必須チェック</h2>
        <div className="diagnostic-list">
          {core.map((item) => (
            <DiagnosticRow key={item.id} item={item} />
          ))}
        </div>
      </section>

      {reference.length > 0 && (
        <section className="diagnostics reference" aria-labelledby="reference-title">
          <h2 id="reference-title">参考（合わせる必要はありません）</h2>
          <div className="diagnostic-list">
            {reference.map((item) => (
              <DiagnosticRow key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
    </section>
  );
}

function exposeReportForTests(report: AnalysisReport): void {
  const testWindow = window as TestHookWindow;
  if (testWindow.__YTMI_ENABLE_TEST_HOOKS) {
    testWindow.__YTMI_LAST_REPORT = report;
  }
}

export default function App() {
  const workerRef = useRef<Worker | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const handledFileKeyRef = useRef<string | null>(null);
  const fileFallbackTimerRef = useRef<number | null>(null);
  const dragDepthRef = useRef(0);
  const [state, setState] = useState<AppState>('idle');
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [report, setReport] = useState<AnalysisReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  const [compatibilityError] = useState(browserCompatibilityError);

  const clearFileFallback = useCallback(() => {
    if (fileFallbackTimerRef.current !== null) {
      window.clearInterval(fileFallbackTimerRef.current);
      fileFallbackTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearFileFallback();
      workerRef.current?.terminate();
    };
  }, [clearFileFallback]);

  useEffect(() => {
    const testWindow = window as TestHookWindow;
    if (testWindow.__YTMI_ENABLE_TEST_HOOKS) {
      testWindow.__YTMI_APP_READY = true;
    }
  }, []);

  const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

  const analyzeFile = useCallback((file: File) => {
    workerRef.current?.terminate();
    const worker = createAnalyzerWorker();
    workerRef.current = worker;
    setState('analyzing');
    setReport(null);
    setError(null);
    setProgress(0);
    setProgressMessage('解析中');
    setNotices(fileNotices(file));

    worker.onmessage = (event: MessageEvent<AnalyzerWorkerResponse>) => {
      if (workerRef.current !== worker) return;
      const message = event.data;
      if (message.type === 'progress') {
        setProgress(message.progress);
        setProgressMessage(message.message);
      } else if (message.type === 'result') {
        setReport(message.report);
        setProgress(1);
        setProgressMessage('完了');
        setState('done');
        exposeReportForTests(message.report);
        worker.terminate();
        workerRef.current = null;
      } else if (message.type === 'error') {
        setError(message.message);
        setState('error');
        setProgress(0);
        setProgressMessage('');
        worker.terminate();
        workerRef.current = null;
      }
    };

    worker.onerror = (event) => {
      if (workerRef.current !== worker) return;
      setError(event.message || 'Workerの初期化に失敗しました。');
      setState('error');
      worker.terminate();
      workerRef.current = null;
    };

    worker.postMessage({ type: 'analyze', file });
  }, []);

  const cancelAnalysis = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    handledFileKeyRef.current = null;
    clearFileFallback();
    setState('idle');
    setReport(null);
    setError(null);
    setNotices([]);
    setProgress(0);
    setProgressMessage('');
    window.requestAnimationFrame(() => {
      fileInputRef.current?.focus();
    });
  }, [clearFileFallback]);

  const handleFiles = useCallback((files: FileList | null, force = false) => {
    const file = files?.item(0);
    if (!file) return;

    clearFileFallback();
    if (compatibilityError) {
      setReport(null);
      setError(null);
      setState('idle');
      setNotices([]);
      return;
    }

    const nextFileKey = fileKey(file);
    if (!force && handledFileKeyRef.current === nextFileKey) return;

    handledFileKeyRef.current = nextFileKey;
    analyzeFile(file);
  }, [analyzeFile, clearFileFallback, compatibilityError]);

  const startFileFallback = useCallback((input: HTMLInputElement) => {
    clearFileFallback();
    const startedAt = Date.now();
    fileFallbackTimerRef.current = window.setInterval(() => {
      if (input.files?.length) {
        handleFiles(input.files);
        return;
      }
      if (Date.now() - startedAt > 10_000) {
        clearFileFallback();
      }
    }, 150);
  }, [clearFileFallback, handleFiles]);

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragging(false);
    handleFiles(event.dataTransfer.files, true);
  };

  return (
    <main className="app">
      <section className="hero">
        <h1>YouTube音源診断</h1>
        <p className="privacy">ファイルはアップロードされません。すべてブラウザ内で解析します。</p>
      </section>

      <section
        className={`dropzone ${dragging ? 'is-dragging' : ''}`}
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepthRef.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
          if (dragDepthRef.current === 0) {
            setDragging(false);
          }
        }}
        onDrop={onDrop}
      >
        <div>
          <label className="file-label" htmlFor="audio-file-input">音声ファイルを選択</label>
          <p>WAV / FLAC / AIFF / M4A / MP3 / Opus / OGG</p>
          <p className="dropzone-sub">動画も可：MP4 / MOV / MKV / WebM / AVI / WMV / FLV / MPG</p>
        </div>
        <input
          ref={fileInputRef}
          id="audio-file-input"
          className="file-input"
          type="file"
          accept={FILE_INPUT_ACCEPT}
          aria-describedby={compatibilityError ? 'compatibility-error' : undefined}
          disabled={state === 'analyzing' || Boolean(compatibilityError)}
          onClick={(event) => {
            event.currentTarget.value = '';
            handledFileKeyRef.current = null;
            startFileFallback(event.currentTarget);
          }}
          onInput={(event) => handleFiles(event.currentTarget.files)}
          onChange={(event) => handleFiles(event.target.files)}
        />
      </section>

      {compatibilityError && (
        <section id="compatibility-error" className="error-panel" role="alert">
          <strong>この環境では解析できません</strong>
          <p>{compatibilityError}</p>
        </section>
      )}

      {notices.length > 0 && (
        <section className="notice-panel" role="status">
          <ul>
            {notices.map((notice) => (
              <li key={notice}>{notice}</li>
            ))}
          </ul>
        </section>
      )}

      {state === 'analyzing' && (
        <section className="progress-panel" aria-live="polite">
          <div className="progress-head">
            <strong>{progressMessage}</strong>
            <span>{Math.round(progress * 100)}%</span>
          </div>
          <div
            className="progress-track"
            role="progressbar"
            aria-label={progressMessage || '解析進捗'}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <div style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="progress-actions">
            <button className="cancel-button" type="button" onClick={cancelAnalysis}>
              解析を中止
            </button>
          </div>
        </section>
      )}

      {state === 'error' && error && (
        <section className="error-panel" role="alert">
          <strong>エラー</strong>
          <p>{error}</p>
        </section>
      )}

      {report && <ResultView report={report} />}

      <footer className="site-footer">
        <div className="footer-links">
          <a className="footer-card" href="https://niisan.org/" target="_blank" rel="noopener noreferrer">
            <span className="footer-card-label">NiIsan.org</span>
            <span className="footer-card-arrow">↗</span>
          </a>
          <a className="footer-card" href="https://note.com/bkh23desuyo/n/n6049260b09a8" target="_blank" rel="noopener noreferrer">
            <span className="footer-card-label">
              <svg className="footer-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 3h10.5L21 9.5V21H3V3z" />
                <line x1="14" y1="3" x2="14" y2="10" />
                <line x1="14" y1="10" x2="21" y2="10" />
              </svg>
              解説記事
            </span>
            <span className="footer-card-arrow">↗</span>
          </a>
          <a className="footer-card" href="https://github.com/NiIsanDaYo/yt-audio-inspector" target="_blank" rel="noopener noreferrer">
            <span className="footer-card-label">
              <svg className="footer-card-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.477 2 2 6.477 2 12c0 4.418 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.009-.868-.013-1.703-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0 1 12 6.836a9.59 9.59 0 0 1 2.504.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.202 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.579.688.481C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
              </svg>
              ソースコード
            </span>
            <span className="footer-card-arrow">↗</span>
          </a>
        </div>
      </footer>
    </main>
  );
}
