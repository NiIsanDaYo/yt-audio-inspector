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

function PreFooterSlot() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const script = document.createElement('script');
    script.src = 'https://ar-cdn.net/widget/v1.js';
    script.async = true;
    script.dataset.siteId = '74fd4e95-7b87-42e5-84a8-f875925d7353';
    script.dataset.variant = 'banner';
    el.appendChild(script);
    return () => {
      // script だけでなくウィジェットが注入した要素ごと片付ける
      el.replaceChildren();
    };
  }, []);
  return <div ref={containerRef} className="pre-footer" />;
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
          <p className="dropzone-hint">ここにドラッグ＆ドロップでも解析できます</p>
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

      <PreFooterSlot />

      <footer className="site-footer">
        <div className="footer-links">
          <a href="https://niisan.org/" target="_blank" rel="noopener noreferrer">NiIsan.org</a>
          <a href="https://note.com/bkh23desuyo/n/n6049260b09a8" target="_blank" rel="noopener noreferrer">解説記事</a>
          <a href="https://github.com/NiIsanDaYo/yt-audio-inspector" target="_blank" rel="noopener noreferrer">ソースコード</a>
        </div>
      </footer>
    </main>
  );
}
