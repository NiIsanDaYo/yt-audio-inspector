# YouTube音源診断

YouTube向けの音声マスターで守るべき3点を、ブラウザ内で自動チェックする静的Webアプリです。

1. **True Peak** --- -1.0 dBTP 以下か
2. **48 kHz / 24-bit PCM** --- サンプルレートとビット深度
3. **二重圧縮リスク** --- ロスレスかどうか（非可逆なら警告）

Integrated LUFS は参考値として表示しますが、総合判定には含めません（-14 LUFS に合わせる必要はないため）。

ファイルはアップロードされません。解析はすべて ffmpeg.wasm とメタデータパーサによりブラウザ内で完結します。音声の補正・正規化・変換・書き出しは行いません。

## プライバシー

- 選択したファイルはこのアプリからアップロードされません。
- 解析はブラウザ内の Web Worker と ffmpeg.wasm で実行します。
- 音声の補正・正規化・変換・書き出しは行いません。

## 対応形式

- **音声（推奨）**: WAV / AIFF / FLAC / M4A / AAC / MP3 / Opus / OGG
- **動画（音声トラックを解析）**: MP4 / MOV / MKV / WebM / AVI / WMV / FLV / MPG

動画は音声トラックのみを解析します。可能ならWAV/FLACなどの音声ファイルで確認してください。200 MB を超えるファイルには警告が出ます。500 MB を超えるファイルはブラウザのメモリ制限を考慮してブロックされます。

## 開発

```sh
npm install
npm run dev
```

表示されたローカル URL を開き、音声ファイルをドラッグ & ドロップまたはファイル選択で投入します。

## テスト

```sh
npm run test          # 単体テスト (Vitest)
npm run build         # TypeScript 型チェック + Vite ビルド
npm run test:e2e      # E2E テスト (Playwright + Chromium)
```

E2E テストは `scripts/generate-fixtures.mjs` で音声フィクスチャを生成し、ネイティブ ffmpeg の ebur128 測定結果とブラウザ解析結果を突合します。E2E の実行にはシステムに ffmpeg がインストールされている必要があります。

## 静的配信

```sh
npm run build
```

`dist/` を静的ホストへ配置してください。`public/ffmpeg-core/` は Vite の public assets として配信されます。

Cloudflare Pages へデプロイする場合は、単一ファイル25 MiB制限を避けるため、ビルドコマンドに以下を指定してください。

```sh
npm run build:pages
```

このコマンドは `ffmpeg-core.wasm` を Brotli 圧縮済みの `ffmpeg-core.wasm.br` として `dist/` に配置し、元の30 MiB超の `.wasm` は出力から削除します。

ffmpeg.wasm は SharedArrayBuffer を使用するため、配信サーバーに以下のレスポンスヘッダーが必要です。

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## 構成

```
src/
  App.tsx                 UI (React)
  analyzer.worker.ts      Web Worker --- ffmpeg.wasm 実行・メタデータ解析
  styles.css              スタイル
  types.ts                共有型定義
  lib/
    codec.ts              コーデック分類・フレンドリ名
    diagnostics.ts        5 項目の判定ルール・総合判定
    ffmpegLog.ts          ebur128 ログパーサ
    fileLimits.ts         ファイルサイズ定数
    fileTypes.ts          対応拡張子・file input accept 定義
    format.ts             表示用フォーマッタ
    metadataParsers.ts    WAV / AIFF / FLAC ヘッダパーサ
tests/
  unit/                   Vitest 単体テスト
  e2e/                    Playwright E2E テスト
  fixtures/               テスト用音声ファイル（generate-fixtures.mjs で生成）
```

## ライセンス

このプロジェクトのソースコードは MIT License です。詳細は `LICENSE` を参照してください。

`public/ffmpeg-core/` には第三者の ffmpeg.wasm core assets を同梱しています。これらは本プロジェクトのMITライセンスで再ライセンスされません。詳細は `NOTICE.md` を参照してください。
