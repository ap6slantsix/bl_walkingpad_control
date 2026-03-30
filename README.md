# Walking Pad Controller

![PWA](https://img.shields.io/badge/PWA-enabled-5A0FC8?logo=pwa)
![Bluetooth](https://img.shields.io/badge/Bluetooth-BLE%20%2F%20FTMS-0082FC?logo=bluetooth)
![JavaScript](https://img.shields.io/badge/JavaScript-vanilla-F7DF1E?logo=javascript&logoColor=black)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-bundled-06B6D4?logo=tailwindcss&logoColor=white)
![Chart.js](https://img.shields.io/badge/Chart.js-4-FF6384?logo=chartdotjs&logoColor=white)
![No Build](https://img.shields.io/badge/build-none-brightgreen)
![Offline](https://img.shields.io/badge/offline-ready-success?logo=serviceworker)

---

![Chrome](https://img.shields.io/badge/Chrome-56%2B-4285F4?logo=googlechrome&logoColor=white)
![Edge](https://img.shields.io/badge/Edge-79%2B-0078D7?logo=microsoftedge&logoColor=white)
![Opera](https://img.shields.io/badge/Opera-43%2B-FF1B2D?logo=opera&logoColor=white)
![Brave](https://img.shields.io/badge/Brave-flag_required-FB542B?logo=brave&logoColor=white)
![Firefox](https://img.shields.io/badge/Firefox-not_supported-lightgrey?logo=firefox&logoColor=white)
![Safari](https://img.shields.io/badge/Safari-not_supported-lightgrey?logo=safari&logoColor=white)

---

A Progressive Web App (PWA) for controlling and tracking workouts on MS2H / FitShow FS-BT-D2 walking pads via Bluetooth Low Energy (BLE).

> [!IMPORTANT]
> Requires a browser with Web Bluetooth API support (Chrome, Edge, or Opera on desktop/Android). Not supported on Firefox or iOS.

---

## Table of Contents

- [Features](#features)
- [Setup](#setup)
- [Browser Compatibility](#browser-compatibility)
- [Compatible Devices](#compatible-devices)
- [BLE / FTMS Protocol](#ble--ftms-protocol)
- [Calculations](#calculations)
- [Tech Stack](#tech-stack)
- [File Structure](#file-structure)
- [Limitations](#limitations)

---

## Features

| Area | What it does |
| --- | --- |
| **Bluetooth Control** | Connect, start, pause, resume, stop, set speed, auto-reconnect |
| **Real-Time Metrics** | Speed, distance, calories, time, pace, steps, live speed chart |
| **Statistics Dashboard** | History across today / 7d / 30d / 3m / 6m / 12m / all-time |
| **Goals** | Daily, weekly, monthly targets with auto-scaling and progress bars |
| **Export & Backup** | CSV export, Google Sheets copy, webhook integration, snapshot recovery |
| **PWA / Offline** | Installable, offline-ready, Wake Lock, haptic feedback |

<details>
<summary>View full feature details</summary>

### Bluetooth Control
- Scan and connect to your walking pad (devices advertising as `FS-*`)
- Start, pause, resume, and stop workouts from the app
- Set target speed via on-screen controls
- Auto-reconnect on disconnection

### Real-Time Metrics
- Current and average speed (km/h)
- Distance (km), calories burned, elapsed time (HH:MM:SS)
- Current and average pace (min/km)
- Estimated steps (calculated from your height)
- Max speed, pause count
- Live speed chart (configurable 30s / 60s / 2m / 5m window)

### Statistics Dashboard
Historical stats aggregated across multiple periods: today, last 7 days, 30 days, 3 months, 6 months, 12 months, and all-time. Each period tracks distance, active time, calories, average speed, max speed, session count, and pauses — visualised with Chart.js trend graphs.

### Goals
- Set daily targets for distance, time, and sessions
- Weekly / monthly / multi-month / yearly goals for distance and time
- **Auto-calculate** mode scales period goals from your daily goal × active days
- Visual progress bars per period

### Data Export & Backup
- Export full history as CSV
- Copy formatted data for Google Sheets
- Webhook integration (Google Apps Script, Zapier, n8n)
- Snapshot export/import for backup and recovery

### PWA / Offline
- Installable to home screen or desktop
- Service Worker caches assets for offline use
- Wake Lock prevents screen sleep during workouts
- Haptic feedback on supported devices

</details>

---

## Setup

> [!TIP]
> Installing as a PWA (Add to Home Screen / Install App) gives the best experience — it opens full screen without browser chrome and behaves like a native app.

1. Open the app in Chrome, Edge, or Opera
2. Install it via the browser's **Add to Home Screen** / **Install App** prompt _(optional but recommended)_
3. Open **Settings** and enter your weight, height, and age
4. Optionally configure a webhook URL for external integrations
5. Click **Scan & Connect** and select your walking pad from the Bluetooth picker
6. Start walking — stats update in real time

---

## Browser Compatibility

Web Bluetooth is required. Supported browsers:

| Browser | Support | Notes |
| --- | --- | --- |
| Chrome 56+ | Native | Desktop & Android |
| Edge 79+ | Native | Desktop & Android |
| Opera 43+ | Native | Desktop & Android |
| Brave | Flag required | Enable via `brave://flags/#enable-web-bluetooth` |
| Firefox | Not supported | No implementation planned |
| Safari / iOS | Not supported | Web Bluetooth blocked on all iOS browsers |

> [!TIP]
> **Brave:** Web Bluetooth is blocked by default as a fingerprinting protection — nearby devices can be used to track users across sites. Enable it at `brave://flags/#enable-web-bluetooth`, set to **Enabled**, then relaunch. Other Chromium browsers can use the same flag at `chrome://flags/#enable-web-bluetooth`.

> [!CAUTION]
> **iOS users:** There is no workaround on iOS. Safari and all third-party iOS browsers are blocked from accessing Web Bluetooth at the OS level. A native app would be required for iPhone support.

---

## Compatible Devices

### Confirmed working
- **Black Lord MS2H** (FS-BT-D2)

### Will my device work?

Most budget walking pads are built on the **FitShow FS-BT-D2 OEM Bluetooth module** — the same board, rebranded across many manufacturers (Urevo, Rhythm Fun, and others sold white-label on Amazon). These all share the same `FS-` Bluetooth name prefix and identical FTMS packet layout.

| My device's Bluetooth name starts with `FS-` | Likely works out of the box |
| My device uses FTMS but has a different name | Works with a one-line code change |
| My device does not use FTMS | Requires significant rework |

> [!TIP]
> **Quick check:** Open your phone's Bluetooth settings, power on the walking pad, and see what name appears. If it starts with `FS-`, you're almost certainly good to go.

---

### Adapting for a different device

**Step 1 — Find your device's Bluetooth name**

| Method | How |
| --- | --- |
| Phone Bluetooth settings | Power on the pad, open Bluetooth settings, note the name as it appears |
| nRF Connect (Android/iOS) | Tap Scan — shows full name, signal strength, and advertised services |
| Windows | Settings → Bluetooth & devices → Add device — name appears during scan |
| Chrome/Edge | `chrome://bluetooth-internals` → device scanner tab |

**Step 2 — Update the name filter in `script.js` (line ~344)**

```js
filters: [{ namePrefix: "YOUR-DEVICE-PREFIX" }],
```

**Step 3 — Check the packet layout**

The parser expects a 19-byte FTMS treadmill data packet. Other FTMS devices may send a different packet length or field order depending on which flags they support. If your device connects but shows no data, `handleFTMSTreadmill()` will need to be updated to match your device's packet layout.

Use nRF Connect to inspect the raw packets (see below).

---

### Diagnosing with nRF Connect

nRF Connect (free — Nordic Semiconductor) lets you inspect raw BLE traffic directly from your phone.

**Check FTMS compatibility:**

1. Scan and tap **Connect** on your walking pad
2. In the **Services** tab, look for service UUID `0x1826` (FTMS)

> [!WARNING]
> If `0x1826` is not listed, your device does not use FTMS and would require significant reverse engineering to support.

**Capture treadmill data packets:**

3. Expand the FTMS service → find **Treadmill Data** (`0x2ACD`)
4. Tap the **Subscribe** button (down-arrow icon)
5. Start walking — raw hex packets will appear in real time, e.g. `8C 05 32 00 ...`
6. The first two bytes are the flags field (little-endian) — these define which fields are present and their order in the packet. Compare against `handleFTMSTreadmill()` in `script.js`

**Test control commands:**

7. Find **Control Point** (`0x2AD9`) → tap **Write**
8. Send `07` to start, `08 01` to stop — if your device responds with a success indication, all standard FTMS commands will work without changes

---

If you get it working on another brand, feel free to open an issue or PR to add it to the confirmed list.

---

## BLE / FTMS Protocol

> [!NOTE]
> FTMS (Fitness Machine Service) is an open Bluetooth SIG specification. All UUIDs and opcodes used here are part of the public standard — nothing proprietary.

| Characteristic | UUID     | Direction | Purpose                                |
| -------------- | -------- | --------- | -------------------------------------- |
| Treadmill Data | `0x2ACD` | Notify    | Speed, distance, calories, time        |
| Machine Status | `0x2ADA` | Notify    | Started / stopped / paused events      |
| Control Point  | `0x2AD9` | Write     | Send commands (start, stop, set speed) |

Speed commands are sent as `uint16` in units of 0.01 km/h.

---

## Calculations

> [!NOTE]
> Step count and power output are estimates based on your height and weight. They are not measured directly by the hardware.

| Metric        | Formula                                  |
| ------------- | ---------------------------------------- |
| Stride length | `0.415 × height_cm / 100` m              |
| Steps         | `(distance_km × 1000) / stride_length`   |
| Pace          | `60 / speed_kmh` min/km                  |
| Power (est.)  | `(1.5 × speed_kmh × weight_kg) / 3.6` W  |

---

## Tech Stack

| Concern   | Technology                         |
| --------- | ---------------------------------- |
| Language  | Vanilla JavaScript (no build step) |
| Styling   | Tailwind CSS (bundled runtime)     |
| Icons     | FontAwesome 7                      |
| Charts    | Chart.js 4                         |
| Bluetooth | Web Bluetooth API (FTMS profile)   |
| Storage   | `localStorage`                     |
| Offline   | Service Worker (cache-first, v9)   |

---

## File Structure

```
v3/
├── index.html      # UI, modals, and dashboard layout
├── script.js       # App logic, BLE handling, state management
├── sw.js           # Service Worker (offline caching)
├── manifest.json   # PWA metadata
├── icon.svg        # App icon
└── tailwind.js     # Tailwind CSS runtime (bundled)
```

---

## Limitations

> [!WARNING]
> **iOS / Safari not supported** — Web Bluetooth is not available on Safari or any browser on iOS. A native app would be required for iPhone support.

> [!WARNING]
> **Data stored locally** — All stats are in `localStorage`. Clearing browser data wipes your history. Use the CSV export to back up regularly.

> [!CAUTION]
> **Firefox not supported** — Firefox has no Web Bluetooth implementation and no plans to add one.

- **Hardware compatibility** — Only tested on MS2H FS-BT-D2 hardware. Other brands may require code changes — see [Compatible Devices](#compatible-devices).
- **Brave requires a flag** — Enable Web Bluetooth via `brave://flags/#enable-web-bluetooth`.
- **No cloud sync** — Stats don't sync across devices. Use the webhook integration for external logging.
