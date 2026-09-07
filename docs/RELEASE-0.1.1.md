# Edge Drop for macOS 0.1.1

## Included

- Existing local improvements: display selection, seam-aware activation, mixed image/file stacks, image restoration when ungrouping, and copy/drag usage counts.
- Clicking the currently previewed card or empty shelf space dismisses the preview.
- Shelf movement and clipping share a 320 ms ease-out animation. Bounce remains optional; Reduce Motion disables shelf motion.
- Malformed or truncated URL escapes preserve the domain and readable preview instead of losing the preview metadata.

## Repository review

Mac origin/main was current at `a20fa6f`. Reviewed original upstream history through `38ad585d` (2026-09-03): https://github.com/Deepender25/Edge-Drop/commit/38ad585d

Windows registry/startup, Explorer clipboard, Electron packaging, and Russian translation changes do not apply directly to this native Mac implementation. The upstream emoji picker, expanded URL brand registry, bundled typography, and complete visual redesign are not included in this maintenance release. This is not a claim of full upstream feature parity.

## Build

Run `npm run tauri build -- --target universal-apple-darwin` with both Rust Apple targets installed. The universal app supports Apple Silicon and Intel Macs. Build output is under `src-tauri/target/universal-apple-darwin/release/bundle/`.

This is a local build without Developer ID signing or Apple notarization. GitHub publishing is separate from packaging.
