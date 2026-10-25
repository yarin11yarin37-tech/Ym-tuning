# YM TUNING — Supported hardware and adapter limitations

**Status: no physical adapter or vehicle has been tested yet.** Everything below describes what
the software implements and has been verified against an in-process ELM327 emulator
(`tests/helpers/fakeElm.ts`). Do not claim compatibility with a specific adapter or vehicle
until it has been tested and recorded in the table at the end of this file.

## What is supported

| Item | Support |
|---|---|
| Transport | Wi‑Fi OBD‑II adapters exposing a raw **TCP socket** (ELM327 command set) |
| Adapter identification | `ATI` must contain `ELM327`, `OBDLink`, `STN####`, `vLinker` or `OBDII`; anything else → `UNSUPPORTED_PROTOCOL` |
| Vehicle protocols | Whatever the adapter negotiates with `ATSP0` (automatic) — CAN ISO 15765‑4 and legacy protocols are decoded |
| OBD‑II services | Mode 01 (live data), 03 / 07 / 0A (stored / pending / permanent DTCs), 09 02 / 04 / 0A (VIN, calibration ID, ECU name) |
| Operation mode | **Read‑only.** Enforced in `electron/obd/commandPolicy.ts` before any byte is written |

## What is NOT supported

- **ECU flashing / programming** — not implemented and not possible through ELM327‑class Wi‑Fi
  adapters. Programming requires J2534 / manufacturer interfaces, stable power, security access
  and OEM calibration files.
- **Manufacturer‑specific diagnostics** (UDS/KWP enhanced PIDs, coding, adaptations) — not in this version.
- **Clearing DTCs** (mode 04) and **actuator tests** (mode 08) — blocked by the read‑only policy.
- **USB devices** — serial-class USB devices are listed (macOS `/dev/cu.*`, Windows `Win32_SerialPort`), but never shown as able to talk to a vehicle. No USB protocol driver is implemented.
- **YM VCI hardware** — not released; no USB identifiers are defined, so it is never "detected".
- **Reading or writing ECU/TCU files** — not implemented. Originals are imported from files; write stays disabled (see `docs/STATUS.md`).
- **UDP discovery** — not implemented: none of the target adapters documents a UDP discovery
  protocol. Add one in `electron/obd/discovery.ts` only together with vendor documentation.
- Host names — adapters are addressed by **private / link‑local IPv4 only**.

## Network behaviour (Mac and Windows)

Most Wi‑Fi ELM327 adapters create their own access point and have **no internet uplink**.
When the computer joins that network:

- The OBD link works without internet — it is local TCP traffic.
- If the adapter network is the computer's *only* active interface, there is no internet.
  The app detects this (`net:advice`) and explains it.
- Options for simultaneous internet:
  1. A second interface for internet — Ethernet, USB‑Ethernet, or USB tethering from a phone.
  2. An adapter that supports **station mode** (joins your existing Wi‑Fi instead of creating one).
  3. A route that sends only the adapter subnet over Wi‑Fi (advanced; OS‑specific).

Commonly seen factory endpoints are offered as **unverified presets**: `192.168.0.10:35000`
and `192.168.1.10:35000`. Always check your adapter's manual — address, port and firmware vary.

## Discovery rules

- No subnet sweeps. Only endpoints the user ticks are probed.
- Each endpoint must be on a subnet the computer is attached to (loopback allowed for emulators).
- Maximum 8 endpoints, 2 in parallel, 1.5 s timeout each, only `ATI` is sent.

## Timeouts and errors

| Code | Meaning |
|---|---|
| `INVALID_SETTINGS` | Bad IP / port / timeout, or non‑local address — no socket is opened |
| `UNREACHABLE` | Connection refused / no route |
| `TIMEOUT` | No TCP answer, or no `>` prompt within the command timeout |
| `CANCELLED` | User cancelled the attempt |
| `UNSUPPORTED_PROTOCOL` | Something answered, but not an ELM327‑compatible adapter |
| `CONNECTION_LOST` | Socket closed while connected → status `lost`, "reconnect" offered |
| `COMMAND_REJECTED` | Blocked by the read‑only policy |

## Field test log

Fill this in as real hardware is tested. Until a row exists, that adapter/vehicle is untested.

| Date | Adapter (model, firmware) | Endpoint | Vehicle (make, model, year) | Protocol | Result / notes |
|---|---|---|---|---|---|
| — | — | — | — | — | — |
