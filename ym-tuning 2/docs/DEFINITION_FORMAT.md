# YM definition format — `ym-def/1`

YM TUNING never detects maps by guessing. A map exists in the app only if a definition file
describes it. Definitions are imported per controller and are always shown as
**"imported — not verified by YM TUNING"** (or "simulated" for demo data).

```json
{
  "format": "ym-def/1",
  "name": "Example ECU definition",
  "controller": { "kind": "ecu", "hwIds": ["HW-123"], "swIds": ["SW-0456"] },
  "fileSize": 262144,
  "source": "Who wrote this definition and how it was validated",
  "maps": [
    {
      "id": "boost_tgt",
      "name": "יעד גדישה",
      "tag": "boost.target",
      "address": 16896,
      "rows": 8, "cols": 12,
      "dataType": "u16le",
      "scale": 0.001, "offset": 0,
      "unit": "bar",
      "min": 0, "max": 2.5,
      "xAxis": { "name": "סל\"ד", "unit": "rpm", "values": [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500] },
      "yAxis": { "name": "עומס", "unit": "%", "values": [10, 23, 36, 49, 61, 74, 87, 100] }
    }
  ],
  "conditions": [
    { "id": "drive_mode", "tag": "cond.drive_mode", "name": "מצב נהיגה", "values": ["normal", "sport"] },
    { "id": "ac", "tag": "cond.ac", "name": "מזגן" }
  ]
}
```

| Field | Meaning |
|---|---|
| `controller.kind` | `ecu` or `tcu` — a definition can only be attached to a controller of the same kind |
| `fileSize` | must equal the original file size, otherwise the compatibility check fails |
| `hwIds` / `swIds` | optional; compared with the controller identity |
| `dataType` | `u8`, `u16le`, `u16be`, `s16le`, `s16be` |
| physical value | `raw × scale + offset` |
| `min` / `max` | edits outside this range are rejected (never clamped) |
| `tag` | links the map to the option catalog (see below) |
| `conditions` | signals the controller strategy can use (drive mode, A/C, coolant temperature) |

## Catalog tags

ECU: `torque.request`, `torque.limit`, `boost.target`, `boost.limit`, `ignition.base`,
`fuel.lambda_target`, `fuel.injector`, `throttle.pedal_map`, `rpm.limit`, `protect.thermal`,
`overrun.fuel_cut`, `overrun.ignition`.

TCU: `shift.points`, `shift.time`, `shift.torque_reduction`, `tcu.torque_limit`, `clutch.pressure`,
`shift.mode`, `perf.launch`, `protect.temp`.

An option in the catalog is "available" only when every map it needs is present in the definition.

Emissions-control and anti-theft defeat (catalyst, DPF, EGR, O2 sensors, immobilizer) are blocked
permanently and cannot be enabled by any definition.
