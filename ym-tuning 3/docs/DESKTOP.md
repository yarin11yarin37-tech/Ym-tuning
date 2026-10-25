# Getting the desktop app

**Web demo (Vercel):** the whole workshop runs in the browser — ECU/TCU, calibration environment,
exhaust-sound analysis, assistant, version comparison, backups, action log and the performance lab
with Pops & Bangs sound. Data lives in memory and is cleared on reload; file import uses the browser
file picker and exports are downloads. There is no vehicle or adapter access in the browser.

**Desktop app:** everything above plus Wi‑Fi OBD connection to a real adapter, the local database,
the protected vault on disk, USB enumeration and the optional AI model.

## Option A — automatic build on GitHub (no setup on your computer)

1. The repository root must contain `package.json` and the `.github` folder (not a nested `ym-tuning/` folder).
2. Every push to `main` runs **Build desktop app** (`.github/workflows/desktop.yml`).
   It can also be started by hand: GitHub → Actions → Build desktop app → Run workflow.
3. When the run is green, open it and download the **Artifacts**:
   `YM-TUNING-macOS` (.dmg) and `YM-TUNING-Windows` (.exe installer).

The builds are **unsigned**:
- macOS: right-click the app → Open → Open (first launch only), or System Settings → Privacy & Security → Open Anyway.
- Windows: SmartScreen → More info → Run anyway.

## Option B — build on your own Mac or PC

```bash
npm install
npm test
npm run dev          # run the app in development
npm run dist:mac     # or: npm run dist:win  → installer in ./release
```

## Working with licensed read/write tools

1. Read the controller with your licensed tool (KESS3, KTAG, Autotuner, Flex, bFlash, PCMFlash…).
2. Export an **unencrypted** file: raw `.bin`, Intel HEX, or Motorola S-record.
3. In YM TUNING → ECU or TCU → choose the tool and read method → **Import original**.
   The file is verified (record checksums), stored read-only with SHA-256, and kept byte-for-byte.
4. Import a map definition, open a project, edit in the calibration environment.
5. Calibration environment → **Export for writing** — same format as the original, plus a change report.
6. Write with the licensed tool. YM TUNING does not correct controller checksums and does not write.
