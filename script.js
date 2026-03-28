"use strict";

// --- BLE Constants (FTMS only) ---
const FTMS_SERVICE    = "00001826-0000-1000-8000-00805f9b34fb";
const FTMS_CONTROL    = "00002ad9-0000-1000-8000-00805f9b34fb";
const FTMS_TREADMILL  = "00002acd-0000-1000-8000-00805f9b34fb";
const FTMS_STATUS     = "00002ada-0000-1000-8000-00805f9b34fb";

// --- Wake Lock ---
let wakeLock = null;

async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => { wakeLock = null; });
    } catch (e) {
        console.warn("Wake lock failed:", e);
    }
}

function releaseWakeLock() {
    if (wakeLock) { wakeLock.release(); wakeLock = null; }
}

// --- Haptic ---
function haptic(pattern = 50) {
    if (navigator.vibrate) navigator.vibrate(pattern);
}

// --- BLE State ---
let device, server;
let ftmsService = null, cFTMSControl = null, cFTMSTreadmill = null, cFTMSStatus = null;
let isRunning = false;
let isPaused = false;
let lastSpeed = 1.0;
let isConnected = false;
let pendingResumeSpeed = 0; // set on resume; applied on first running notification

// --- Current Session Stats ---
let currentSpeed = 0;
let currentDistance = 0;
let currentCalories = 0;
let currentTimeSeconds = 0;

// --- Cumulative Stats ---
let cumDistance = 0;
let cumCalories = 0;
let cumTimeSeconds = 0;
let cumPower = 0;
let cumTotalPower = 0;
let cumSteps = 0;

// --- Speed Tracking ---
let maxSpeed = 0;
let speedSum = 0;
let speedSamples = 0;

// --- Pause Tracking ---
let pauseCount = 0;
let totalPauseTime = 0;
let pauseStartTimestamp = null;

// --- Previous session values for delta accumulation ---
let prevDistance = 0;
let prevCalories = 0;
let prevTimeSeconds = 0;

// --- User Profile ---
let userWeight = 80;
let userHeight = "5'8\"";
let userAge = 25;
let currentPower = 0;
let currentSteps = 0;

// --- Estimated Distance (speed-integration) ---
let estimatedDistanceKm = 0;
let cumEstimatedDistance = 0;
let lastDistanceUpdate = Date.now();

// --- Export ---
let webhookUrl = "";
let webhookSecret = "";

let cardCollapsed = {};
let cardHidden = {};

function applyCardCollapsed(id, collapsed) {
    const body = document.getElementById("body-" + id);
    const chevronBtn = document.getElementById("chevron-" + id);
    const titleEl = document.getElementById("title-" + id);
    if (!body) return;
    body.classList.toggle("hidden", collapsed);
    if (chevronBtn) chevronBtn.classList.toggle("hidden", collapsed);
    if (titleEl) {
        titleEl.classList.toggle("hidden", !collapsed);
        titleEl.classList.toggle("flex", collapsed);
    }
}

function toggleCardCollapse(id) {
    cardCollapsed[id] = !cardCollapsed[id];
    localStorage.setItem("wp_card_collapsed", JSON.stringify(cardCollapsed));
    applyCardCollapsed(id, cardCollapsed[id]);
}

function applyCardHidden(id, hidden) {
    const card = document.getElementById("card-" + id);
    if (!card) return;
    card.classList.toggle("hidden", hidden);
}

function loadCardState() {
    cardCollapsed = JSON.parse(localStorage.getItem("wp_card_collapsed") || "{}");
    cardHidden = JSON.parse(localStorage.getItem("wp_card_hidden") || "{}");
    ["session", "period1", "period2", "alltime", "livespeed", "trends", "history"].forEach(id => {
        applyCardCollapsed(id, cardCollapsed[id] || false);
        applyCardHidden(id, cardHidden[id] || false);
        const cb = document.getElementById("show-card-" + id);
        if (cb) cb.checked = !cardHidden[id];
    });
    document.querySelectorAll(".card-collapse-btn").forEach(btn => {
        btn.addEventListener("click", () => toggleCardCollapse(btn.dataset.card));
    });
    ["session", "period1", "period2", "alltime", "livespeed", "trends", "history"].forEach(id => {
        const cb = document.getElementById("show-card-" + id);
        if (!cb) return;
        cb.addEventListener("change", function () {
            cardHidden[id] = !this.checked;
            localStorage.setItem("wp_card_hidden", JSON.stringify(cardHidden));
            applyCardHidden(id, cardHidden[id]);
        });
    });
}

// --- Goals ---
let goalDistanceKm = 0;
let goalTimeSeconds = 0;
let goalWeekDistanceKm = 0;
let goalWeekTimeSeconds = 0;
let goalMonthDistanceKm = 0;
let goalMonthTimeSeconds = 0;
let goalYearDistanceKm = 0;
let goalYearTimeSeconds = 0;

// --- History save baseline (to avoid double-counting on multiple stops) ---
let lastHistoryDistance = 0;
let lastHistoryCalories = 0;
let lastHistorySpeedSum = 0;
let lastHistorySpeedSamples = 0;
let lastHistoryTimeSeconds = 0;
let lastHistoryPauseCount = 0;

// --- Chart Instances ---
const wpCharts = { distance: null, calories: null, speedHist: null, liveSpeed: null };

// --- Live Speed Chart Data ---
let liveChartMax = 60;
let liveChartYMax = 0;
let liveSpeedData = [];
let liveSpeedLabels = [];
let liveSecondCount = 0;

// ============================================================
// UI Helpers
// ============================================================

function setStatus(text, dotClass) {
    document.getElementById("status").textContent = text;
    const dot = document.getElementById("statusDot");
    if (dot) {
        dot.classList.remove("bg-red-500", "bg-green-500", "bg-yellow-400", "bg-orange-400");
        dot.classList.add(dotClass);
    }
}

// ============================================================
// FTMS Helpers
// ============================================================

function ftmsSpeedBytes(kmh) {
    const val = Math.round(kmh * 100); // 0.01 km/h units
    return [0x02, val & 0xFF, (val >> 8) & 0xFF]; // opcode 0x02 = Set Target Speed (FitShow FS-BT-D2)
}

async function ftmsCmd(bytes) {
    if (!cFTMSControl) { console.warn("FTMS not connected"); return; }
    try {
        await cFTMSControl.writeValue(new Uint8Array(bytes));
    } catch (e) {
        console.error("FTMS write failed", e);
    }
}

// ============================================================
// FTMS Notification Handlers
// ============================================================

// 0x2ACD Treadmill Data — primary data source
// Packet layout (flags 0x058C, 19 bytes):
//   [0-1]  Flags uint16 LE
//   [2-3]  Instantaneous Speed uint16 LE, units 0.01 km/h
//   [4-6]  Total Distance uint24 LE, units 1 m
//   [7-8]  Inclination sint16 LE, units 0.1%
//   [9-10] Ramp Angle sint16 LE, units 0.1 deg
//   [11-12] Total Energy uint16 LE, direct kcal
//   [13]   Energy Per Hour uint16 (0xFFFF = N/A) — split across [13-14]
//   [15]   Energy Per Minute uint8 (0xFF = N/A)
//   [16]   Heart Rate uint8
//   [17-18] Elapsed Time uint16 LE, seconds
function handleFTMSTreadmill(event) {
    const value = event.target.value;
    if (value.byteLength < 19) return;

    const speed    = value.getUint16(2, true) / 100;
    const distanceM = value.getUint8(4) | (value.getUint8(5) << 8) | (value.getUint8(6) << 16);
    const distance  = distanceM / 1000;
    const calories  = value.getUint16(11, true);
    const elapsed   = value.getUint16(17, true);

    // Only accumulate stats when belt is actually running at speed
    if (!isRunning || speed <= 0) return;

    // Apply pending resume speed on first notification after start/resume
    if (pendingResumeSpeed > 0) {
        const targetSpeed = pendingResumeSpeed;
        pendingResumeSpeed = 0;
        setTimeout(() => ftmsCmd(ftmsSpeedBytes(targetSpeed)), 2500);
    }

    currentSpeed = speed;
    if (currentSpeed > maxSpeed) maxSpeed = currentSpeed;
    speedSum += currentSpeed;
    speedSamples++;

    currentDistance    = distance;
    currentCalories    = calories;
    currentTimeSeconds = elapsed;

    cumDistance    += Math.max(0, currentDistance    - prevDistance);
    cumCalories    += Math.max(0, currentCalories    - prevCalories);
    cumTimeSeconds += Math.max(0, currentTimeSeconds - prevTimeSeconds);

    prevDistance    = currentDistance;
    prevCalories    = currentCalories;
    prevTimeSeconds = currentTimeSeconds;

    updateCurrentStats();
    updateCumulativeStats();
}

