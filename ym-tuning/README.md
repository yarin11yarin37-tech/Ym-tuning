# YM TUNING

Hebrew‑first desktop app (macOS / Windows) for OBD‑II diagnostics over Wi‑Fi adapters and an
interactive performance simulator — **מעבדת ביצועים**.

© Yarin Malka. All rights reserved.

## Run

```bash
npm install
npm run dev        # Vite + Electron with hot reload
npm test           # 34 tests, no hardware needed (ELM327 emulator built in)
npm run typecheck
npm run dist:mac   # or dist:win — packaged installer
```

`npm run dev:web` runs the UI in a browser; there the adapter bridge is absent and the app
offers demo mode only.

## Architecture

```
electron/                 main process — the only code that touches the network
  main.ts                 locked-down BrowserWindow, IPC registration, sender check
  preload.ts              exposes window.ymApi (13 validated methods, nothing else)
  ipcHandlers.ts          argument validation; every failure becomes a Result
  profileStore.ts         connection profiles (JSON in userData)
  obd/
    transport.ts          Transport interface + TcpTransport (timeout, cancel, lost detection)
    elm327.ts             command session: serialised, prompt-framed, per-command timeout
    commandPolicy.ts      READ-ONLY gate — mode 04/08, UDS writes, raw bus commands rejected
    decode.ts             PID / DTC / VIN decoders (CAN multi-frame + legacy)
    obdService.ts         connection state machine, identify, live data, DTCs
    discovery.ts          approved-endpoint probing, network/internet advice
shared/types.ts           types + provenance model shared by both sides
src/                      renderer (React)
  i18n/he.ts              every UI string (Hebrew); en.ts = optional future layer
  state/                  session (live / demo), demo backend (all values 'simulated')
  sim/                    deterministic vehicle model, tuning profiles, curves, dyno import
  sim/audio/              Web Audio engine sound (EngineSoundEngine interface)
  screens/                Home, Connect, Vehicle, Diagnostics, Lab, Settings
  ui/                     Gauge, LineChart, Pedal, provenance badges, LTR islands
tests/                    node:test suites (OBD, safety, decode, sim, i18n, discovery)
docs/HARDWARE.md          supported hardware, limitations, field-test log
```

## Data provenance

Every displayed value is `Sourced<T>` with one of: `measured`, `vehicle`, `user`, `estimated`,
`simulated`, rendered as a distinct badge (colour + glyph + text). Model outputs are always
`estimated`; demo data and live lab gauges are `simulated`; dyno CSV imports are `user`.
Nothing in the app currently produces `measured` — it is reserved for verified integrations.

## Engine sound

`src/sim/audio/engineAudio.ts` follows the YM ENGINE LAB approach (firing‑frequency
oscillators, load‑dependent filter, intake noise, turbo whistle). To use the original
YM ENGINE LAB audio module, implement `EngineSoundEngine` with it and swap the constructor in
`src/screens/lab/LiveStage.tsx`.

## Media

No illustrations are used. Places for real vehicle photography / video are marked with
placeholders (`MediaSlot`) on Home, Vehicle identity and the Lab.

## Acceptance criteria (section G)

| Criterion | How it is verified |
|---|---|
| Simulation without hardware | `tests/sim.test.ts` — determinism, limits, gear shifts |
| Invalid settings, timeouts | `tests/obd.test.ts` — invalid/public IP, bad port, silent adapter, unanswered host |
| Disconnect / reconnect | `tests/obd.test.ts` — socket drop → `lost`, reads fail cleanly, reconnect works |
| Hebrew & RTL | `tests/i18n.test.ts` — all keys exist, no hard-coded English, dictionary is Hebrew; screenshots at 1100×700, 1366×768, 1440×900, 1920×1080 |
| Real vs simulated cannot be confused | provenance badges everywhere, demo band, lab "simulation only" flag; demo backend only emits `simulated` |
| Accelerator cannot control the vehicle | `tests/safety.test.ts` — no write/raw/control IPC, sim/lab code cannot import the bridge, policy blocks writes |
| Network errors don't crash | all IPC wrapped in `Result`, main-process last-resort catch, tests on handlers |
| Hardware documentation | `docs/HARDWARE.md` |
| Physical compatibility | **Not yet tested** — see field‑test log |
