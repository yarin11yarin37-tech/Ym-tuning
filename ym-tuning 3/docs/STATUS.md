# YM TUNING — build status by phase

Legend: **Works** = implemented and covered by automated tests · **Simulated** = demo data only ·
**Not tested on hardware** = implemented, verified only against emulators · **Missing** = not built.

| Phase | Works | Simulated | Not tested on hardware | Missing |
|---|---|---|---|---|
| A — Project review & plan | Existing YM TUNING extended, nothing rebuilt | — | — | — |
| B — Desktop environment | Electron + React/TS, contextIsolation, sandbox, no nodeIntegration, CSP, validated IPC, sender check, Mac/Windows build scripts | — | Electron app itself was not launched in the build environment | Code signing / notarisation |
| C — Vehicle connection & Wi‑Fi OBD | 3 categories; TCP transport, timeouts, cancel, lost-connection detection, reconnect, profiles, approved-endpoint discovery, default-route + internet check before/after, single‑Wi‑Fi explanation | Demo mode | Real ELM327 adapters (emulator only) | UDP discovery (no documented protocol); USB vehicle communication; YM VCI hardware |
| D — Hebrew UI | Full Hebrew, RTL layout, LTR isolation for VIN/DTC/hex/IP/SHA, localization layer with optional English, tests for missing keys and stray English | — | — | English translation |
| E — Vehicles, diagnostics, sessions | Customers, vehicles, separate ECU/TCU controllers, DTC descriptions (generic SAE codes), session save, Hebrew report export | Demo diagnostic data | Live diagnostics against a real vehicle | Manufacturer DTC descriptions |
| F — Originals & file management | SHA‑256, read‑only originals (DB triggers + read‑only files), one original per controller, integrity re‑check, working copy, immutable versions, diff, export | Demo ECU/TCU files | — | Reading files from a controller (no verified hardware/protocol) |
| G — ECU & TCU calibration | Definition import & validation, compatibility checks, map editor with range enforcement, catalog by real support, exhaust-sound analysis with condition support, review packet, write gate | Demo definitions | — | Verified definitions; checksum algorithms; physical write; restore |
| H — YM assistant | Hebrew rule-based parser (labelled), optional AI model (key in OS keychain), plan → approval → apply → file checks; safety blocks enforced locally | — | AI provider call path tested with a fake transport only | — |
| Tool workflow | Import from licensed tools (raw / Intel HEX / S-record, record checksums verified, tool + read method stored as user-stated), export in the original format with change report, byte-identical export when unchanged | — | Files from real tools | Encrypted tool containers; controller checksum correction |
| Web demo & sound | Whole workshop in the browser (in-memory, same logic), Pops & Bangs overrun sound in the lab (sound only) | All browser data | Sound judged by ear on real speakers | — |
| I — Tests, packaging, docs | 60 automated tests (`npm test`), GitHub Actions builds for Mac (.dmg) and Windows (.exe), screenshots at 1100×700 / 1366×768 / 1440×900 / 1920×1080 | — | `npm run dist:mac` / `dist:win` not run here | — |

## Write safety

Writing to an ECU or TCU is disabled. The readiness check lists every requirement; these are
permanently unmet in this version: verified checksum, stable-voltage measurement, write-capable
hardware, verified write implementation, verified restore. The UI's write button is disabled and
no IPC channel exists for writing.

## Things to verify on your machine

1. `npm install`, `npm test`, `npm run dev`.
2. The local database uses Node's built-in `node:sqlite`. `package.json` targets Electron 37
   (bundled Node 22). If your Electron build does not expose `node:sqlite`, replace the wrapper in
   `electron/db/database.ts` with `better-sqlite3` — it is the only file that touches SQLite.
3. Connect a real Wi‑Fi adapter and record the result in `docs/HARDWARE.md`.