// 0x2ADA Fitness Machine Status — state machine
// Observed opcodes:
//   0x04        = Started / Resumed (fires twice per start)
//   0x02 0x01   = Stopped by User (fires ~11s after stop command, belt fully halted)
function handleFTMSStatus(event) {
    const value = event.target.value;
    if (value.byteLength < 1) return;

    const opcode = value.getUint8(0);

    if (opcode === 0x04) {
        // Belt started or resumed
        isRunning = true;
        isPaused  = false;
        setStatus("Running", "bg-green-500");
        requestWakeLock();
    } else if (opcode === 0x02 && value.byteLength >= 2 && value.getUint8(1) === 0x01) {
        // Belt fully stopped — pad resets its internal counters to 0 at this point
        isRunning = false;
        currentSpeed = 0;
        estimatedDistanceKm = 0;
        lastDistanceUpdate = Date.now();
        // Reset prev values so next session's first packet doesn't produce a negative delta
        prevDistance    = 0;
        prevCalories    = 0;
        prevTimeSeconds = 0;
        localStorage.setItem("wp_isPaused", isPaused ? "1" : "0");
        localStorage.setItem("wp_pauseStartTimestamp", "");
        if (isPaused) {
            setStatus("Paused", "bg-yellow-400");
        } else {
            isPaused = false;
            setStatus("Stopped", "bg-orange-400");
            releaseWakeLock();
        }
        updateCurrentStats();
    }
}

