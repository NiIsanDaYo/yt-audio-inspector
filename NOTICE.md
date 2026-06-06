# Notices

This project source code is licensed under the MIT License. That project
license does not relicense third-party dependencies or bundled third-party
assets.

## Bundled ffmpeg.wasm Core Assets

The files under `public/ffmpeg-core/` are prebuilt third-party ffmpeg.wasm
core assets used to run FFmpeg in the browser:

- `public/ffmpeg-core/ffmpeg-core.js`
- `public/ffmpeg-core/ffmpeg-core.wasm`

Relevant upstream projects and license information:

- ffmpeg.wasm: https://github.com/ffmpegwasm/ffmpeg.wasm
- FFmpeg legal information: https://www.ffmpeg.org/legal.html

FFmpeg is generally distributed under LGPL 2.1 or later, but some FFmpeg
build configurations can be GPL depending on enabled components. If these
bundled core assets are replaced or updated, re-check the upstream package and
build license terms before redistribution.

## npm Dependencies

Runtime and development npm dependencies keep their own licenses. See
`package-lock.json` and the corresponding package metadata for exact versions
and license declarations.
