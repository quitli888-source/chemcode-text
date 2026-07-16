# Changelog

## 1.3.2 - 2026-07-17

### Fixed

- Restored the source PyGAMD workflow requirement that missing H1 dependencies must be installed and import-tested before proceeding.
- Prevented the agent from approving H1 with only a warning and a matplotlib fallback when OVITO is missing.

### Added

- Added `check_environment.py --install-missing --json` to bootstrap and verify PyGAMD, Numba/CUDA, NumPy, Matplotlib, and OVITO.
- Updated the bundled PyGAMD skill to v0.4.1.

### Verified

- Installed OVITO 3.15.5 and rendered the existing AB diblock production trajectory through the bundled OVITO renderer.

## 1.3.1 - 2026-07-17

### Fixed

- Prevented the global token limiter from entering a zero-delay `NaN` loop after its rolling request window expired.
- Made cancellation interrupt requests waiting for a rate-limit slot.
- Limited the strict 3-request/28K-token rolling quota to ModelArts endpoints instead of throttling DeepSeek and other providers.

### Verified

- Completed the PyGAMD seven-checkpoint AB diblock copolymer workflow with all mandatory confirmations.
- Ran 15,000 MVP steps and 20,000 production steps on PyGAMD 1.4.8 with an NVIDIA RTX 5070 Laptop GPU.
- Generated real trajectories, thermodynamic logs, physical-consistency results, RDF/MSD/Rg analyses, and morphology/temperature/energy plots.

## 1.3.0 - 2026-07-16

### Added

- Adapted the updated WorkBuddy PyGAMD seven-step research workflow for Chemcode.
- Added opt-in Windows CUDA 13.2 GPU initialization diagnostics.
- Added OVITO rendering for PyGAMD/GALAMOST XML trajectories.

### Changed

- Expanded mandatory PyGAMD approval gates from five simulation phases to seven research-workflow stages.
- Persisted PyGAMD checkpoint progress in the session confirmation manager across chat turns.
- Preserved Chemcode's corrected XML analysis, strict physical thresholds, and staged simulation runner instead of overwriting them with older source scripts.

## 1.2.0 - 2026-07-16

### Added

- Added a mandatory `human_checkpoint` tool for scientific workflows.
- Defined five ordered PyGAMD approval gates covering environment, system setup, preflight checks, equilibration, and production results.
- Added regression tests for required confirmations, allowlist behavior, and confirmation timeouts.

### Changed

- Made required workflow confirmations immune to Full Access and per-tool allowlists.
- Added explicit timeout feedback and mandatory-checkpoint labeling in the chat UI.
- Split the PyGAMD demo into separate prepare, equilibration, and production phases.
- Tightened the demo physical-consistency input so its default report passes the documented virial threshold.

## 1.1.0 - 2026-07-16

### Fixed

- Correlated concurrent streaming events with the correct assistant message.
- Made task, session and mock-agent cancellation stop active execution.
- Persisted sub-agent conversations and restored session history correctly.
- Recorded user-side usage messages instead of reporting zero user messages.
- Prevented repeated context-compaction failures and bounded automatic continuation.
- Improved token estimation for Chinese and other CJK text.
- Reattached active runs after WebSocket reconnects without leaking stale clients.
- Added session-history pagination and corrected large knowledge-base persistence.
- Extracted PPTX and XLSX text from their ZIP/XML structure.
- Made PyGAMD trajectory analysis read XML trajectories directly and handle missing RDF peaks.
- Synchronized physical-consistency thresholds and DPD parameter guidance.
- Corrected the demo bond stiffness and removed unusable script placeholders and references.

### Added

- Run registry and cancellation regression tests.
- Streaming event-correlation tests.
- Compressed PPTX/XLSX extraction tests.
- Local PDF extraction and improved file-ingestion support.