// 0x2AD9 Control Point indications — log responses
function handleFTMSIndication(event) {
    const value = event.target.value;
    const bytes = [];
    for (let i = 0; i < value.byteLength; i++) bytes.push(value.getUint8(i));
    const hex = bytes.map(b => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
    if (bytes[0] === 0x80) {
        const results = { 0x01: "Success", 0x02: "Op Code Not Supported", 0x03: "Invalid Parameter",
                          0x04: "Operation Failed", 0x05: "Control Not Permitted" };
        const ops = { 0x01: "Request Control", 0x02: "Set Speed",
                      0x07: "Start/Resume", 0x08: "Stop/Pause" };
        const op  = ops[bytes[1]]    || "0x" + bytes[1].toString(16);
        const res = results[bytes[2]] || "0x" + bytes[2].toString(16);
        console.log("[FTMS indication]", hex, "→", op + ":", res);
    } else {
        console.log("[FTMS indication]", hex);
    }
}

// ============================================================
// BLE Init / Disconnect
// ============================================================

async function initBLE() {
    try {
        setStatus("Connecting…", "bg-yellow-400");

        if (!device) {
            if (navigator.bluetooth.getDevices) {
                const permitted = await navigator.bluetooth.getDevices();
                device = permitted.find(d => d.name && d.name.startsWith("FS-"));
            }
            if (!device) {
                device = await navigator.bluetooth.requestDevice({
                    filters: [{ namePrefix: "FS-" }],
                    optionalServices: [FTMS_SERVICE],
                });
            }
            device.addEventListener("gattserverdisconnected", onDisconnected);
        }

        server = await device.gatt.connect();

        if (!ftmsService)    ftmsService    = await server.getPrimaryService(FTMS_SERVICE);
        if (!cFTMSControl)   cFTMSControl   = await ftmsService.getCharacteristic(FTMS_CONTROL);
        if (!cFTMSTreadmill) cFTMSTreadmill = await ftmsService.getCharacteristic(FTMS_TREADMILL);
        if (!cFTMSStatus)    cFTMSStatus    = await ftmsService.getCharacteristic(FTMS_STATUS);

        await cFTMSControl.startNotifications();
        cFTMSControl.removeEventListener("characteristicvaluechanged", handleFTMSIndication);
        cFTMSControl.addEventListener("characteristicvaluechanged", handleFTMSIndication);

        await cFTMSTreadmill.startNotifications();
        cFTMSTreadmill.removeEventListener("characteristicvaluechanged", handleFTMSTreadmill);
        cFTMSTreadmill.addEventListener("characteristicvaluechanged", handleFTMSTreadmill);

        await cFTMSStatus.startNotifications();
        cFTMSStatus.removeEventListener("characteristicvaluechanged", handleFTMSStatus);
        cFTMSStatus.addEventListener("characteristicvaluechanged", handleFTMSStatus);

        isConnected = true;
        setStatus("Connected", "bg-green-500");

        // Request FTMS control after a short delay to let the pad settle
        setTimeout(() => ftmsCmd([0x01]), 600);

    } catch (e) {
        if (e.name === "NotFoundError") {
            setStatus("Disconnected", "bg-red-500");
        } else {
            console.error("BLE init failed", e);
            setStatus("Connection failed", "bg-red-500");
        }
    }
}

function onDisconnected() {
    isConnected    = false;
    ftmsService    = null;
    cFTMSControl   = null;
    cFTMSTreadmill = null;
    cFTMSStatus    = null;
    releaseWakeLock();
    setStatus("Reconnecting…", "bg-yellow-400");
    setTimeout(() => { if (!isConnected && device) initBLE(); }, 2000);
}

// ============================================================
// Calculations
// ============================================================

function estimatePower(speed, weight) {
    return Math.round((1.5 * speed * weight) / 3.6);
}

function getStrideLength(heightFtIn) {
    const match = heightFtIn.match(/^([0-9]+)'([0-9]+)"?/);
    if (!match) return 0.762;
    const feet = parseInt(match[1], 10);
    const inches = parseInt(match[2], 10);
    const heightCm = feet * 30.48 + inches * 2.54;
    return (0.415 * heightCm) / 100;
}

function estimateSteps(distanceKm, heightFtIn) {
    const stride = getStrideLength(heightFtIn);
    if (stride <= 0) return 0;
    return Math.round((distanceKm * 1000) / stride);
}

function formatSeconds(sec) {
    sec = Math.round(sec);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m.toString().padStart(2, "0") + ":" + s.toString().padStart(2, "0");
}

// ============================================================
// Stats Display
// ============================================================

function updateCurrentStats() {
    document.getElementById("currentSpeed").textContent = currentSpeed.toFixed(1);
    document.getElementById("currentDistance").textContent = currentDistance.toFixed(2);
    currentPower = estimatePower(currentSpeed, userWeight);
    currentSteps = estimateSteps(estimatedDistanceKm, userHeight);
    document.getElementById("currentCalories").textContent = Math.round(currentCalories);
    document.getElementById("currentTime").textContent = new Date(currentTimeSeconds * 1000).toISOString().slice(11, 19);
    document.getElementById("currentMaxSpeed").textContent = maxSpeed.toFixed(1);
    document.getElementById("currentAvgSpeed").textContent = speedSamples > 0 ? (speedSum / speedSamples).toFixed(2) : "0.00";
    document.getElementById("currentPower").textContent = currentPower;
    document.getElementById("currentSteps").textContent = currentSteps;
    const pace = currentSpeed > 0 ? (60 / currentSpeed) : 0;
    const paceStr = pace > 0 ? `${Math.floor(pace)}:${String(Math.round((pace % 1) * 60)).padStart(2, "0")}` : "—";
    document.getElementById("currentPace").textContent = paceStr;
    const mobileSpeedEl = document.getElementById("mobileCurrentSpeed");
    if (mobileSpeedEl) mobileSpeedEl.textContent = currentSpeed.toFixed(1);
}

function updateCumulativeStats() {
    document.getElementById("cumDistance").textContent = cumDistance.toFixed(2);
    cumPower  = estimatePower(currentSpeed, userWeight);
    cumSteps  = estimateSteps(cumEstimatedDistance, userHeight);
    document.getElementById("cumCalories").textContent = Math.round(cumCalories);
    document.getElementById("cumTime").textContent = new Date(cumTimeSeconds * 1000).toISOString().slice(11, 19);
    document.getElementById("cumMaxSpeed").textContent = maxSpeed.toFixed(1);
    document.getElementById("cumAvgSpeed").textContent = speedSamples > 0 ? (speedSum / speedSamples).toFixed(2) : "0.00";
    document.getElementById("cumPauseCount").textContent = pauseCount;
    document.getElementById("cumTotalPauseTime").textContent = formatSeconds(totalPauseTime);
    document.getElementById("cumAvgPauseTime").textContent = pauseCount > 0 ? formatSeconds(totalPauseTime / pauseCount) : "00:00";
    document.getElementById("cumPower").textContent = cumPower;
    document.getElementById("cumTotalPower").textContent = cumTotalPower;
    document.getElementById("cumSteps").textContent = cumSteps;
    document.getElementById("cumEstimatedDistance").textContent = cumEstimatedDistance.toFixed(2);
    autoSaveCumulativeStats();
    updateGoalProgress();
    updateTodayTotals();
    updatePeriodStats();
    updateAllTimeExtras();
}

// ============================================================
// Persistence
// ============================================================

function autoSaveCumulativeStats() {
    localStorage.setItem("wp_cumDistance", cumDistance);
    localStorage.setItem("wp_cumCalories", cumCalories);
    localStorage.setItem("wp_cumTimeSeconds", cumTimeSeconds);
    localStorage.setItem("wp_cumPauseCount", pauseCount);
    localStorage.setItem("wp_cumTotalPauseTime", totalPauseTime);
    localStorage.setItem("wp_isPaused", isPaused ? "1" : "0");
    localStorage.setItem("wp_pauseStartTimestamp", pauseStartTimestamp || "");
    localStorage.setItem("wp_lastHistoryDistance", lastHistoryDistance);
    localStorage.setItem("wp_lastHistoryCalories", lastHistoryCalories);
    localStorage.setItem("wp_lastHistorySpeedSum", lastHistorySpeedSum);
    localStorage.setItem("wp_lastHistorySpeedSamples", lastHistorySpeedSamples);
    localStorage.setItem("wp_lastHistoryTimeSeconds", lastHistoryTimeSeconds);
    localStorage.setItem("wp_lastHistoryPauseCount", lastHistoryPauseCount);
}

function saveSessionBackup() {
    const backup = {
        cumDistance, cumCalories, cumTimeSeconds,
        pauseCount, totalPauseTime, cumTotalPower,
        maxSpeed, speedSum, speedSamples, cumEstimatedDistance,
        savedAt: new Date().toLocaleString(),
    };
    localStorage.setItem("wp_session_backup", JSON.stringify(backup));
    updateRecoverBtn();
}

function syncRecoveryRow() {
    const row = document.getElementById("recoveryBtnRow");
    const anyVisible =
        !document.getElementById("recoverExportBtn").classList.contains("hidden") ||
        !document.getElementById("recoverSessionBtn").classList.contains("hidden");
    if (anyVisible) {
        row.classList.remove("hidden");
        row.classList.add("flex");
    } else {
        row.classList.add("hidden");
        row.classList.remove("flex");
    }
}

function updateRecoverBtn() {
    const backup = JSON.parse(localStorage.getItem("wp_session_backup") || "null");
    const btn = document.getElementById("recoverSessionBtn");
    const today = new Date().toLocaleDateString();
    const isToday = backup && backup.savedAt && backup.savedAt.startsWith(today);
    if (backup && backup.cumDistance > 0 && isToday) {
        btn.title = `Recover session from ${backup.savedAt} (${backup.cumDistance.toFixed(2)} km)`;
        btn.classList.remove("hidden");
        btn.classList.add("flex");
    } else {
        btn.classList.add("hidden");
        btn.classList.remove("flex");
    }
    syncRecoveryRow();
}

function mergeFromSnapshot(snapshot) {
    cumDistance          += snapshot.cumDistance;
    cumCalories          += snapshot.cumCalories;
    cumTimeSeconds       += snapshot.cumTimeSeconds;
    pauseCount           += snapshot.pauseCount;
    totalPauseTime       += snapshot.totalPauseTime;
    cumTotalPower        += snapshot.cumTotalPower;
    cumEstimatedDistance += snapshot.cumEstimatedDistance;
    if (snapshot.maxSpeed > maxSpeed) maxSpeed = snapshot.maxSpeed;
    speedSum     += snapshot.speedSum;
    speedSamples += snapshot.speedSamples;
    autoSaveCumulativeStats();
    updateCumulativeStats();
}

function recoverFromSnapshot(snapshot) {
    cumDistance          = snapshot.cumDistance;
    cumCalories          = snapshot.cumCalories;
    cumTimeSeconds       = snapshot.cumTimeSeconds;
    pauseCount           = snapshot.pauseCount;
    totalPauseTime       = snapshot.totalPauseTime;
    cumTotalPower        = snapshot.cumTotalPower;
    cumEstimatedDistance = snapshot.cumEstimatedDistance;
    maxSpeed             = snapshot.maxSpeed;
    speedSum             = snapshot.speedSum;
    speedSamples         = snapshot.speedSamples;
    autoSaveCumulativeStats();
    updateCumulativeStats();
}

function recoverSession() {
    const backup = JSON.parse(localStorage.getItem("wp_session_backup") || "null");
    if (!backup) return;
    mergeFromSnapshot(backup);
    localStorage.removeItem("wp_session_backup");
    updateRecoverBtn();
}

function loadCumulativeStats() {
    cumDistance    = parseFloat(localStorage.getItem("wp_cumDistance"))    || 0;
    cumCalories    = parseFloat(localStorage.getItem("wp_cumCalories"))    || 0;
    cumTimeSeconds = parseInt(localStorage.getItem("wp_cumTimeSeconds"))   || 0;
    pauseCount     = parseInt(localStorage.getItem("wp_cumPauseCount"))    || 0;
    totalPauseTime = parseFloat(localStorage.getItem("wp_cumTotalPauseTime")) || 0;
    isPaused = localStorage.getItem("wp_isPaused") === "1";
    const savedTimestamp = localStorage.getItem("wp_pauseStartTimestamp");
    pauseStartTimestamp = savedTimestamp ? parseInt(savedTimestamp) : null;
    if (isPaused && pauseStartTimestamp) {
        totalPauseTime += (Date.now() - pauseStartTimestamp) / 1000;
        pauseStartTimestamp = Date.now();
    }
    lastHistoryDistance     = parseFloat(localStorage.getItem("wp_lastHistoryDistance"))     || 0;
    lastHistoryCalories     = parseFloat(localStorage.getItem("wp_lastHistoryCalories"))     || 0;
    lastHistorySpeedSum     = parseFloat(localStorage.getItem("wp_lastHistorySpeedSum"))     || 0;
    lastHistorySpeedSamples = parseInt(localStorage.getItem("wp_lastHistorySpeedSamples"))   || 0;
    lastHistoryTimeSeconds  = parseInt(localStorage.getItem("wp_lastHistoryTimeSeconds"))    || 0;
    lastHistoryPauseCount   = parseInt(localStorage.getItem("wp_lastHistoryPauseCount"))     || 0;
}

function loadDefaults() {
    const w = localStorage.getItem("wp_weight");
    const h = localStorage.getItem("wp_height");
    const a = localStorage.getItem("wp_age");
    if (!w || !h || !a) {
        showOnboardingModal();
        return;
    }
    userWeight = parseFloat(w);
    userHeight = h;
    userAge    = parseInt(a);
    document.getElementById("weightInput").value = userWeight;
    document.getElementById("heightInput").value = userHeight;
    document.getElementById("ageInput").value    = userAge;
    webhookUrl = localStorage.getItem("wp_webhook_url") || "";
    webhookSecret = localStorage.getItem("wp_webhook_secret") || "";
    document.getElementById("webhookUrlInput").value = webhookUrl;
    document.getElementById("webhookSecretInput").value = webhookSecret;
}

function saveDefaults() {
    userWeight = parseFloat(document.getElementById("weightInput").value) || userWeight;
    userHeight = document.getElementById("heightInput").value            || userHeight;
    userAge    = parseInt(document.getElementById("ageInput").value)     || userAge;
    localStorage.setItem("wp_weight", userWeight);
    localStorage.setItem("wp_height", userHeight);
    localStorage.setItem("wp_age",    userAge);
    webhookUrl = document.getElementById("webhookUrlInput").value.trim();
    webhookSecret = document.getElementById("webhookSecretInput").value.trim();
    localStorage.setItem("wp_webhook_url", webhookUrl);
    localStorage.setItem("wp_webhook_secret", webhookSecret);
}

// ============================================================
// Export
// ============================================================

function saveExportSnapshot() {
    const snapshot = {
        cumDistance, cumCalories, cumTimeSeconds,
        pauseCount, totalPauseTime, cumTotalPower,
        maxSpeed, speedSum, speedSamples, cumEstimatedDistance,
        savedAt: new Date().toLocaleString(),
    };
    localStorage.setItem("wp_export_snapshot", JSON.stringify(snapshot));
    updateExportRecoverBtn();
}

function updateExportRecoverBtn() {
    const snapshot = JSON.parse(localStorage.getItem("wp_export_snapshot") || "null");
    const btn = document.getElementById("recoverExportBtn");
    if (snapshot && snapshot.cumDistance > 0) {
        btn.title = `Restore to last export: ${snapshot.savedAt} (${snapshot.cumDistance.toFixed(2)} km)`;
        btn.classList.remove("hidden");
        btn.classList.add("flex");
    } else {
        btn.classList.add("hidden");
        btn.classList.remove("flex");
    }
    syncRecoveryRow();
}

function recoverFromExport() {
    const snapshot = JSON.parse(localStorage.getItem("wp_export_snapshot") || "null");
    if (!snapshot) return;
    recoverFromSnapshot(snapshot);
}

function triggerDownload(blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "walking_pad_stats.csv";
    a.click();
}

async function exportStats() {
    saveSessionToHistory();
    saveExportSnapshot();
    const avgSpeed = speedSamples > 0 ? (speedSum / speedSamples).toFixed(2) : "0.00";
    const avgPause = pauseCount > 0 ? (totalPauseTime / pauseCount).toFixed(0) : "0";
    const rows = [
        ["Type", "Speed", "Max Speed", "Avg Speed", "Distance", "Calories", "Time", "Pauses", "Total Pause Time (s)", "Avg Pause Time (s)"],
        ["Current",    currentSpeed, maxSpeed, avgSpeed, currentDistance, Math.round(currentCalories), new Date(currentTimeSeconds * 1000).toISOString().slice(11, 19), pauseCount, totalPauseTime.toFixed(0), avgPause],
        ["Cumulative", currentSpeed, maxSpeed, avgSpeed, cumDistance,     Math.round(cumCalories),     new Date(cumTimeSeconds * 1000).toISOString().slice(11, 19),     pauseCount, totalPauseTime.toFixed(0), avgPause],
    ];
    const csv  = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const file = new File([blob], "walking_pad_stats.csv", { type: "text/csv" });
    if (!webhookUrl) {
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ title: "Walking Pad Stats", files: [file] });
            } catch (e) {
                if (e.name !== "AbortError") triggerDownload(blob);
            }
        } else {
            triggerDownload(blob);
        }
    }
    autoSaveCumulativeStats();
    if (webhookUrl) {
        const payload = {
            secret: webhookSecret,
            exportedAt: new Date().toISOString(),
            session: {
                distance: currentDistance,
                calories: Math.round(currentCalories),
                timeSeconds: currentTimeSeconds,
                maxSpeed,
                avgSpeed: speedSamples > 0 ? speedSum / speedSamples : 0,
                pace: (speedSamples > 0 && (speedSum / speedSamples) > 0) ? 60 / (speedSum / speedSamples) : 0,
                steps: currentSteps,
                pauseCount,
            },
            cumulative: {
                distance: cumDistance,
                calories: Math.round(cumCalories),
                timeSeconds: cumTimeSeconds,
                maxSpeed,
                avgSpeed: speedSamples > 0 ? speedSum / speedSamples : 0,
                pace: (speedSamples > 0 && (speedSum / speedSamples) > 0) ? 60 / (speedSum / speedSamples) : 0,
                steps: cumSteps,
                pauseCount,
                pauseTimeSeconds: totalPauseTime,
            },
            history: JSON.parse(localStorage.getItem("wp_history") || "{}"),
        };
        fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify(payload),
        }).catch(e => console.warn("Webhook failed:", e));
    }
    renderCharts();
    renderSessionHistory();
    updateRecoverBtn();
}

