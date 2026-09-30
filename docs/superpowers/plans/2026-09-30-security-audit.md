# Security audit and fixes

**Goal:** Audit the complete extension and release path; fix demonstrated threats without new runtime dependencies or permissions.
**Scope/spec:** User request of 2026-09-30: inspect threats throughout the project and resolve them. Preserve saved lessons and the existing workflows.
**Approach:** Reproduce failures with the real modules in isolated tests, fix the shared boundary, then exercise the packaged extension and upgrade flow. Implementation is inline; an independent reviewer checks the final changes.

## Tasks and evidence

- [x] Inventory all tracked runtime/build files, trust boundaries, permissions and baseline tests (10 passed).
- [x] Reproduce and fix inherited-property writes in word statistics (`exercise.js`); test `__proto__` and `constructor` without contaminating the test process.
- [x] Restrict worker storage and message access (`background.js`); test wrong video, sender, frame and malformed requests, and real content-script storage denial.
- [x] Reject malformed/oversized captions before expensive parsing and invalid timestamps before persistence (`exercise.js`, `data.js`); test bounded execution and library recovery.
- [x] Protect the lesson UI from page scripts and constrain caption requests (`content.js`, `youtube.js`); exercise genuine browser input and hostile page events.
- [x] Audit release files/history for secrets, pin down extension-page CSP and exclude secret files; verify installable ZIP.
- [x] Run all unit checks, browser security and upgrade checks; independently review fixes, document scope/results and build a new versioned ZIP.

## Review focus

- Existing lessons and backup formats remain readable; missing legacy optional values keep defaults.
- Reserved JavaScript property names are valid vocabulary, never shared-object properties.
- Invalid input never overwrites the existing lesson or hangs its tab.
- User input, file imports, dialogs and keyboard controls keep working after UI isolation.
- The package contains only the release allowlist; no signing material or browser profiles.

## Progress

Baseline commit: `6158d8b`. Working branch: `codex/security-hardening`.
Independent read-only audits: UI/YouTube and release/history. No account settings changed.

Completed: 20 Node checks, Chromium security/upgrade checks, live Chromium/Edge/Opera GX checks. The final reviewer found no blockers and independently compared 20,000 rolling-caption cases against the baseline with identical results. No schema migration or runtime dependency was added. UI tests use privileged browser APIs to inspect the actual closed root; no production test hooks.

Decision: closed shadow is DOM hardening, not full isolation from earlier page keyboard listeners. This limitation is stated in PRIVACY.md and the audit report. Full input isolation would require a separate extension-origin interface and is outside this corrective release. Branded Chrome toolbar testing remains manual.
