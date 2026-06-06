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

async function setFixtureFile(page: import('@playwright/test').Page, fileName: string): Promise<void> {
  const input = page.locator('input[type="file"]');
  await expect(input).toBeEnabled();
  await input.setInputFiles(join(fixturesDir, fileName));
  await input.evaluate((element) => {
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
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