async function copyForSheets() {
    const history = JSON.parse(localStorage.getItem("wp_history") || "{}");
    const dates = Object.keys(history).sort();
    const header = [
        "Date", "Week", "Month", "Year", "Session End",
        "Distance (km)", "Calories (kcal)", "Duration (min)",
        "Avg Speed (km/h)", "Max Speed (km/h)", "Pace (min/km)",
        "Steps", "Pauses"
    ];
    const rows = dates.map(date => {
        const d = history[date];
        const dt = new Date(date);
        const week = Math.ceil((((dt - new Date(dt.getFullYear(), 0, 1)) / 86400000) + 1) / 7);
        const month = dt.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        const year = dt.getFullYear();
        const sessionEnd = d.lastUpdated ? new Date(d.lastUpdated).toLocaleString() : "—";
        const avg = d.speedSamples > 0 ? d.speedSum / d.speedSamples : 0;
        const pace = avg > 0 ? parseFloat((60 / avg).toFixed(2)) : 0;
        const durationMin = parseFloat(((d.timeSeconds || 0) / 60).toFixed(1));
        return [
            date, week, month, year, sessionEnd,
            parseFloat(d.distance.toFixed(2)),
            Math.round(d.calories),
            durationMin,
            parseFloat(avg.toFixed(2)),
            parseFloat((d.maxSpeed || 0).toFixed(1)),
            pace,
            0,
            d.pauses || 0,
        ];
    });
    const tsv = [header, ...rows].map(r => r.join("\t")).join("\n");
    try {
        await navigator.clipboard.writeText(tsv);
        const btn = document.getElementById("copyForSheetsBtn");
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i><span class="hidden sm:inline"> Copied!</span>';
        setTimeout(() => { btn.innerHTML = orig; }, 2000);
    } catch (e) {
        console.warn("Clipboard write failed:", e);
    }
}

// ============================================================
// Session History
// ============================================================

function saveSessionToHistory() {
    const deltaDistance     = cumDistance    - lastHistoryDistance;
    const deltaCalories     = cumCalories    - lastHistoryCalories;
    const deltaSpeedSum     = speedSum       - lastHistorySpeedSum;
    const deltaSpeedSamples = speedSamples   - lastHistorySpeedSamples;
    const deltaTimeSeconds  = cumTimeSeconds - lastHistoryTimeSeconds;
    const deltaPauses       = Math.max(0, pauseCount - lastHistoryPauseCount);
    if (deltaDistance <= 0 && deltaSpeedSamples <= 0) return;
    const today = new Date().toISOString().slice(0, 10);
    let history = JSON.parse(localStorage.getItem("wp_history") || "{}");
    if (!history[today]) {
        history[today] = { distance: 0, calories: 0, speedSum: 0, speedSamples: 0, timeSeconds: 0, sessions: 0, pauses: 0, maxSpeed: 0 };
    }
    history[today].distance     += deltaDistance;
    history[today].calories     += deltaCalories;
    history[today].speedSum     += deltaSpeedSum;
    history[today].speedSamples += deltaSpeedSamples;
    history[today].timeSeconds   = (history[today].timeSeconds || 0) + Math.max(0, deltaTimeSeconds);
    history[today].sessions      = (history[today].sessions || 0) + 1;
    history[today].pauses        = (history[today].pauses   || 0) + deltaPauses;
    history[today].maxSpeed      = Math.max(history[today].maxSpeed || 0, maxSpeed);
    history[today].lastUpdated   = new Date().toISOString();
    localStorage.setItem("wp_history", JSON.stringify(history));
    lastHistoryDistance     = cumDistance;
    lastHistoryCalories     = cumCalories;
    lastHistorySpeedSum     = speedSum;
    lastHistorySpeedSamples = speedSamples;
    lastHistoryTimeSeconds  = cumTimeSeconds;
    lastHistoryPauseCount   = pauseCount;
}

function getChartData() {
    let history  = JSON.parse(localStorage.getItem("wp_history") || "{}");
    let dates    = Object.keys(history).sort();
    let distanceData = [], caloriesData = [], speedData = [];
    dates.forEach(date => {
        distanceData.push(parseFloat(history[date].distance.toFixed(2)));
        caloriesData.push(parseFloat(history[date].calories.toFixed(1)));
        const avgSpeed = history[date].speedSamples > 0 ? history[date].speedSum / history[date].speedSamples : 0;
        speedData.push(parseFloat(avgSpeed.toFixed(2)));
    });
    return { dates, distanceData, caloriesData, speedData };
}

