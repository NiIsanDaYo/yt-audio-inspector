import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { AnalysisReport } from '../../src/types';

const fixturesDir = join(process.cwd(), 'tests', 'fixtures');
type TestHookWindow = typeof window & {
  __YTMI_ENABLE_TEST_HOOKS?: boolean;
  __YTMI_APP_READY?: boolean;
  __YTMI_LAST_REPORT?: AnalysisReport;
};

test.beforeAll(() => {
  execFileSync('node', ['scripts/generate-fixtures.mjs'], { stdio: 'inherit' });
});

async function waitForAnalysisSignal(page: import('@playwright/test').Page): Promise<boolean> {
  const signal = page.locator('.progress-panel, .result, .error-panel');
  try {
    await expect(signal.first()).toBeVisible({ timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function setFixtureFile(page: import('@playwright/test').Page, fileName: string): Promise<void> {
  const input = page.locator('input[type="file"]');
  const fixturePath = join(fixturesDir, fileName);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await expect(input).toBeEnabled();
    await input.setInputFiles(fixturePath);
    await input.evaluate((element) => {
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    });
    if (await waitForAnalysisSignal(page)) return;
    await input.evaluate((element: HTMLInputElement) => {
      element.value = '';
    });
  }
  throw new Error(`File selection did not start analysis: ${fileName}`);
}

async function analyzeFixture(page: import('@playwright/test').Page, fileName: string): Promise<AnalysisReport> {
  await page.addInitScript(() => {
    (window as TestHookWindow).__YTMI_ENABLE_TEST_HOOKS = true;
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean((window as TestHookWindow).__YTMI_APP_READY))).toBe(true);
  await setFixtureFile(page, fileName);
  await expect(page.getByText('結果', { exact: true })).toBeVisible({ timeout: 120_000 });
  const report = await page.evaluate(() => (window as TestHookWindow).__YTMI_LAST_REPORT);
  expect(report).toBeTruthy();
  return report!;
}

function expectWithinHalfDb(actual: number | null, expected: number | null) {
  expect(actual).not.toBeNull();
  expect(expected).not.toBeNull();
  expect(Math.abs(actual! - expected!)).toBeLessThanOrEqual(0.5);
}

test('48kHz 24-bit PCM WAV is diagnosed and matches native ffmpeg ebur128', async ({ page }) => {
  const expectedPath = join(fixturesDir, 'expected-ebur128.json');
  expect(existsSync(expectedPath)).toBeTruthy();
  const expected = JSON.parse(readFileSync(expectedPath, 'utf8')).good;
  const report = await analyzeFixture(page, 'good-48k24.wav');

  expect(report.metadata.sampleRate).toBe(48_000);
  expect(report.metadata.bitDepth).toBe(24);
  expect(report.metadata.codecClass).toBe('lossless');
  expect(report.overallVerdict).toBe('ok');
  expectWithinHalfDb(report.measurements.integratedLufs, expected.integratedLufs);
  expectWithinHalfDb(report.measurements.truePeakDbtp, expected.truePeakDbtp);
  await expect(page.getByText('ファイルはアップロードされません')).toBeVisible();
});

test('128 kbps MP3 is flagged for double compression risk', async ({ page }) => {
  const report = await analyzeFixture(page, 'lossy-128k.mp3');
  const codecRisk = report.diagnostics.find((item) => item.id === 'codec-risk');
  expect(report.metadata.codecClass).toBe('lossy');
  expect(report.metadata.container).toBe('MP3');
  expect(codecRisk?.level).toBe('caution');
  expect(codecRisk?.value).toContain('MP3');
  expect(codecRisk?.value).toContain('kbps');
});

test('analysis can be cancelled while ffmpeg is loading', async ({ page }) => {
  let cancelled = false;
  let releaseWasm: (() => void) | undefined;
  let resolveWasmRequestStarted: () => void = () => {};
  const wasmRequestStarted = new Promise<void>((resolve) => {
    resolveWasmRequestStarted = resolve;
  });

  await page.route('**/ffmpeg-core/ffmpeg-core.wasm', async (route) => {
    if (!cancelled) {
      resolveWasmRequestStarted();
      await new Promise<void>((release) => {
        releaseWasm = release;
      });
    }
    await route.abort('aborted');
  });

  await page.addInitScript(() => {
    (window as TestHookWindow).__YTMI_ENABLE_TEST_HOOKS = true;
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean((window as TestHookWindow).__YTMI_APP_READY))).toBe(true);

  await setFixtureFile(page, 'good-48k24.wav');
  await expect(page.getByText('準備中')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('progressbar', { name: '準備中' })).toBeVisible();
  await Promise.race([
    wasmRequestStarted,
    new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('ffmpeg wasm request was not intercepted')), 10_000);
    })
  ]);

  const cancelButton = page.getByRole('button', { name: '解析を中止' });
  await expect(cancelButton).toBeVisible();
  await cancelButton.click();
  cancelled = true;
  releaseWasm?.();

  await expect(cancelButton).toBeHidden();
  await expect(page.getByText('結果', { exact: true })).toBeHidden();
  await expect(page.getByRole('alert')).toBeHidden();
  await expect(page.locator('input[type="file"]')).toBeFocused();
});

test('unsupported SharedArrayBuffer environment shows clear guidance', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'SharedArrayBuffer', { value: undefined, configurable: true });
    Object.defineProperty(window, 'crossOriginIsolated', { value: false, configurable: true });
  });

  await page.goto('/');

  await expect(page.getByRole('alert')).toContainText('SharedArrayBuffer');
  await expect(page.locator('input[type="file"]')).toBeDisabled();
});

test('video with audio is analyzed and video without audio shows a clear error', async ({ page }) => {
  const report = await analyzeFixture(page, 'video-audio.mp4');
  expect(report.metadata.extension).toBe('mp4');
  expect(report.metadata.container).toBe('MP4');
  expect(report.measurements.truePeakDbtp).not.toBeNull();
  await expect(page.getByText('動画は音声トラックのみを解析します')).toBeVisible();

  await page.goto('/');
  await setFixtureFile(page, 'video-no-audio.mp4');
  await expect(page.getByRole('alert')).toContainText('音声ストリーム', { timeout: 120_000 });
});

test('44.1kHz audio is informational and clipped float WAV is warning', async ({ page }) => {
  const sample441 = await analyzeFixture(page, 'sample-441.wav');
  expect(sample441.diagnostics.find((item) => item.id === 'sample-rate')?.level).toBe('info');

  const clipped = await analyzeFixture(page, 'clipped-float.wav');
  expect(clipped.measurements.truePeakDbtp ?? -1).toBeGreaterThanOrEqual(0);
  expect(clipped.diagnostics.find((item) => item.id === 'true-peak')?.level).toBe('warning');
  expect(clipped.overallVerdict).toBe('has-warning');
  await expect(page.locator('.summary-warning')).toContainText('True Peak');
});

test('invalid, broken, and zero-length files show clear errors', async ({ page }) => {
  await page.goto('/');
  await setFixtureFile(page, 'not-audio.txt');
  await expect(page.getByRole('alert')).toContainText('非対応形式');

  await setFixtureFile(page, 'broken.wav');
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 120_000 });

  await setFixtureFile(page, 'zero.wav');
  await expect(page.getByRole('alert')).toContainText('長さ0', { timeout: 120_000 });
});
