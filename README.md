# Edge-Drop for macOS

> An unofficial macOS port of [Deepender25/Edge-Drop](https://github.com/Deepender25/Edge-Drop), rebuilt with Tauri and Rust.

Edge-Drop for macOS is a hover-activated clipboard shelf that lives at the edge of the screen. It preserves the original project's core workflow—collect content once, then drag or copy it directly into another app—while replacing Windows-specific Electron and Win32 integrations with native macOS pasteboard, window, and drag behavior.

This port is under active development. It is not currently an official release of the upstream Edge-Drop project.

## Current features

- Hover-activated, transparent, always-on-top edge panel
- Plain text, URL, rich HTML, image, file, and folder capture
- Native drag-in and drag-out without manual copy commands
- Native macOS clipboard writes for text, images, files, and folders
- Image and file stacks with a maximum of 10 members
- Stack grouping, merging, expansion, individual member drag/copy, and ungrouping
- Image previews and Finder-aware file/folder labels
- Pinning, search, guarded deletion, and clear-unpinned behavior
- Clipboard deduplication and self-copy suppression
- Sensitive clipboard-format filtering and incognito mode
- Configurable edge position, trigger area, panel sizing, history limit, appearance, and drag-preview size
- macOS menu bar integration

## Technology

- [Tauri 2](https://tauri.app/)
- Rust
- React 18
- TypeScript
- Zustand
- Framer Motion
- AppKit pasteboard APIs where native behavior is required

## Development

### Requirements

- macOS
- Node.js 18 or newer
- Rust stable
- Xcode Command Line Tools

### Run locally

```bash
npm install
npm run tauri dev
```

Move the pointer to the configured screen edge or use the menu bar item to reveal the shelf.

### Validate

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

### Build the macOS application

```bash
npm run tauri build
```

Unsigned local builds may trigger Gatekeeper warnings when shared with another Mac. A broadly distributed release should be signed and notarized with an Apple Developer ID.

## Project structure

```text
src/                 React interface and state
src-tauri/src/       Rust clipboard, storage, drag, window, tray, and settings code
src-tauri/icons/     Application bundle icons
public/              Renderer assets
```

## Upstream relationship

This project is based on the ideas, interaction model, and visual direction of [Edge-Drop](https://github.com/Deepender25/Edge-Drop) by [Deepender25](https://github.com/Deepender25).

The upstream project explicitly welcomes macOS porting contributions. This repository exists so the working Tauri implementation can be reviewed and tested before deciding whether it should become:

- an official companion repository;
- a macOS application inside the upstream repository;
- a set of smaller upstream contributions; or
- a separately maintained community port.

The proposed upstream introduction is available in [docs/UPSTREAM_PROPOSAL.md](docs/UPSTREAM_PROPOSAL.md).

## Contributing

Bug reports and focused pull requests are welcome. For substantial behavior or architecture changes, please open an issue first.

When reporting clipboard problems, include:

- the source application;
- the destination application;
- the content type;
- whether Copy, drag-in, or drag-out was used; and
- the macOS version.

## License and attribution

Licensed under the Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

The Edge-Drop name and upstream project identity are used here to describe the origin and compatibility goal of this port. This repository is labeled unofficial unless and until the upstream maintainer adopts or endorses it.