function renderCharts() {
    const { dates, distanceData, caloriesData, speedData } = getChartData();
    const isDark     = document.documentElement.classList.contains("dark");
    const tickColor  = isDark ? "#e5e7eb" : "#374151";
    const gridColor  = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
    const chartOpts  = (label, color) => ({
        type: "line",
        data: {
            labels: dates,
            datasets: [{
                label,
                data: dates.length === 0 ? [] : (label.includes("Distance") ? distanceData : label.includes("Calor") ? caloriesData : speedData),
                borderColor: color,
                backgroundColor: color.replace(")", ",0.2)").replace("rgb", "rgba"),
                fill: true,
                tension: 0.3,
                pointRadius: 3,
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { labels: { color: tickColor } } },
            scales: {
                x: { ticks: { color: tickColor }, grid: { color: gridColor } },
                y: { ticks: { color: tickColor }, grid: { color: gridColor } }
            }
        }
    });

    if (wpCharts.distance) wpCharts.distance.destroy();
    if (wpCharts.calories) wpCharts.calories.destroy();
    if (wpCharts.speedHist) wpCharts.speedHist.destroy();

    wpCharts.distance = new Chart(document.getElementById("distanceChart").getContext("2d"), chartOpts("Distance (km)", "#0ea5e9"));
    const calOpts = chartOpts("Calories (kcal)", "#f59e42");
    calOpts.data.datasets[0].data = caloriesData;
    wpCharts.calories = new Chart(document.getElementById("caloriesChart").getContext("2d"), calOpts);
    const spdOpts = chartOpts("Avg Speed (km/h)", "#38bdf8");
    spdOpts.data.datasets[0].data = speedData;
    wpCharts.speedHist = new Chart(document.getElementById("speedChart").getContext("2d"), spdOpts);
}

function renderSessionHistory() {
    let history = JSON.parse(localStorage.getItem("wp_history") || "{}");
    let dates   = Object.keys(history).sort().reverse();
    const tbody = document.getElementById("historyTableBody");
    if (dates.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="py-4 text-center text-gray-400">No history yet</td></tr>';
        return;
    }
    tbody.innerHTML = dates.map(date => {
        const d        = history[date];
        const avgSpeed = d.speedSamples > 0 ? (d.speedSum / d.speedSamples).toFixed(2) : "0.00";
        const maxSpd   = (d.maxSpeed || 0).toFixed(1);
        const timeStr  = d.timeSeconds > 0
            ? new Date(d.timeSeconds * 1000).toISOString().slice(11, 19)
            : "—";
        const sessions = d.sessions || 0;
        const pauses   = d.pauses   || 0;
        return `<tr class="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800">
            <td class="py-2 text-gray-600 dark:text-gray-300">${date}</td>
            <td class="py-2 font-semibold text-sporty">${d.distance.toFixed(2)}</td>
            <td class="py-2 font-semibold text-accent">${Math.round(d.calories)}</td>
            <td class="py-2 font-semibold text-yellow-400">${timeStr}</td>
            <td class="py-2 font-semibold text-blue-400">${avgSpeed}</td>
            <td class="py-2 font-semibold text-green-400 hidden md:table-cell">${maxSpd}</td>
            <td class="py-2 font-semibold text-green-400 hidden md:table-cell">${sessions}</td>
            <td class="py-2 font-semibold text-purple-400 hidden md:table-cell">${pauses}</td>
        </tr>`;
    }).join("");
}

// ============================================================
// Live Speed Chart
// ============================================================

function initLiveSpeedChart() {
    const isDark    = document.documentElement.classList.contains("dark");
    const tickColor = isDark ? "#e5e7eb" : "#374151";
    const gridColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
    wpCharts.liveSpeed = new Chart(document.getElementById("liveSpeedChart").getContext("2d"), {
        type: "line",
        data: {
            labels: liveSpeedLabels,
            datasets: [{
                label: "Speed (km/h)",
                data: liveSpeedData,
                borderColor: "#0ea5e9",
                backgroundColor: "rgba(14,165,233,0.15)",
                fill: true,
                tension: 0.3,
                pointRadius: 2,
            }]
        },
        options: {
            animation: false,
            responsive: true,
            plugins: { legend: { labels: { color: tickColor } } },
            scales: {
                x: { ticks: { color: tickColor, maxTicksLimit: 10 }, grid: { color: gridColor } },
                y: { min: 0, ...(liveChartYMax > 0 ? { max: liveChartYMax } : {}), ticks: { color: tickColor }, grid: { color: gridColor } }
            }
        }
    });
}

function updateLiveSpeedChart() {
    liveSecondCount++;
    liveSpeedData.push(currentSpeed);
    liveSpeedLabels.push(liveSecondCount + "s");
    if (liveSpeedData.length > liveChartMax) {
        liveSpeedData.shift();
        liveSpeedLabels.shift();
    }
    if (wpCharts.liveSpeed) {
        wpCharts.liveSpeed.data.labels = [...liveSpeedLabels];
        wpCharts.liveSpeed.data.datasets[0].data = [...liveSpeedData];
        wpCharts.liveSpeed.update("none");
    }
}

// ============================================================
// Goals
// ============================================================

function loadGoals() {
    goalDistanceKm      = parseFloat(localStorage.getItem("wp_goal_distance"))            || 0;
    goalTimeSeconds     = parseInt(localStorage.getItem("wp_goal_time_seconds"))           || 0;
    goalWeekDistanceKm  = parseFloat(localStorage.getItem("wp_goal_week_distance"))        || 0;
    goalWeekTimeSeconds = parseInt(localStorage.getItem("wp_goal_week_time_seconds"))      || 0;
    goalMonthDistanceKm = parseFloat(localStorage.getItem("wp_goal_month_distance"))       || 0;
    goalMonthTimeSeconds = parseInt(localStorage.getItem("wp_goal_month_time_seconds"))    || 0;
    goalYearDistanceKm  = parseFloat(localStorage.getItem("wp_goal_year_distance"))        || 0;
    goalYearTimeSeconds = parseInt(localStorage.getItem("wp_goal_year_time_seconds"))      || 0;
    // Populate sliders and displays
    const distSlider = document.getElementById("goalDistanceSlider");
    distSlider.value = goalDistanceKm;
    document.getElementById("goalDistanceDisplay").textContent = goalDistanceKm > 0 ? goalDistanceKm.toFixed(1) : "—";

    const timeSlider = document.getElementById("goalTimeSlider");
    const timeMins = Math.round(goalTimeSeconds / 60);
    timeSlider.value = timeMins;
    document.getElementById("goalTimeDisplay").textContent = goalTimeSeconds > 0 ? timeMins + ":00" : "—";

    const weekDistSlider = document.getElementById("goalWeekDistanceSlider");
    weekDistSlider.value = goalWeekDistanceKm;
    document.getElementById("goalWeekDistanceDisplay").textContent = goalWeekDistanceKm > 0 ? goalWeekDistanceKm.toFixed(1) : "—";

    const weekTimeSlider = document.getElementById("goalWeekTimeSlider");
    const weekTimeMins = Math.round(goalWeekTimeSeconds / 60);
    weekTimeSlider.value = weekTimeMins;
    document.getElementById("goalWeekTimeDisplay").textContent = goalWeekTimeSeconds > 0 ? formatHHMM(goalWeekTimeSeconds) : "—";

    const monthDistSlider = document.getElementById("goalMonthDistanceSlider");
    monthDistSlider.value = goalMonthDistanceKm;
    document.getElementById("goalMonthDistanceDisplay").textContent = goalMonthDistanceKm > 0 ? goalMonthDistanceKm.toFixed(1) : "—";

    const monthTimeSlider = document.getElementById("goalMonthTimeSlider");
    const monthTimeMins = Math.round(goalMonthTimeSeconds / 60);
    monthTimeSlider.value = monthTimeMins;
    document.getElementById("goalMonthTimeDisplay").textContent = goalMonthTimeSeconds > 0 ? formatHHMM(goalMonthTimeSeconds) : "—";

    const yearDistSlider = document.getElementById("goalYearDistanceSlider");
    yearDistSlider.value = goalYearDistanceKm;
    document.getElementById("goalYearDistanceDisplay").textContent = goalYearDistanceKm > 0 ? goalYearDistanceKm.toFixed(0) : "—";

    const yearTimeSlider = document.getElementById("goalYearTimeSlider");
    const yearTimeMins = Math.round(goalYearTimeSeconds / 60);
    yearTimeSlider.value = yearTimeMins;
    document.getElementById("goalYearTimeDisplay").textContent = goalYearTimeSeconds > 0 ? formatHHMM(goalYearTimeSeconds) : "—";
}

function updateGoalProgress() {
    const today = getPeriodStats(1);
    if (goalDistanceKm > 0) {
        const pct = Math.min(100, (today.dist / goalDistanceKm) * 100);
        document.getElementById("goalDistanceBar").style.width = pct + "%";
        document.getElementById("goalDistanceProgress").textContent = today.dist.toFixed(2);
        document.getElementById("goalDistanceTarget").textContent = goalDistanceKm.toFixed(1);
    }
    if (goalTimeSeconds > 0) {
        const pct = Math.min(100, (today.time / goalTimeSeconds) * 100);
        document.getElementById("goalTimeBar").style.width = pct + "%";
        document.getElementById("goalTimeProgress").textContent = new Date(today.time * 1000).toISOString().slice(11, 19);
        document.getElementById("goalTimeTarget").textContent = formatSeconds(goalTimeSeconds);
    }
    const week = getPeriodStats(7);
    if (goalWeekDistanceKm > 0) {
        const pct = Math.min(100, (week.dist / goalWeekDistanceKm) * 100);
        document.getElementById("weekGoalBar").style.width = pct + "%";
        document.getElementById("weekGoalProgress").textContent = week.dist.toFixed(2);
        document.getElementById("weekGoalTarget").textContent = goalWeekDistanceKm.toFixed(1);
    }
    if (goalWeekTimeSeconds > 0) {
        const pct = Math.min(100, (week.time / goalWeekTimeSeconds) * 100);
        document.getElementById("weekTimeGoalBar").style.width = pct + "%";
        document.getElementById("weekTimeGoalProgress").textContent = new Date(week.time * 1000).toISOString().slice(11, 19);
        document.getElementById("weekTimeGoalTarget").textContent = formatHHMM(goalWeekTimeSeconds);
    }
    const month = getPeriodStats(30);
    if (goalMonthDistanceKm > 0) {
        const pct = Math.min(100, (month.dist / goalMonthDistanceKm) * 100);
        document.getElementById("monthGoalBar").style.width = pct + "%";
        document.getElementById("monthGoalProgress").textContent = month.dist.toFixed(2);
        document.getElementById("monthGoalTarget").textContent = goalMonthDistanceKm.toFixed(1);
    }
    if (goalMonthTimeSeconds > 0) {
        const pct = Math.min(100, (month.time / goalMonthTimeSeconds) * 100);
        document.getElementById("monthTimeGoalBar").style.width = pct + "%";
        document.getElementById("monthTimeGoalProgress").textContent = new Date(month.time * 1000).toISOString().slice(11, 19);
        document.getElementById("monthTimeGoalTarget").textContent = formatHHMM(goalMonthTimeSeconds);
    }
    const year = getPeriodStats(365);
    if (goalYearDistanceKm > 0) {
        const pct = Math.min(100, (year.dist / goalYearDistanceKm) * 100);
        document.getElementById("yearGoalBar").style.width = pct + "%";
        document.getElementById("yearGoalProgress").textContent = year.dist.toFixed(2);
        document.getElementById("yearGoalTarget").textContent = goalYearDistanceKm.toFixed(0);
    }
    if (goalYearTimeSeconds > 0) {
        const pct = Math.min(100, (year.time / goalYearTimeSeconds) * 100);
        document.getElementById("yearTimeGoalBar").style.width = pct + "%";
        document.getElementById("yearTimeGoalProgress").textContent = new Date(year.time * 1000).toISOString().slice(11, 19);
        document.getElementById("yearTimeGoalTarget").textContent = formatHHMM(goalYearTimeSeconds);
    }
}

function formatHHMM(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    return `${h}:${String(m).padStart(2, "0")}`;
}

function parseTimeInput(val) {
    const parts = val.trim().split(":").map(Number);
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
}

// Parse hh:mm into total seconds (for weekly/monthly/yearly time goals)
function parseHHMM(val) {
    const parts = val.trim().split(":").map(Number);
    if (parts.length === 2) return parts[0] * 3600 + parts[1] * 60;
    return 0;
}

// ============================================================
// Today's Totals
// ============================================================

function updateTodayTotals() {
    const s = getPeriodStats(1);
    const fmt = (sec) => new Date(sec * 1000).toISOString().slice(11, 19);
    document.getElementById("todayDistance").textContent = s.dist.toFixed(2);
    document.getElementById("todayCalories").textContent = Math.round(s.cal);
    document.getElementById("todayTime").textContent     = fmt(s.time);
    document.getElementById("todayAvgSpeed").textContent = s.avgSpeed.toFixed(2);
    document.getElementById("todaySessions").textContent = s.sess;
    document.getElementById("todayPauses").textContent   = s.pauses;
}

// ============================================================
// Period Stats (Week / Month)
// ============================================================

function getPeriodStats(days) {
    const history  = JSON.parse(localStorage.getItem("wp_history") || "{}");
    const today    = new Date().toISOString().slice(0, 10);
    const cutoff   = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10);
    let dist = 0, cal = 0, time = 0, spdSum = 0, spdSamp = 0, sess = 0, pauses = 0, maxSpd = 0;
    Object.entries(history).forEach(([date, d]) => {
        if (date >= cutoff && date <= today) {
            dist    += d.distance    || 0;
            cal     += d.calories    || 0;
            time    += d.timeSeconds || 0;
            spdSum  += d.speedSum    || 0;
            spdSamp += d.speedSamples || 0;
            sess    += d.sessions    || 0;
            pauses  += d.pauses      || 0;
            maxSpd   = Math.max(maxSpd, d.maxSpeed || 0);
        }
    });
    // Add current unsaved session delta for today
    if (today >= cutoff) {
        dist    += Math.max(0, cumDistance    - lastHistoryDistance);
        cal     += Math.max(0, cumCalories    - lastHistoryCalories);
        time    += Math.max(0, cumTimeSeconds - lastHistoryTimeSeconds);
        spdSum  += Math.max(0, speedSum       - lastHistorySpeedSum);
        spdSamp += Math.max(0, speedSamples   - lastHistorySpeedSamples);
        pauses  += Math.max(0, pauseCount     - lastHistoryPauseCount);
        maxSpd   = Math.max(maxSpd, maxSpeed);
    }
    const avgSpeed = spdSamp > 0 ? spdSum / spdSamp : 0;
    return { dist, cal, time, avgSpeed, sess, pauses, maxSpd };
}

