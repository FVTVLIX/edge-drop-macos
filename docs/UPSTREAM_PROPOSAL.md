# Proposed upstream introduction

Suggested issue title:

```text
[macOS] Working Tauri port proposal
```

Suggested issue body:

---

I have been building a working macOS port of Edge-Drop using Tauri, Rust, React, and Zustand.

The prototype currently supports native clipboard capture for text, URLs, rich HTML, images, files, and folders; native drag-in and drag-out; image and file stacks; grouping, merging, expansion, individual-member copy/drag, and ungrouping; pinning, search, guarded deletion, settings, sensitive-format filtering, and macOS menu bar integration.

I have tried to preserve Edge-Drop's original workflow and visual direction while replacing Windows-specific Electron and Win32 behavior with Tauri, AppKit, and macOS equivalents.

Repository: https://github.com/FVTVLIX/edge-drop-macos

Before submitting a very large pull request, I would like to ask how you would prefer the port to be organized:

1. as an official companion repository;
2. inside Edge-Drop as a macOS/Tauri application;
3. as smaller reusable contributions submitted incrementally; or
4. as a separately maintained community port linked from the upstream documentation.

I am happy to provide a test build, screenshots, architecture notes, and a feature-parity checklist. I would also appreciate guidance on use of the Edge-Drop name and visual assets for a macOS release.

Thank you for creating Edge-Drop and for explicitly welcoming macOS port contributions.

---

Before submitting:

- Add current screenshots or a short screen recording.
- Confirm the repository URL resolves publicly.
- Add a short list of features that still differ from upstream.
- Offer an unsigned development build directly, or a signed/notarized build if one is available.
