# Changelog

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