function updatePeriodStats() {
    const week  = getPeriodStats(7);
    const month = getPeriodStats(30);
    const year  = getPeriodStats(365);

    const fmt = (s) => new Date(s * 1000).toISOString().slice(11, 19);

    document.getElementById("weekDist").textContent     = week.dist.toFixed(2);
    document.getElementById("weekCal").textContent      = Math.round(week.cal);
    document.getElementById("weekTime").textContent     = fmt(week.time);
    document.getElementById("weekAvgSpd").textContent   = week.avgSpeed.toFixed(2);
    document.getElementById("weekSessions").textContent = week.sess;
    document.getElementById("weekPauses").textContent   = week.pauses;

    document.getElementById("monthDist").textContent     = month.dist.toFixed(2);
    document.getElementById("monthCal").textContent      = Math.round(month.cal);
    document.getElementById("monthTime").textContent     = fmt(month.time);
    document.getElementById("monthAvgSpd").textContent   = month.avgSpeed.toFixed(2);
    document.getElementById("monthSessions").textContent = month.sess;
    document.getElementById("monthPauses").textContent   = month.pauses;

    document.getElementById("yearDist").textContent     = year.dist.toFixed(2);
    document.getElementById("yearCal").textContent      = Math.round(year.cal);
    document.getElementById("yearTime").textContent     = fmt(year.time);
    document.getElementById("yearAvgSpd").textContent   = year.avgSpeed.toFixed(2);
    document.getElementById("yearSessions").textContent = year.sess;
    document.getElementById("yearPauses").textContent   = year.pauses;
}

function getAllTimeExtras() {
    const history = JSON.parse(localStorage.getItem("wp_history") || "{}");
    let bestDayDist = 0, bestDayDate = null, totalSessions = 0;
    Object.entries(history).forEach(([date, d]) => {
        if ((d.distance || 0) > bestDayDist) { bestDayDist = d.distance; bestDayDate = date; }
        totalSessions += d.sessions || 0;
    });
    return { bestDayDist, bestDayDate, totalSessions };
}

function updateAllTimeExtras() {
    const { bestDayDist, bestDayDate, totalSessions } = getAllTimeExtras();
    document.getElementById("allTimeBestDay").textContent =
        bestDayDate ? `${bestDayDist.toFixed(2)} km (${bestDayDate})` : "—";
    document.getElementById("allTimeTotalSessions").textContent = totalSessions;
}

// ============================================================
// Onboarding
// ============================================================

function showOnboardingModal() {
    const modal = document.getElementById("onboardingModal");
    modal.classList.remove("hidden");
    modal.classList.add("flex");
}

function saveOnboarding() {
    const w = parseFloat(document.getElementById("onboardingWeight").value);
    const h = document.getElementById("onboardingHeight").value.trim();
    const a = parseInt(document.getElementById("onboardingAge").value);
    const err = document.getElementById("onboardingError");
    if (!w || !h || !a) { err.classList.remove("hidden"); return; }
    err.classList.add("hidden");
    userWeight = w; userHeight = h; userAge = a;
    localStorage.setItem("wp_weight", userWeight);
    localStorage.setItem("wp_height", userHeight);
    localStorage.setItem("wp_age", userAge);
    document.getElementById("weightInput").value = userWeight;
    document.getElementById("heightInput").value = userHeight;
    document.getElementById("ageInput").value    = userAge;
    const modal = document.getElementById("onboardingModal");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

// ============================================================
// Collapsible Sections
// ============================================================

function toggleSection(contentId, chevronId) {
    document.getElementById(contentId).classList.toggle("hidden");
    document.getElementById(chevronId).classList.toggle("rotate-180");
}

function toggleTotalsMore() {
    document.getElementById("cumMoreStats").classList.toggle("hidden");
    document.getElementById("cumMoreChevron").classList.toggle("rotate-180");
    const label = document.getElementById("cumMoreLabel");
    label.textContent = label.textContent === "Show more" ? "Show less" : "Show more";
}

// ============================================================
// Light/Dark Mode
// ============================================================

function applyTheme(isDark) {
    if (isDark) {
        document.documentElement.classList.add("dark");
    } else {
        document.documentElement.classList.remove("dark");
    }
    if (wpCharts.distance) renderCharts();
    if (wpCharts.liveSpeed) {
        wpCharts.liveSpeed.destroy();
        wpCharts.liveSpeed = null;
        initLiveSpeedChart();
    }
}

function loadTheme() {
    const saved = localStorage.getItem("wp_theme");
    const isDark = saved === null ? true : saved === "dark";
    applyTheme(isDark);
}

// ============================================================
// Modal Logic
// ============================================================

function showContinueModal() {
    document.getElementById("continueModal").classList.remove("hidden");
}

function hideContinueModal() {
    document.getElementById("continueModal").classList.add("hidden");
}

// ============================================================
// 1-Second Interval: Estimated Distance, Steps, Power, Live Chart
// ============================================================

let autoBackupTick = 0;

setInterval(() => {
    const speed = currentSpeed || 0;
    const now   = Date.now();
    const dt    = (now - lastDistanceUpdate) / 3600000;

    autoBackupTick++;
    if (autoBackupTick % 30 === 0 && cumDistance > 0 && (isRunning || isPaused)) {
        saveSessionBackup();
    }

    if (dt > 0) {
        if (speed > 0) {
            estimatedDistanceKm  += speed * dt;
            cumEstimatedDistance += speed * dt;
        }
        lastDistanceUpdate = now;
    }

    const heightInput = document.getElementById("heightInput")?.value || defaultHeight;
    const currentStepsEst = estimateSteps(estimatedDistanceKm, heightInput);
    if (document.getElementById("currentSteps")) document.getElementById("currentSteps").textContent = currentStepsEst;
    const cumStepsEst = estimateSteps(cumEstimatedDistance, heightInput);
    if (document.getElementById("cumSteps")) document.getElementById("cumSteps").textContent = cumStepsEst;
    if (document.getElementById("cumEstimatedDistance")) document.getElementById("cumEstimatedDistance").textContent = cumEstimatedDistance.toFixed(2);

    const powerThisSecond = estimatePower(currentSpeed, userWeight);
    cumPower = powerThisSecond;
    if (isRunning) cumTotalPower += powerThisSecond;
    if (document.getElementById("cumPower")) document.getElementById("cumPower").textContent = cumPower;
    if (document.getElementById("cumTotalPower")) document.getElementById("cumTotalPower").textContent = cumTotalPower;

    if (isRunning) updateLiveSpeedChart();
}, 1000);

// ============================================================
// Event Listeners
// ============================================================

document.getElementById("scanBtn").addEventListener("click", initBLE);

document.getElementById("lightDarkModeBtn").addEventListener("click", () => {
    const isDark = document.documentElement.classList.contains("dark");
    localStorage.setItem("wp_theme", isDark ? "light" : "dark");
    applyTheme(!isDark);
});

document.getElementById("startBtn").addEventListener("click", () => {
    showContinueModal();
});

document.getElementById("continueYesBtn").addEventListener("click", async () => {
    hideContinueModal();
    loadCumulativeStats();
    updateCumulativeStats();
    localStorage.removeItem("wp_session_backup");
    updateRecoverBtn();
    setStatus("Starting…", "bg-yellow-400");
    ftmsCmd([0x07]);
});

document.getElementById("continueNoBtn").addEventListener("click", () => {
    hideContinueModal();
    saveSessionBackup();
    cumDistance = 0; cumCalories = 0; cumTimeSeconds = 0;
    pauseCount = 0; totalPauseTime = 0; cumTotalPower = 0;
    maxSpeed = 0; speedSum = 0; speedSamples = 0;
    estimatedDistanceKm = 0; cumEstimatedDistance = 0;
    liveSpeedData = []; liveSpeedLabels = []; liveSecondCount = 0;
    lastHistoryDistance = 0; lastHistoryCalories = 0;
    lastHistorySpeedSum = 0; lastHistorySpeedSamples = 0;
    autoSaveCumulativeStats();
    setStatus("Starting…", "bg-yellow-400");
    ftmsCmd([0x07]);
});

document.getElementById("stopBtn").addEventListener("click", () => {
    haptic([50, 30, 50]);
    isPaused = false;
    ftmsCmd([0x08, 0x01]);
    exportStats();
});

document.getElementById("pauseBtn").addEventListener("click", () => {
    if (isRunning) {
        haptic();
        isPaused  = true;
        isRunning = false;
        pauseCount++;
        pauseStartTimestamp = Date.now();
        ftmsCmd([0x08, 0x01]);
        setStatus("Pausing…", "bg-yellow-400");
        updateCumulativeStats();
    }
});

document.getElementById("resumeBtn").addEventListener("click", () => {
    if (!isRunning) {
        haptic();
        if (pauseStartTimestamp) {
            totalPauseTime += (Date.now() - pauseStartTimestamp) / 1000;
            pauseStartTimestamp = null;
        }
        isPaused = false;
        updateCumulativeStats();
        pendingResumeSpeed = lastSpeed;
        ftmsCmd([0x07]);
    }
});

document.getElementById("speedDownBtn").addEventListener("click", () => {
    haptic(30);
    lastSpeed = Math.max(1.0, Math.round((lastSpeed * 10 - 5)) / 10);
    ftmsCmd(ftmsSpeedBytes(lastSpeed));
});

document.getElementById("speedUpBtn").addEventListener("click", () => {
    haptic(30);
    lastSpeed = Math.min(12.0, Math.round((lastSpeed * 10 + 5)) / 10);
    ftmsCmd(ftmsSpeedBytes(lastSpeed));
});

function startAndSetSpeed(targetSpeed) {
    haptic(30);
    lastSpeed = targetSpeed;
    if (!isRunning) {
        pendingResumeSpeed = targetSpeed;
        ftmsCmd([0x07]);
    } else {
        ftmsCmd(ftmsSpeedBytes(targetSpeed));
    }
}

document.getElementById("preset35Btn").addEventListener("click", () => startAndSetSpeed(3.5));
document.getElementById("preset45Btn").addEventListener("click", () => startAndSetSpeed(4.5));
document.getElementById("preset55Btn").addEventListener("click", () => startAndSetSpeed(5.5));

document.getElementById("exportBtn").addEventListener("click", exportStats);

document.getElementById("setDefaultsBtn").addEventListener("click", () => {
    saveDefaults();
    document.getElementById("settingsModal").classList.add("hidden");
});

document.getElementById("settingsBtn").addEventListener("click", () => {
    document.getElementById("settingsModal").classList.remove("hidden");
});

document.getElementById("closeSettingsBtn").addEventListener("click", () => {
    document.getElementById("settingsModal").classList.add("hidden");
});

document.getElementById("goalsBtn").addEventListener("click", () => {
    document.getElementById("goalsModal").classList.remove("hidden");
});

document.getElementById("closeGoalsBtn").addEventListener("click", () => {
    document.getElementById("goalsModal").classList.add("hidden");
});

["settingsModal", "goalsModal", "continueModal", "recoverModal"].forEach(id => {
    document.getElementById(id).addEventListener("click", function (e) {
        if (e.target === this) this.classList.add("hidden");
    });
});

document.getElementById("copyForSheetsBtn").addEventListener("click", copyForSheets);

document.getElementById("goalDistanceSlider").addEventListener("input", function() {
    const val = parseFloat(this.value);
    goalDistanceKm = val;
    localStorage.setItem("wp_goal_distance", val);
    document.getElementById("goalDistanceDisplay").textContent = val > 0 ? val.toFixed(1) : "—";
    updateGoalProgress();
});

document.getElementById("goalTimeSlider").addEventListener("input", function() {
    const mins = parseInt(this.value);
    goalTimeSeconds = mins * 60;
    localStorage.setItem("wp_goal_time_seconds", goalTimeSeconds);
    document.getElementById("goalTimeDisplay").textContent = mins > 0 ? mins + ":00" : "—";
    updateGoalProgress();
});

document.getElementById("goalWeekDistanceSlider").addEventListener("input", function() {
    const val = parseFloat(this.value);
    goalWeekDistanceKm = val;
    localStorage.setItem("wp_goal_week_distance", val);
    document.getElementById("goalWeekDistanceDisplay").textContent = val > 0 ? val.toFixed(1) : "—";
    updateGoalProgress();
});

document.getElementById("goalWeekTimeSlider").addEventListener("input", function() {
    const mins = parseInt(this.value);
    goalWeekTimeSeconds = mins * 60;
    localStorage.setItem("wp_goal_week_time_seconds", goalWeekTimeSeconds);
    document.getElementById("goalWeekTimeDisplay").textContent = mins > 0 ? formatHHMM(goalWeekTimeSeconds) : "—";
    updateGoalProgress();
});

document.getElementById("goalMonthDistanceSlider").addEventListener("input", function() {
    const val = parseFloat(this.value);
    goalMonthDistanceKm = val;
    localStorage.setItem("wp_goal_month_distance", val);
    document.getElementById("goalMonthDistanceDisplay").textContent = val > 0 ? val.toFixed(1) : "—";
    updateGoalProgress();
});

document.getElementById("goalMonthTimeSlider").addEventListener("input", function() {
    const mins = parseInt(this.value);
    goalMonthTimeSeconds = mins * 60;
    localStorage.setItem("wp_goal_month_time_seconds", goalMonthTimeSeconds);
    document.getElementById("goalMonthTimeDisplay").textContent = mins > 0 ? formatHHMM(goalMonthTimeSeconds) : "—";
    updateGoalProgress();
});

document.getElementById("goalYearDistanceSlider").addEventListener("input", function() {
    const val = parseFloat(this.value);
    goalYearDistanceKm = val;
    localStorage.setItem("wp_goal_year_distance", val);
    document.getElementById("goalYearDistanceDisplay").textContent = val > 0 ? val.toFixed(0) : "—";
    updateGoalProgress();
});

document.getElementById("goalYearTimeSlider").addEventListener("input", function() {
    const mins = parseInt(this.value);
    goalYearTimeSeconds = mins * 60;
    localStorage.setItem("wp_goal_year_time_seconds", goalYearTimeSeconds);
    document.getElementById("goalYearTimeDisplay").textContent = mins > 0 ? formatHHMM(goalYearTimeSeconds) : "—";
    updateGoalProgress();
});

document.querySelectorAll(".live-window-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        liveChartMax = parseInt(btn.dataset.window);
        while (liveSpeedData.length > liveChartMax) { liveSpeedData.shift(); liveSpeedLabels.shift(); }
        document.querySelectorAll(".live-window-btn").forEach(b => {
            b.className = b.className.replace("bg-sporty text-white", "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300");
        });
        btn.className = btn.className.replace("bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300", "bg-sporty text-white");
        btn.className = btn.className.replace("hover:bg-sporty hover:text-white", "");
    });
});

document.querySelectorAll(".live-ymax-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        liveChartYMax = parseInt(btn.dataset.ymax);
        if (wpCharts.liveSpeed) {
            const yScale = wpCharts.liveSpeed.options.scales.y;
            if (liveChartYMax > 0) { yScale.max = liveChartYMax; } else { delete yScale.max; }
            wpCharts.liveSpeed.update();
        }
        document.querySelectorAll(".live-ymax-btn").forEach(b => {
            b.className = b.className.replace("bg-sporty text-white", "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300");
        });
        btn.className = btn.className.replace("bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300", "bg-sporty text-white");
        btn.className = btn.className.replace("hover:bg-sporty hover:text-white", "");
    });
});

// --- Recovery Modal ---
let pendingMergeFn   = null;
let pendingReplaceFn = null;

function closeRecoverModal() {
    pendingMergeFn   = null;
    pendingReplaceFn = null;
    const modal = document.getElementById("recoverModal");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function showRecoverModal(snapshot, title, onMerge, onReplace) {
    const avgSpeed = snapshot.speedSamples > 0
        ? (snapshot.speedSum / snapshot.speedSamples).toFixed(2) : "0.00";
    document.getElementById("recoverModalTitle").textContent    = title;
    document.getElementById("recoverModalSavedAt").textContent  = "Saved: " + snapshot.savedAt;
    document.getElementById("recoverModalDistance").textContent = snapshot.cumDistance.toFixed(2) + " km";
    document.getElementById("recoverModalCalories").textContent = snapshot.cumCalories.toFixed(1) + " kcal";
    document.getElementById("recoverModalTime").textContent     =
        new Date(snapshot.cumTimeSeconds * 1000).toISOString().slice(11, 19);
    document.getElementById("recoverModalMaxSpeed").textContent = snapshot.maxSpeed.toFixed(1) + " km/h";
    document.getElementById("recoverModalAvgSpeed").textContent = avgSpeed + " km/h";
    pendingMergeFn   = onMerge;
    pendingReplaceFn = onReplace;
    const modal = document.getElementById("recoverModal");
    modal.classList.remove("hidden");
    modal.classList.add("flex");
}

document.getElementById("recoverModalMergeBtn").addEventListener("click", () => {
    if (pendingMergeFn) pendingMergeFn();
    closeRecoverModal();
});

document.getElementById("recoverModalReplaceBtn").addEventListener("click", () => {
    if (pendingReplaceFn) pendingReplaceFn();
    closeRecoverModal();
});

document.getElementById("recoverModalCancelBtn").addEventListener("click", closeRecoverModal);

document.getElementById("recoverSessionBtn").addEventListener("click", () => {
    const snapshot = JSON.parse(localStorage.getItem("wp_session_backup") || "null");
    if (!snapshot) return;
    showRecoverModal(snapshot, "Recover Session", recoverSession, recoverFromSnapshot.bind(null, snapshot));
});

document.getElementById("recoverExportBtn").addEventListener("click", () => {
    const snapshot = JSON.parse(localStorage.getItem("wp_export_snapshot") || "null");
    if (!snapshot) return;
    showRecoverModal(snapshot, "Restore from Last Export", mergeFromSnapshot.bind(null, snapshot), recoverFromExport);
});

document.getElementById("clearHistoryBtn").addEventListener("click", () => {
    localStorage.removeItem("wp_history");
    renderCharts();
    renderSessionHistory();
});

document.getElementById("saveOnboardingBtn").addEventListener("click", saveOnboarding);

// --- Mobile bottom bar ---
document.getElementById("startBtnM").addEventListener("click",     () => document.getElementById("startBtn").click());
document.getElementById("stopBtnM").addEventListener("click",      () => document.getElementById("stopBtn").click());
document.getElementById("pauseBtnM").addEventListener("click",     () => document.getElementById("pauseBtn").click());
document.getElementById("resumeBtnM").addEventListener("click",    () => document.getElementById("resumeBtn").click());
document.getElementById("speedDownBtnM").addEventListener("click", () => document.getElementById("speedDownBtn").click());
document.getElementById("speedUpBtnM").addEventListener("click",   () => document.getElementById("speedUpBtn").click());
document.getElementById("preset35BtnM").addEventListener("click",  () => startAndSetSpeed(3.5));
document.getElementById("preset45BtnM").addEventListener("click",  () => startAndSetSpeed(4.5));
document.getElementById("preset55BtnM").addEventListener("click",  () => startAndSetSpeed(5.5));

// ============================================================
// Init on DOM Ready
// ============================================================

window.addEventListener("DOMContentLoaded", () => {
    loadTheme();
    loadDefaults();
    loadCumulativeStats();
    loadGoals();
    updateCumulativeStats();
    updateTodayTotals();
    updatePeriodStats();
    updateAllTimeExtras();
    initLiveSpeedChart();
    renderCharts();
    renderSessionHistory();
    updateRecoverBtn();
    updateExportRecoverBtn();
    loadCardState();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && isRunning) requestWakeLock();
    });
    if (window.innerWidth < 768) {
        ["liveSpeedContent", "historyChartsContent", "sessionHistoryContent"].forEach(id => {
            document.getElementById(id).classList.add("hidden");
        });
        ["liveSpeedChevron", "historyChartsChevron", "sessionHistoryChevron"].forEach(id => {
            document.getElementById(id).classList.add("rotate-180");
        });
    }
});
