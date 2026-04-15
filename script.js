"use strict";

// --- BLE Constants (FTMS only) ---
const FTMS_SERVICE = "00001826-0000-1000-8000-00805f9b34fb";
const FTMS_CONTROL = "00002ad9-0000-1000-8000-00805f9b34fb";
const FTMS_TREADMILL = "00002acd-0000-1000-8000-00805f9b34fb";
const FTMS_STATUS = "00002ada-0000-1000-8000-00805f9b34fb";

// --- Timing Constants ---
const STARTUP_NO_CONNECTION_DISMISS_MS = 4000; // how long to show "not connected" message
const STARTUP_ABORT_TIMEOUT_MS = 15000; // max wait before giving up on startup sequence
const BELT_SPEED_SET_DELAY_MS = 2500; // pad ramp-up time before sending target speed

// --- Workout Programs ---
// Steps are pre-expanded (no runtime looping). Speed in km/h, duration in seconds.
// requiresRunningMode: true → program needs handrail up (max 16 km/h); else walking mode safe (max 12 km/h).
const PROGRAM_CATEGORIES = [
    { id: "steady_state",    name: "Steady-State Walks" },
    { id: "progressive",     name: "Progressive / Ramp" },
    { id: "hiit",            name: "Interval Training (HIIT)" },
    { id: "fat_burn",        name: "Fat Burn / Zone 2" },
    { id: "distance_goals",  name: "Distance Goals" },
];

function _rep(n, arr) { const r = []; for (let i = 0; i < n; i++) r.push(...arr); return r; }

const WORKOUT_PROGRAMS = [
    // ── Steady-State Walks ──────────────────────────────────────────────
    {
        id: "easy_stroll", category: "steady_state", level: "beginner",
        name: "Easy Stroll", description: "Gentle habit-building walk at 3.5 km/h",
        requiresRunningMode: false,
        steps: [{ name: "Steady Walk", speed: 3.5, duration: 1200 }],
    },
    {
        id: "brisk_walker", category: "steady_state", level: "intermediate",
        name: "Brisk Walker", description: "Cardio maintenance walk at 6.0 km/h, zone 2–3",
        requiresRunningMode: false,
        steps: [{ name: "Brisk Walk", speed: 6.0, duration: 1800 }],
    },
    {
        id: "power_walk", category: "steady_state", level: "advanced",
        name: "Power Walk", description: "High-intensity sustained effort at 8.0 km/h",
        requiresRunningMode: false,
        steps: [{ name: "Power Walk", speed: 8.0, duration: 2700 }],
    },
    // ── Progressive / Ramp ──────────────────────────────────────────────
    {
        id: "progressive_walk", category: "progressive", level: "beginner",
        name: "Progressive Walk", description: "5 escalating phases, 3.5 → 6.0 km/h",
        requiresRunningMode: false,
        steps: [
            { name: "Easy Walk",     speed: 3.5, duration: 300 },
            { name: "Moderate Walk", speed: 4.5, duration: 300 },
            { name: "Brisk Walk",    speed: 5.5, duration: 300 },
            { name: "Power Walk",    speed: 6.0, duration: 300 },
            { name: "Cool-down",     speed: 4.0, duration: 300 },
        ],
    },
    {
        id: "pyramid_intervals", category: "progressive", level: "intermediate",
        name: "Pyramid Intervals", description: "Ramps 4.0 → 9.0 km/h peak, then back down",
        requiresRunningMode: false,
        steps: [
            { name: "Warm-up", speed: 4.0, duration: 180 },
            { name: "Level 1", speed: 5.0, duration: 180 },
            { name: "Level 2", speed: 6.0, duration: 180 },
            { name: "Level 3", speed: 7.0, duration: 180 },
            { name: "Level 4", speed: 8.0, duration: 180 },
            { name: "Peak",    speed: 9.0, duration: 120 },
            { name: "Level 4", speed: 8.0, duration: 180 },
            { name: "Level 3", speed: 7.0, duration: 180 },
            { name: "Level 2", speed: 6.0, duration: 180 },
            { name: "Level 1", speed: 5.0, duration: 180 },
            { name: "Cool-down", speed: 4.0, duration: 180 },
        ],
    },
    // ── Interval Training (HIIT) ─────────────────────────────────────────
    {
        id: "walk_jog_starter", category: "hiit", level: "beginner",
        name: "Walk / Jog Starter", description: "5× walk at 4.0 / jog at 7.0 km/h intervals",
        requiresRunningMode: false,
        steps: [
            { name: "Warm-up", speed: 3.5, duration: 120 },
            ..._rep(5, [
                { name: "Walk", speed: 4.0, duration: 180 },
                { name: "Jog",  speed: 7.0, duration: 60  },
            ]),
            { name: "Cool-down", speed: 3.0, duration: 120 },
        ],
    },
    {
        id: "c25k_week1", category: "hiit", level: "beginner",
        name: "C25K Week 1", description: "8× 60s jog at 8.0 / 90s walk at 5.0 km/h",
        requiresRunningMode: false,
        steps: [
            { name: "Warm-up Walk", speed: 5.0, duration: 300 },
            ..._rep(8, [
                { name: "Jog",  speed: 8.0, duration: 60 },
                { name: "Walk", speed: 5.0, duration: 90 },
            ]),
            { name: "Cool-down Walk", speed: 4.0, duration: 300 },
        ],
    },
    {
        id: "sprint_intervals", category: "hiit", level: "intermediate",
        name: "Sprint Intervals", description: "6× 1-min sprint at 12.0 / 2-min recovery at 5.0 km/h",
        requiresRunningMode: false,
        steps: [
            { name: "Warm-up", speed: 5.0, duration: 180 },
            ..._rep(6, [
                { name: "Sprint",   speed: 12.0, duration: 60  },
                { name: "Recovery", speed: 5.0,  duration: 120 },
            ]),
            { name: "Cool-down", speed: 4.0, duration: 180 },
        ],
    },
    {
        id: "tabata_sprint", category: "hiit", level: "advanced",
        name: "Tabata Sprint", description: "8× 20s at 10.0 km/h / 10s rest — classic Tabata",
        requiresRunningMode: false,
        steps: [
            { name: "Warm-up", speed: 4.5, duration: 300 },
            ..._rep(8, [
                { name: "Sprint", speed: 10.0, duration: 20 },
                { name: "Rest",   speed: 3.5,  duration: 10 },
            ]),
            { name: "Cool-down", speed: 4.0, duration: 300 },
        ],
    },
    {
        id: "peak_performance", category: "hiit", level: "advanced",
        name: "Peak Performance", description: "10× 45s at 16.0 km/h max-effort, running mode required",
        requiresRunningMode: true,
        steps: [
            { name: "Warm-up", speed: 6.0, duration: 180 },
            ..._rep(10, [
                { name: "Peak Sprint", speed: 16.0, duration: 45 },
                { name: "Recovery",    speed: 5.0,  duration: 90 },
            ]),
            { name: "Cool-down", speed: 4.0, duration: 180 },
        ],
    },
    // ── Fat Burn / Zone 2 ────────────────────────────────────────────────
    {
        id: "fat_burn_foundation", category: "fat_burn", level: "beginner",
        name: "Fat Burn Foundation", description: "Zone 2 aerobic base-building at 4.75 km/h",
        requiresRunningMode: false,
        steps: [{ name: "Zone 2 Walk", speed: 4.75, duration: 1800 }],
    },
    {
        id: "zone2_cruise", category: "fat_burn", level: "intermediate",
        name: "Zone 2 Cruise", description: "Sustained fat oxidation cruise at 6.5 km/h",
        requiresRunningMode: false,
        steps: [{ name: "Zone 2 Cruise", speed: 6.5, duration: 2700 }],
    },
    {
        id: "endurance_builder", category: "fat_burn", level: "advanced",
        name: "Endurance Builder", description: "Long aerobic base session at 7.5 km/h",
        requiresRunningMode: false,
        steps: [{ name: "Endurance Walk", speed: 7.5, duration: 3600 }],
    },
    // ── Distance Goals (time-based approximations of ~5 km) ─────────────
    {
        id: "first_5k", category: "distance_goals", level: "beginner",
        name: "5K Foundation Walk", description: "~5 km walk at 4.5 km/h comfortable pace",
        requiresRunningMode: false, approximateDistanceKm: 5.0,
        steps: [{ name: "5K Walk", speed: 4.5, duration: 4020 }],
    },
    {
        id: "5k_time_trial", category: "distance_goals", level: "intermediate",
        name: "5K Time Trial", description: "~5 km benchmark effort at 8.6 km/h running pace",
        requiresRunningMode: false, approximateDistanceKm: 5.0,
        steps: [{ name: "5K Pace", speed: 8.6, duration: 2100 }],
    },
];

// --- Wake Lock ---
let wakeLock = null;

async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
            wakeLock = null;
        });
    } catch (e) {
        console.warn("Wake lock failed:", e);
    }
}

function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release();
        wakeLock = null;
    }
}

// --- Haptic ---
function haptic(pattern = 50) {
    if (navigator.vibrate) navigator.vibrate(pattern);
}

// --- BLE State ---
let device, server;
let ftmsService = null,
    cFTMSControl = null,
    cFTMSTreadmill = null,
    cFTMSStatus = null;
let isRunning = false;
let isPaused = false;
let historyView = "day"; // "day" or "session"
let lastSpeed = 1.0;
let isConnected = false;
let reconnectAttempts = 0;
let reconnectTimer = null;
let pendingResumeSpeed = 0; // set on resume; applied on first running notification
let sessionStartTime = null; // ISO string, set on first opcode 0x04 each session

// --- Startup Indicator ---
let startupDismissTimer = null;
let startupHasSpeedStep = false;
let startupBeltConfirmed = false;
let startupBeltPackets = 0; // treadmill packets received during belt ramp-up

function showStartupIndicator(targetSpeed) {
    clearTimeout(startupDismissTimer);
    const el = document.getElementById("startupIndicator");
    el.classList.remove("hidden");

    if (!cFTMSControl) {
        document.getElementById("startupHeaderIcon").className =
            "fas fa-times-circle text-red-400";
        document
            .getElementById("startup-no-connection")
            .classList.replace("hidden", "flex");
        document.getElementById("startup-steps").classList.add("hidden");
        startupDismissTimer = setTimeout(() => {
            el.classList.add("hidden");
            document
                .getElementById("startup-no-connection")
                .classList.replace("flex", "hidden");
            document.getElementById("startup-steps").classList.remove("hidden");
        }, STARTUP_NO_CONNECTION_DISMISS_MS);
        return;
    }

    startupHasSpeedStep = targetSpeed > 0;
    startupBeltConfirmed = false;
    startupBeltPackets = 0;
    document.getElementById("startupHeaderIcon").className =
        "fas fa-circle-notch fa-spin";
    // Safety: abort if startup hasn't completed within 15 seconds
    startupDismissTimer = setTimeout(
        () => abortStartupIndicator("Timed out"),
        STARTUP_ABORT_TIMEOUT_MS,
    );
    setStartupStep("step-cmd", "done", "Start command sent");
    setStartupStep("step-ack", "active", "Waiting for pad acknowledgement…");
    setStartupStep("step-belt", "pending", "Belt starting");
    const speedStep = document.getElementById("step-speed");
    if (startupHasSpeedStep) {
        speedStep.classList.remove("hidden");
        setStartupStep(
            "step-speed",
            "pending",
            `Set speed to ${targetSpeed.toFixed(1)} km/h`,
        );
    } else {
        speedStep.classList.add("hidden");
    }
}

function setStartupStep(id, state, text) {
    const el = document.getElementById(id);
    if (!el) return;
    const icon = el.querySelector("i");
    const span = el.querySelector("span");
    icon.className = "fas w-4 text-center";
    switch (state) {
        case "done":
            icon.classList.add("fa-check-circle", "text-green-400");
            break;
        case "active":
            icon.classList.add("fa-circle-notch", "fa-spin", "text-yellow-400");
            break;
        case "pending":
            icon.classList.add("fa-circle", "text-gray-500");
            break;
        case "error":
            icon.classList.add("fa-times-circle", "text-red-400");
            break;
    }
    span.textContent = text;
    span.className = state === "pending" ? "text-gray-500" : "text-white";
}

function dismissStartupIndicator() {
    clearTimeout(startupDismissTimer);
    document.getElementById("startupHeaderIcon").className =
        "fas fa-check text-green-400";
    startupDismissTimer = setTimeout(() => {
        document.getElementById("startupIndicator").classList.add("hidden");
    }, 2000);
}

function abortStartupIndicator(reason) {
    clearTimeout(startupDismissTimer);
    const el = document.getElementById("startupIndicator");
    if (el.classList.contains("hidden")) return;
    document.getElementById("startupHeaderIcon").className =
        "fas fa-times-circle text-red-400";
    // Mark any still-pending/active step as the error
    ["step-ack", "step-belt", "step-speed"].forEach((id) => {
        const step = document.getElementById(id);
        if (!step || step.classList.contains("hidden")) return;
        const icon = step.querySelector("i");
        if (
            icon &&
            (icon.classList.contains("fa-spin") ||
                icon.classList.contains("fa-circle"))
        ) {
            setStartupStep(id, "error", reason);
        }
    });
    startupDismissTimer = setTimeout(() => {
        el.classList.add("hidden");
    }, 3000);
}

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
const MAX_REALISTIC_SPEED = 20; // km/h; discard obviously malformed FTMS packets
let maxSpeed = 0;
let speedSum = 0;
let speedSamples = 0;
let deltaMaxSpeed = 0; // max within the current save-to-history delta window

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
let userHeightCm = 173;
let userHeightUnit = "ftin"; // "ftin" or "cm"
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

// --- Workout Program State ---
let activeProgram          = null;   // selected WORKOUT_PROGRAMS entry, or null
let programStepIndex       = 0;      // current step index (0-based)
let programStepElapsed     = 0;      // seconds elapsed in current step
let programTotalElapsed    = 0;      // seconds elapsed overall in this program run
let programRunning         = false;  // true while a program is actively executing
let programUserOverride    = false;  // true after user manually adjusts speed mid-program
let programCompletedFlag   = false;  // true when program finishes naturally (for history save)
let programResuming        = false;  // true when resuming from saved state (skip counter reset)
let programCompleteBannerTimer = null;
let programFilterCategory  = "all";  // active filter pill in program picker
let pendingProgramId       = null;   // program ID to start once belt is active (post-startup or post-warmup)
let warmupDurationMins     = 10;     // user-adjustable warm-up duration (5–30 min)
let warmupPromptActive     = false;  // true while warm-up question is visible in state-2

// --- Program Category Display Maps ---
const CATEGORY_PILL_LABELS = {
    steady_state:    "Steady",
    progressive:     "Ramp",
    hiit:            "HIIT",
    fat_burn:        "Fat Burn",
    distance_goals:  "5K",
};
const CATEGORY_ICONS = {
    steady_state:   { icon: "fa-arrow-right",     color: "bg-sky-100 text-sky-600 dark:bg-sky-900/50 dark:text-sky-400" },
    progressive:    { icon: "fa-arrow-trend-up",  color: "bg-violet-100 text-violet-600 dark:bg-violet-900/50 dark:text-violet-400" },
    hiit:           { icon: "fa-bolt",            color: "bg-orange-100 text-orange-600 dark:bg-orange-900/50 dark:text-orange-400" },
    fat_burn:       { icon: "fa-fire",            color: "bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400" },
    distance_goals: { icon: "fa-flag-checkered",  color: "bg-green-100 text-green-600 dark:bg-green-900/50 dark:text-green-400" },
};

function applyCardCollapsed(id, collapsed) {
    const body = document.getElementById("body-" + id);
    const chevronEl = document.getElementById("chevron-" + id);
    const titleEl = document.getElementById("title-" + id);
    if (!body) return;
    body.classList.toggle("hidden", collapsed);
    if (chevronEl) {
        if (chevronEl.tagName === "BUTTON") {
            // Period card corner button — hide when collapsed (title header takes over)
            chevronEl.classList.toggle("hidden", collapsed);
        } else {
            // Regular card chevron icon — rotate to indicate state, never hide
            chevronEl.classList.toggle("rotate-180", collapsed);
        }
    }
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
    cardCollapsed = JSON.parse(
        localStorage.getItem("wp_card_collapsed") || "{}",
    );
    cardHidden = JSON.parse(localStorage.getItem("wp_card_hidden") || "{}");
    [
        "session",
        "period1",
        "period2",
        "alltime",
        "livespeed",
        "trends",
        "history",
    ].forEach((id) => {
        applyCardCollapsed(id, cardCollapsed[id] || false);
        applyCardHidden(id, cardHidden[id] || false);
        const cb = document.getElementById("show-card-" + id);
        if (cb) cb.checked = !cardHidden[id];
    });
    document.querySelectorAll(".card-collapse-btn").forEach((btn) => {
        btn.addEventListener("click", () =>
            toggleCardCollapse(btn.dataset.card),
        );
    });
    [
        "session",
        "period1",
        "period2",
        "alltime",
        "livespeed",
        "trends",
        "history",
    ].forEach((id) => {
        const cb = document.getElementById("show-card-" + id);
        if (!cb) return;
        cb.addEventListener("change", function () {
            cardHidden[id] = !this.checked;
            localStorage.setItem("wp_card_hidden", JSON.stringify(cardHidden));
            applyCardHidden(id, cardHidden[id]);
        });
    });
}

// ============================================================
// Workout Programs
// ============================================================

function _fmtProgTime(s) {
    const m = Math.floor(s / 60), sec = s % 60;
    return m + ":" + String(sec).padStart(2, "0");
}

function _progTotalSeconds(prog) {
    return prog.steps.reduce((t, s) => t + s.duration, 0);
}

function selectProgram(id) {
    activeProgram = WORKOUT_PROGRAMS.find((p) => p.id === id) || null;
    programStepIndex = 0;
    programStepElapsed = 0;
    programTotalElapsed = 0;
    programRunning = false;
    programUserOverride = false;
    programCompletedFlag = false;
    programResuming = false;
    if (id) localStorage.setItem("wp_last_program_id", id);
    renderProgramPicker();
    renderProgramSection();
}

function startProgram() {
    if (!activeProgram || !isRunning) return;
    clearTimeout(programCompleteBannerTimer);
    if (!programResuming) {
        // Fresh start — reset counters
        programStepIndex = 0;
        programStepElapsed = 0;
        programTotalElapsed = 0;
    }
    programRunning = true;
    programUserOverride = false;
    programCompletedFlag = false;
    programResuming = false;
    const step = activeProgram.steps[programStepIndex];
    lastSpeed = step.speed;
    ftmsCmd(ftmsSpeedBytes(step.speed));
    haptic(50);
    document.getElementById("card-programs").classList.add("hidden");
    renderProgramSection();
}

function cancelProgram() {
    clearTimeout(programCompleteBannerTimer);
    programRunning = false;
    programCompletedFlag = false;
    programResuming = false;
    pendingProgramId = null;
    warmupPromptActive = false;
    activeProgram = null;
    clearProgramState();
    renderProgramSection();
    renderProgramPicker();
}

// Build a warm-up program dynamically from the user's preferred duration
function buildWarmupProgram(durationMins) {
    const totalSec = durationMins * 60;
    const phase = Math.floor(totalSec / 3);
    const rem   = totalSec - phase * 3;
    return {
        id:                 "_warmup",
        name:               `Warm-up (${durationMins} min)`,
        category:           "steady_state",
        level:              "beginner",
        description:        "Pre-workout ramp-up",
        requiresRunningMode: false,
        steps: [
            { name: "Easy Walk",   speed: 3.5, duration: phase },
            { name: "Steady Walk", speed: 5.0, duration: phase },
            { name: "Brisk Walk",  speed: 6.0, duration: phase + rem },
        ],
    };
}

// Launch program immediately (belt running) or queue it for when belt starts
function launchOrQueueProgram(id) {
    const prog = WORKOUT_PROGRAMS.find((p) => p.id === id) || null;
    if (!prog) return;
    if (!cFTMSControl && !isConnected) {
        // No connection yet — show "not connected" indicator
        showStartupIndicator(prog.steps[0].speed);
        return;
    }
    if (isRunning) {
        // Belt already running — start immediately
        selectProgram(id);
        startProgram();
    } else {
        // Queue program and start the belt
        selectProgram(id);
        pendingProgramId = id;
        const firstSpeed = prog.steps[0].speed;
        pendingResumeSpeed = firstSpeed;
        ftmsCmd([0x07]);
        showStartupIndicator(firstSpeed);
    }
}

// Launch warm-up then chain to targetId
function launchWarmup(targetId) {
    warmupPromptActive = false;
    pendingProgramId = targetId;
    const wu = buildWarmupProgram(warmupDurationMins);
    // Patch warm-up into activeProgram directly (it's not in WORKOUT_PROGRAMS)
    activeProgram       = wu;
    programStepIndex    = 0;
    programStepElapsed  = 0;
    programTotalElapsed = 0;
    programCompletedFlag = false;
    programResuming     = false;
    if (!isRunning) {
        // Belt not running — queue warm-up start
        pendingResumeSpeed = wu.steps[0].speed;
        ftmsCmd([0x07]);
        showStartupIndicator(wu.steps[0].speed);
        // pendingProgramId is the *chained* target; the warm-up kicks off via
        // applyPendingProgram() once the belt starts, but we've already set activeProgram.
        // Clear pendingProgramId temporarily — it will be restored after warm-up finishes.
        // Store the chain target in a separate flag and restore after warm-up.
        pendingProgramId = targetId; // chain target remains set
        programRunning = false;      // startProgram() will fire via applyPendingProgram
    } else {
        startProgram();
    }
}

// Called when user selects a program from the picker (not on page-load restore)
function programPickerSelected(id) {
    selectProgram(id);
    warmupPromptActive = false;
    // Determine if warm-up prompt is needed: belt hasn't been active ≥5 min this session
    const needsWarmup = cumTimeSeconds < 300;
    if (needsWarmup) {
        warmupPromptActive = true;
        renderProgramSection(); // shows state-2 with warm-up prompt visible
    } else {
        launchOrQueueProgram(id);
    }
}

function tickProgram() {
    if (!programRunning || isPaused || !isRunning) return;
    programStepElapsed++;
    programTotalElapsed++;
    const step = activeProgram.steps[programStepIndex];
    if (programStepElapsed >= step.duration) {
        programStepIndex++;
        if (programStepIndex >= activeProgram.steps.length) {
            programRunning = false;
            programCompletedFlag = true;
            clearProgramState();
            haptic([100, 50, 100, 50, 200]);
            const chainId = pendingProgramId;
            pendingProgramId = null;
            renderProgramSection();
            if (chainId && isRunning) {
                // Auto-chain: warm-up → target program (3s transition)
                programCompleteBannerTimer = setTimeout(() => {
                    programCompletedFlag = false;
                    launchOrQueueProgram(chainId);
                }, 3000);
            } else {
                programCompleteBannerTimer = setTimeout(() => {
                    if (!programRunning) {
                        programCompletedFlag = false;
                        activeProgram = null;
                        renderProgramSection();
                        renderProgramPicker();
                    }
                }, 8000);
            }
            return;
        }
        programStepElapsed = 0;
        programUserOverride = false;
        const next = activeProgram.steps[programStepIndex];
        lastSpeed = next.speed;
        ftmsCmd(ftmsSpeedBytes(next.speed));
        haptic(30);
    }
    saveProgramState();
    renderProgramSection();
}

function updateProgramStartBtnState() {
    const btn = document.getElementById("programStartBtn");
    const hint = document.getElementById("prog-start-hint");
    if (!btn) return;
    // Button enabled whenever a program is selected and not actively running
    // (it now handles belt auto-start itself)
    const canStart = !!activeProgram && !programRunning;
    btn.disabled = !canStart;
    btn.classList.toggle("opacity-40", !canStart);
    btn.classList.toggle("cursor-not-allowed", !canStart);
    if (hint) hint.textContent = "";
}

function renderProgramFilterPills() {
    const pillsEl = document.getElementById("program-filter-pills");
    if (!pillsEl) return;
    const catPillCls = {
        steady_state:   { active: "bg-cyan-500 text-white",   inactive: "bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-200 dark:hover:bg-cyan-900/60" },
        progressive:    { active: "bg-sky-500 text-white",    inactive: "bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 hover:bg-sky-200 dark:hover:bg-sky-900/60" },
        hiit:           { active: "bg-blue-500 text-white",   inactive: "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/60" },
        fat_burn:       { active: "bg-indigo-500 text-white", inactive: "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900/60" },
        distance_goals: { active: "bg-violet-500 text-white", inactive: "bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/60" },
    };
    const allPill = `<button class="prog-pill text-xs font-semibold rounded-full px-2.5 py-1 transition-colors ${programFilterCategory === "all" ? "bg-sky-500 text-white" : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"}" data-cat="all">All</button>`;
    const catPills = PROGRAM_CATEGORIES.map((cat) => {
        const label = CATEGORY_PILL_LABELS[cat.id] || cat.name;
        const active = programFilterCategory === cat.id;
        const cls = catPillCls[cat.id];
        return `<button class="prog-pill text-xs font-semibold rounded-full px-2.5 py-1 transition-colors ${active ? cls.active : cls.inactive}" data-cat="${cat.id}">${label}</button>`;
    }).join("");
    pillsEl.innerHTML = allPill + catPills;
}

function renderProgramPicker() {
    renderProgramFilterPills();
    const list = document.getElementById("program-picker-list");
    if (!list) return;
    const levelBadgeCls = {
        beginner:     "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
        intermediate: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
        advanced:     "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
    };
    const levelBorderCls = {
        beginner:     "border-l-green-400 dark:border-l-green-500",
        intermediate: "border-l-amber-400 dark:border-l-amber-500",
        advanced:     "border-l-red-400 dark:border-l-red-500",
    };
const timeCls = "text-xs bg-gray-100 dark:bg-gray-600/60 text-gray-600 dark:text-gray-200 rounded px-1.5 py-0.5 tabular-nums";
    const speedCls = "text-xs bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300 rounded px-1.5 py-0.5 tabular-nums";
    const distCls  = "text-xs bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded px-1.5 py-0.5 tabular-nums";
    const catHeadingCls = {
        steady_state:   "text-cyan-400",
        progressive:    "text-sky-400",
        hiit:           "text-blue-400",
        fat_burn:       "text-indigo-400",
        distance_goals: "text-violet-400",
    };
    let html = "";
    PROGRAM_CATEGORIES.forEach((cat) => {
        if (programFilterCategory !== "all" && programFilterCategory !== cat.id) return;
        const progs = WORKOUT_PROGRAMS.filter((p) => p.category === cat.id);
        if (!progs.length) return;
        if (programFilterCategory === "all") {
            const headCls = catHeadingCls[cat.id] || "text-gray-400";
            html += `<div class="col-span-2 md:col-span-3 text-xs font-semibold tracking-wide mt-2 mb-0.5 px-1 ${headCls}">${cat.name}</div>`;
        }
        progs.forEach((p) => {
            const totalSec = _progTotalSeconds(p);
            const mins = Math.round(totalSec / 60);
            const isSelected = activeProgram && activeProgram.id === p.id;
            const levelLabel = p.level.charAt(0).toUpperCase() + p.level.slice(1);
            const speeds = [...new Set(p.steps.map(s => s.speed))].sort((a, b) => a - b);
            const speedLabel = speeds.length === 1
                ? `${speeds[0]} km/h`
                : `${speeds[0]}–${speeds[speeds.length - 1]} km/h`;
            const borderCls = levelBorderCls[p.level] || "border-l-gray-300";
            const selectedCls = isSelected
                ? "border-sky-400 bg-sky-50 dark:bg-sky-900/30"
                : "bg-white dark:bg-gray-800/60 border-gray-200 dark:border-gray-700 hover:border-sky-300 hover:bg-gray-50 dark:hover:bg-gray-700/50";
            const runBadge = p.requiresRunningMode
                ? `<span class="text-xs bg-orange-100 text-orange-700 dark:bg-orange-900/60 dark:text-orange-300 rounded px-1 py-0.5 font-medium">Running Mode</span>`
                : "";
            html += `<button class="program-item w-full text-left rounded-lg p-2 border border-l-[3px] transition-colors flex flex-col h-full ${borderCls} ${selectedCls}" data-id="${p.id}">
  <div class="font-semibold text-sm text-gray-900 dark:text-white truncate leading-tight">${p.name}</div>
  <div class="text-xs text-gray-400 dark:text-gray-500 line-clamp-2 mt-0.5 flex-1">${p.description}</div>
  <div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
    <span class="text-xs rounded px-1.5 py-0.5 font-medium ${levelBadgeCls[p.level] || ""}">${levelLabel}</span>
    <span class="${timeCls}"><i class="fas fa-clock text-[10px] mr-0.5 opacity-50"></i>${mins} min</span>
    <span class="${speedCls}"><i class="fas fa-gauge-high text-[10px] mr-0.5 opacity-70"></i>${speedLabel}</span>
    ${p.approximateDistanceKm ? `<span class="${distCls}">${p.approximateDistanceKm} km</span>` : ""}
    ${runBadge}
  </div>
</button>`;
        });
    });
    list.innerHTML = html;
}

function renderProgramSection() {
    const stateNone     = document.getElementById("prog-state-none");
    const stateSelected = document.getElementById("prog-state-selected");
    const stateRunning  = document.getElementById("prog-state-running");
    if (!stateNone) return;

    // Determine which state to show
    const showRunning  = programRunning || (!programRunning && activeProgram && programCompletedFlag);
    const showSelected = !showRunning && activeProgram;
    const showNone     = !showRunning && !showSelected;

    stateNone.classList.toggle("hidden", !showNone);
    stateSelected.classList.toggle("hidden", !showSelected);
    stateRunning.classList.toggle("hidden", !showRunning);

    // State 2: populate selected program info
    if (showSelected) {
        const catIcon = CATEGORY_ICONS[activeProgram.category] || { icon: "fa-route", color: "bg-gray-100 text-gray-500" };
        const levelColours = {
            beginner:     "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
            intermediate: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
            advanced:     "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
        };
        const iconEl = document.getElementById("prog-sel-icon");
        if (iconEl) {
            iconEl.className = `shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs ${catIcon.color}`;
            iconEl.innerHTML = `<i class="fas ${catIcon.icon}"></i>`;
        }
        const nameEl = document.getElementById("prog-sel-name");
        if (nameEl) nameEl.textContent = activeProgram.name;

        const levelEl = document.getElementById("prog-sel-level");
        if (levelEl) {
            levelEl.className = `text-xs rounded px-1 py-0.5 ${levelColours[activeProgram.level] || ""}`;
            levelEl.textContent = activeProgram.level;
        }
        const metaEl = document.getElementById("prog-sel-meta");
        if (metaEl) {
            const totalSec = _progTotalSeconds(activeProgram);
            const mins = Math.round(totalSec / 60);
            const parts = [`~${mins} min`];
            if (activeProgram.estimatedCalories) parts.push(`~${activeProgram.estimatedCalories} kcal`);
            if (activeProgram.approximateDistanceKm) parts.push(`~${activeProgram.approximateDistanceKm} km`);
            metaEl.textContent = parts.join(" · ");
        }
        // Warm-up prompt
        const wuPrompt = document.getElementById("prog-warmup-prompt");
        if (wuPrompt) {
            wuPrompt.classList.toggle("hidden", !warmupPromptActive);
            const durLabel = document.getElementById("warmupDurationLabel");
            if (durLabel) durLabel.textContent = warmupDurationMins;
        }
        updateProgramStartBtnState();
        return;
    }

    if (!showRunning) return;

    // State 3: program running or just completed
    if (!programRunning && activeProgram && programCompletedFlag) {
        document.getElementById("prog-name").textContent = activeProgram.name;
        document.getElementById("prog-step-name").textContent = "Program Complete!";
        document.getElementById("prog-step-elapsed").textContent = "";
        document.getElementById("prog-step-duration").textContent = "";
        document.getElementById("prog-step-bar").style.width = "100%";
        document.getElementById("prog-step-bar").classList.replace("bg-sky-500", "bg-green-500");
        document.getElementById("prog-next-wrap").classList.add("hidden");
        document.getElementById("prog-overall-bar").style.width = "100%";
        document.getElementById("prog-elapsed-time").textContent = _fmtProgTime(_progTotalSeconds(activeProgram));
        document.getElementById("prog-total-time").textContent = _fmtProgTime(_progTotalSeconds(activeProgram));
        document.getElementById("prog-override-badge").classList.add("hidden");
        return;
    }

    if (!programRunning) return;

    const step = activeProgram.steps[programStepIndex];
    const totalSec = _progTotalSeconds(activeProgram);
    const stepPct = step.duration > 0 ? Math.min(100, (programStepElapsed / step.duration) * 100) : 0;
    const overallPct = totalSec > 0 ? Math.min(100, (programTotalElapsed / totalSec) * 100) : 0;
    const nextStep = activeProgram.steps[programStepIndex + 1];

    const chainedProg = pendingProgramId ? WORKOUT_PROGRAMS.find((p) => p.id === pendingProgramId) : null;
    const progLabel = chainedProg ? `${activeProgram.name} → ${chainedProg.name}` : activeProgram.name;
    document.getElementById("prog-name").textContent = progLabel;
    document.getElementById("prog-step-name").textContent = step.name + " · " + step.speed.toFixed(1) + " km/h";
    document.getElementById("prog-step-elapsed").textContent = _fmtProgTime(programStepElapsed);
    document.getElementById("prog-step-duration").textContent = _fmtProgTime(step.duration);
    document.getElementById("prog-step-bar").style.width = stepPct + "%";
    document.getElementById("prog-step-bar").classList.replace("bg-green-500", "bg-sky-500");

    const nextWrap = document.getElementById("prog-next-wrap");
    if (nextStep) {
        nextWrap.classList.remove("hidden");
        document.getElementById("prog-next-name").textContent = nextStep.name;
        document.getElementById("prog-next-speed").textContent = nextStep.speed.toFixed(1);
    } else {
        nextWrap.classList.add("hidden");
    }

    document.getElementById("prog-overall-bar").style.width = overallPct + "%";
    document.getElementById("prog-elapsed-time").textContent = _fmtProgTime(programTotalElapsed);
    document.getElementById("prog-total-time").textContent = _fmtProgTime(totalSec);
    document.getElementById("prog-override-badge").classList.toggle("hidden", !programUserOverride);
}

// Keep legacy alias so existing callers work without mass-rename
function renderActiveProgramBanner() { renderProgramSection(); }

// --- Goals ---
let goalActiveDays = 5;
let goalDistanceKm = 5;
let goalTimeSeconds = 1800;
let goalWeekDistanceKm = 0;
let goalWeekTimeSeconds = 0;
let goalDaySessions = 1;
let goalWeekSessions = 5;
let goalMonthSessions = 0;
let goalMonthDistanceKm = 0;
let goalMonthTimeSeconds = 0;
let goalThreeMonthDistanceKm = 0;
let goalThreeMonthTimeSeconds = 0;
let goalSixMonthDistanceKm = 0;
let goalSixMonthTimeSeconds = 0;
let goalYearDistanceKm = 0;
let goalYearTimeSeconds = 0;
// Auto-calculate flags — true = period goals are driven by daily × active days
let autoWeek = true,
    autoMonth = true,
    autoThreeMonth = true,
    autoSixMonth = true,
    autoYear = true;

// --- History save baseline (to avoid double-counting on multiple stops) ---
let lastHistoryDistance = 0;
let lastHistoryCalories = 0;
let lastHistorySpeedSum = 0;
let lastHistorySpeedSamples = 0;
let lastHistoryTimeSeconds = 0;
let lastHistoryPauseCount = 0;
let lastHistorySteps = 0;

// --- Chart Instances ---
const wpCharts = {
    distance: null,
    calories: null,
    speedHist: null,
    liveSpeed: null,
};

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
        dot.classList.remove(
            "bg-red-500",
            "bg-green-500",
            "bg-yellow-400",
            "bg-orange-400",
        );
        dot.classList.add(dotClass);
    }
}

// ============================================================
// FTMS Helpers
// ============================================================

function ftmsSpeedBytes(kmh) {
    const val = Math.round(kmh * 100); // 0.01 km/h units
    return [0x02, val & 0xff, (val >> 8) & 0xff]; // opcode 0x02 = Set Target Speed (FitShow FS-BT-D2)
}

async function ftmsCmd(bytes) {
    if (!cFTMSControl) {
        console.warn("FTMS not connected");
        abortStartupIndicator("Not connected");
        return;
    }
    try {
        await cFTMSControl.writeValue(new Uint8Array(bytes));
    } catch (e) {
        console.error("FTMS write failed", e);
        abortStartupIndicator("Write failed");
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

    const speed = value.getUint16(2, true) / 100;
    const distanceM =
        value.getUint8(4) |
        (value.getUint8(5) << 8) |
        (value.getUint8(6) << 16);
    const distance = distanceM / 1000;
    const calories = value.getUint16(11, true);
    const elapsed = value.getUint16(17, true);

    // Countdown display during belt ramp-up (packets arrive ~1s apart, pad beeps 3x before belt moves)
    if (
        isRunning &&
        !startupBeltConfirmed &&
        !document
            .getElementById("startupIndicator")
            .classList.contains("hidden")
    ) {
        if (speed <= 0) {
            startupBeltPackets++;
            const labels = ["Ready…", "Get set…", "Go!"];
            const label =
                labels[Math.min(startupBeltPackets - 1, labels.length - 1)];
            setStartupStep("step-belt", "active", label);
        }
    }

    // Only accumulate stats when belt is actually running at speed
    if (!isRunning || speed <= 0) return;

    // Confirm belt is physically moving on first packet with speed > 0
    if (!startupBeltConfirmed) {
        startupBeltConfirmed = true;
        setStartupStep("step-belt", "done", "Belt running");
        if (!startupHasSpeedStep) dismissStartupIndicator();
    }

    // Apply pending resume speed on first notification after start/resume
    if (pendingResumeSpeed > 0) {
        const targetSpeed = pendingResumeSpeed;
        pendingResumeSpeed = 0;
        const chainId = pendingProgramId;
        pendingProgramId = null;
        setStartupStep(
            "step-speed",
            "active",
            `Setting speed to ${targetSpeed.toFixed(1)} km/h…`,
        );
        setTimeout(() => {
            ftmsCmd(ftmsSpeedBytes(targetSpeed));
            setStartupStep(
                "step-speed",
                "done",
                `Speed set to ${targetSpeed.toFixed(1)} km/h`,
            );
            dismissStartupIndicator();
            // If a program was queued for auto-start, kick it off now
            if (chainId && activeProgram && activeProgram.id === chainId) {
                startProgram();
            }
        }, BELT_SPEED_SET_DELAY_MS);
    }

    currentSpeed = speed;
    if (currentSpeed > 0 && currentSpeed <= MAX_REALISTIC_SPEED) {
        if (currentSpeed > maxSpeed) maxSpeed = currentSpeed;
        if (currentSpeed > deltaMaxSpeed) deltaMaxSpeed = currentSpeed;
        speedSum += currentSpeed;
        speedSamples++;
    }

    currentDistance = distance;
    currentCalories = calories;
    currentTimeSeconds = elapsed;

    cumDistance += Math.max(0, currentDistance - prevDistance);
    cumCalories += Math.max(0, currentCalories - prevCalories);
    cumTimeSeconds += Math.max(0, currentTimeSeconds - prevTimeSeconds);
    // Dead-reckoning snap: anchor the integrated value to the pad's authoritative
    // distance on every packet, so steps stay smooth between packets but never drift.
    cumEstimatedDistance = cumDistance;

    prevDistance = currentDistance;
    prevCalories = currentCalories;
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
        isPaused = false;
        if (!sessionStartTime) sessionStartTime = new Date().toISOString();
        setStatus("Running", "bg-green-500");
        requestWakeLock();
        setStartupStep("step-belt", "active", "Belt starting…");
        updateProgramStartBtnState();
    } else if (
        opcode === 0x02 &&
        value.byteLength >= 2 &&
        value.getUint8(1) === 0x01
    ) {
        // Belt fully stopped — pad resets its internal counters to 0 at this point
        isRunning = false;
        currentSpeed = 0;
        estimatedDistanceKm = 0;
        lastDistanceUpdate = Date.now();
        // Reset prev values so next session's first packet doesn't produce a negative delta
        prevDistance = 0;
        prevCalories = 0;
        prevTimeSeconds = 0;
        localStorage.setItem("wp_isPaused", isPaused ? "1" : "0");
        localStorage.setItem("wp_pauseStartTimestamp", "");
        if (isPaused) {
            setStatus("Paused", "bg-yellow-400");
        } else {
            isPaused = false;
            setStatus("Stopped", "bg-orange-400");
            releaseWakeLock();
            if (programRunning) cancelProgram();
            updateProgramStartBtnState();
            updateCurrentStats();
            exportStats().then(() => {
                clearCurrentStats();
                resetSessionStateAfterStop();
            });
            return;
        }
        updateCurrentStats();
    }
}

// 0x2AD9 Control Point indications — log responses
function handleFTMSIndication(event) {
    const value = event.target.value;
    const bytes = [];
    for (let i = 0; i < value.byteLength; i++) bytes.push(value.getUint8(i));
    const hex = bytes
        .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
        .join(" ");
    if (bytes[0] === 0x80) {
        const results = {
            0x01: "Success",
            0x02: "Op Code Not Supported",
            0x03: "Invalid Parameter",
            0x04: "Operation Failed",
            0x05: "Control Not Permitted",
        };
        const ops = {
            0x01: "Request Control",
            0x02: "Set Speed",
            0x07: "Start/Resume",
            0x08: "Stop/Pause",
        };
        const op = ops[bytes[1]] || "0x" + bytes[1].toString(16);
        const res = results[bytes[2]] || "0x" + bytes[2].toString(16);
        console.log("[FTMS indication]", hex, "→", op + ":", res);
        if (bytes[1] === 0x07) {
            if (bytes[2] === 0x01) {
                setStartupStep("step-ack", "done", "Pad acknowledged");
                setStartupStep("step-belt", "active", "Belt starting…");
            } else {
                setStartupStep("step-ack", "error", `Start failed: ${res}`);
            }
        }
    } else {
        console.log("[FTMS indication]", hex);
    }
}

// ============================================================
// BLE Init / Disconnect
// ============================================================

async function connectToDevice() {
    console.log("[BLE] connectToDevice: gatt.connect →", device.id, device.name);
    server = await device.gatt.connect();
    console.log("[BLE] GATT connected, discovering services…");
    ftmsService = await server.getPrimaryService(FTMS_SERVICE);
    cFTMSControl = await ftmsService.getCharacteristic(FTMS_CONTROL);
    cFTMSTreadmill = await ftmsService.getCharacteristic(FTMS_TREADMILL);
    cFTMSStatus = await ftmsService.getCharacteristic(FTMS_STATUS);
    console.log("[BLE] Characteristics obtained, starting notifications…");

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
    reconnectAttempts = 0;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    console.log("[BLE] Connected ✓", device.id, device.name);
    setStatus("Connected", "bg-green-500");
    // Request FTMS control after a short delay to let the pad settle
    setTimeout(() => ftmsCmd([0x01]), 600);
    // If a program was running, re-send current step speed after reconnect settle time
    if (programRunning && activeProgram) {
        const step = activeProgram.steps[programStepIndex];
        if (step) setTimeout(() => ftmsCmd(ftmsSpeedBytes(step.speed)), 800);
    }
}

async function initBLE() {
    console.log("[BLE] initBLE called, device=", device?.id ?? "null");
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempts = 0;
    try {
        setStatus("Connecting…", "bg-yellow-400");
        if (!device) {
            console.log("[BLE] Showing requestDevice picker");
            device = await navigator.bluetooth.requestDevice({
                filters: [{ namePrefix: "FS-" }],
                optionalServices: [FTMS_SERVICE],
            });
            console.log("[BLE] User selected:", device.id, device.name);
            device.addEventListener("gattserverdisconnected", onDisconnected);
        }
        await connectToDevice();
    } catch (e) {
        if (e.name === "NotFoundError") {
            console.log("[BLE] User cancelled picker");
            setStatus("Disconnected", "bg-red-500");
        } else {
            console.error("[BLE] initBLE failed:", e);
            setStatus("Connection failed", "bg-red-500");
        }
    }
}

const RECONNECT_DELAYS = [2000, 3000, 5000, 10000, 15000, 30000];
const MAX_RECONNECT_ATTEMPTS = 10;

function scheduleReconnect() {
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.log("[BLE] Max reconnect attempts reached, giving up");
        setStatus("Connection lost", "bg-red-500");
        reconnectAttempts = 0;
        return;
    }
    const delay = RECONNECT_DELAYS[Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1)];
    reconnectAttempts++;
    console.log(`[BLE] scheduleReconnect: attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} in ${delay}ms`);
    reconnectTimer = setTimeout(async () => {
        if (isConnected || !device) return;
        try {
            setStatus("Reconnecting…", "bg-yellow-400");
            await connectToDevice();
        } catch (e) {
            console.warn("[BLE] Reconnect attempt failed:", e.message);
            scheduleReconnect();
        }
    }, delay);
}

function onDisconnected() {
    console.log("[BLE] onDisconnected fired");
    isConnected = false;
    ftmsService = null;
    cFTMSControl = null;
    cFTMSTreadmill = null;
    cFTMSStatus = null;
    releaseWakeLock();
    abortStartupIndicator("Disconnected");
    setStatus("Reconnecting…", "bg-yellow-400");
    scheduleReconnect();
}


// ============================================================
// Calculations
// ============================================================

function estimatePower(speed, weight) {
    return Math.round((1.5 * speed * weight) / 3.6);
}

function cmToFtIn(cm) {
    const totalInches = cm / 2.54;
    const ft = Math.floor(totalInches / 12);
    const inches = Math.round(totalInches % 12);
    return { ft, inches };
}

function ftInToCm(ft, inches) {
    return ft * 30.48 + inches * 2.54;
}

function getStrideLength(heightCm) {
    if (!heightCm || heightCm <= 0) return 0.762;
    return (0.415 * heightCm) / 100;
}

function estimateSteps(distanceKm, heightCm) {
    const stride = getStrideLength(heightCm);
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

function clearCurrentStats() {
    document.getElementById("currentSpeed").textContent = "0.0";
    document.getElementById("currentDistance").textContent = "0.00";
    document.getElementById("currentCalories").textContent = "0";
    document.getElementById("currentTime").textContent = "00:00:00";
    document.getElementById("currentMaxSpeed").textContent = "0.0";
    document.getElementById("currentAvgSpeed").textContent = "0.00";
    document.getElementById("currentSteps").textContent = "0";
    document.getElementById("currentPauses").textContent = "0";
    currentSteps = 0;
    cumSteps = 0;
    estimatedDistanceKm = 0;
    cumEstimatedDistance = 0;
    sessionStartTime = null;
    document.getElementById("currentPace").textContent = "—";
    document.getElementById("currentAvgPace").textContent = "—";
    const mobileSpeedEl = document.getElementById("mobileCurrentSpeed");
    if (mobileSpeedEl) mobileSpeedEl.textContent = "0.0";
}

// Called after a clean stop has been exported + persisted to history.
// Zeroes cumulative session state so the next workout (whether launched via
// startBtn or the program picker) starts from a clean slate.
function resetSessionStateAfterStop() {
    cumDistance = 0;
    cumCalories = 0;
    cumTimeSeconds = 0;
    cumPower = 0;
    cumTotalPower = 0;
    cumSteps = 0;
    cumEstimatedDistance = 0;
    maxSpeed = 0;
    speedSum = 0;
    speedSamples = 0;
    deltaMaxSpeed = 0;
    pauseCount = 0;
    totalPauseTime = 0;
    pauseStartTimestamp = null;
    isPaused = false;
    lastHistoryDistance = 0;
    lastHistoryCalories = 0;
    lastHistorySpeedSum = 0;
    lastHistorySpeedSamples = 0;
    lastHistoryTimeSeconds = 0;
    lastHistoryPauseCount = 0;
    lastHistorySteps = 0;
    liveSpeedData = [];
    liveSpeedLabels = [];
    liveSecondCount = 0;
    sessionStartTime = null;
    autoSaveCumulativeStats();
    localStorage.removeItem("wp_session_backup");
    updateRecoverBtn();
    updateCumulativeStats();
}

function updateCurrentStats() {
    document.getElementById("currentSpeed").textContent =
        currentSpeed.toFixed(1);
    document.getElementById("currentDistance").textContent =
        cumDistance.toFixed(2);
    currentSteps = estimateSteps(cumEstimatedDistance, userHeightCm);
    document.getElementById("currentCalories").textContent =
        Math.round(cumCalories);
    document.getElementById("currentTime").textContent = new Date(
        cumTimeSeconds * 1000,
    )
        .toISOString()
        .slice(11, 19);
    document.getElementById("currentMaxSpeed").textContent =
        maxSpeed.toFixed(2);
    let avgSpeed = speedSamples > 0 ? speedSum / speedSamples : 0;
    if (maxSpeed > 0 && avgSpeed > maxSpeed) avgSpeed = maxSpeed;
    document.getElementById("currentAvgSpeed").textContent =
        avgSpeed.toFixed(2);
    document.getElementById("currentSteps").textContent = currentSteps;
    document.getElementById("currentPauses").textContent = pauseCount;
    const pace = currentSpeed > 0 ? 60 / currentSpeed : 0;
    const paceStr =
        pace > 0
            ? `${Math.floor(pace)}:${String(Math.round((pace % 1) * 60)).padStart(2, "0")}`
            : "—";
    document.getElementById("currentPace").textContent = paceStr;
    const avgPaceStr =
        avgSpeed > 0
            ? (() => {
                  const p = 60 / avgSpeed;
                  return `${Math.floor(p)}:${String(Math.round((p % 1) * 60)).padStart(2, "0")}`;
              })()
            : "—";
    document.getElementById("currentAvgPace").textContent = avgPaceStr;
    const mobileSpeedEl = document.getElementById("mobileCurrentSpeed");
    if (mobileSpeedEl) mobileSpeedEl.textContent = currentSpeed.toFixed(1);
}

function updateCumulativeStats() {
    document.getElementById("cumDistance").textContent = cumDistance.toFixed(2);
    cumSteps = estimateSteps(cumEstimatedDistance, userHeightCm);
    document.getElementById("cumCalories").textContent =
        Math.round(cumCalories);
    document.getElementById("cumTime").textContent = new Date(
        cumTimeSeconds * 1000,
    )
        .toISOString()
        .slice(11, 19);
    document.getElementById("cumPauseCount").textContent = pauseCount;
    autoSaveCumulativeStats();
    updateGoalProgress();
    updateTodayTotals();
    updatePeriodStats();
    updateAllTimeExtras();
}

// ============================================================
// Persistence
// ============================================================

function loadSessions() {
    try {
        return JSON.parse(localStorage.getItem("wp_sessions") || "[]");
    } catch (e) {
        console.warn("Sessions corrupted, resetting", e);
        return [];
    }
}

function loadHistory() {
    const sessions = loadSessions();
    const history = {};
    sessions.forEach((s) => {
        const d = s.date;
        if (!history[d]) {
            history[d] = {
                distance: 0,
                calories: 0,
                speedSum: 0,
                speedSamples: 0,
                timeSeconds: 0,
                sessions: 0,
                pauses: 0,
                steps: 0,
                maxSpeed: 0,
            };
        }
        history[d].distance += s.distance || 0;
        history[d].calories += s.calories || 0;
        history[d].speedSum += s.speedSum || 0;
        history[d].speedSamples += s.speedSamples || 0;
        history[d].timeSeconds += s.timeSeconds || 0;
        history[d].sessions += 1;
        history[d].pauses += s.pauses || 0;
        history[d].steps += s.steps || 0;
        const rowMax = s.maxSpeed
            || (s.speedSamples > 0 ? s.speedSum / s.speedSamples : 0);
        history[d].maxSpeed = Math.max(history[d].maxSpeed, rowMax);
        history[d].lastUpdated = s.savedAt;
    });
    return history;
}

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
    localStorage.setItem("wp_lastHistorySteps", lastHistorySteps);
    localStorage.setItem("wp_cumEstimatedDistance", cumEstimatedDistance);
    localStorage.setItem("wp_maxSpeed", maxSpeed);
    localStorage.setItem("wp_speedSum", speedSum);
    localStorage.setItem("wp_speedSamples", speedSamples);
    localStorage.setItem("wp_deltaMaxSpeed", deltaMaxSpeed);
}

function saveSessionBackup() {
    const backup = {
        cumDistance,
        cumCalories,
        cumTimeSeconds,
        pauseCount,
        totalPauseTime,
        cumTotalPower,
        maxSpeed,
        speedSum,
        speedSamples,
        cumEstimatedDistance,
        savedAt: new Date().toLocaleString(),
    };
    localStorage.setItem("wp_session_backup", JSON.stringify(backup));
    updateRecoverBtn();
}

// ── Program state persistence ────────────────────────────────────────────────

function saveProgramState() {
    if (!programRunning || !activeProgram) return;
    localStorage.setItem("wp_program_state", JSON.stringify({
        programId:           activeProgram.id,
        programStepIndex,
        programStepElapsed,
        programTotalElapsed,
        programUserOverride,
        savedAt:             Date.now(),
    }));
}

function clearProgramState() {
    localStorage.removeItem("wp_program_state");
}

function loadProgramState() {
    try {
        const raw = localStorage.getItem("wp_program_state");
        if (!raw) return null;
        const ps = JSON.parse(raw);
        // Discard if older than 1 hour
        if (!ps || Date.now() - ps.savedAt > 3_600_000) {
            clearProgramState();
            return null;
        }
        // Verify the program still exists
        if (!WORKOUT_PROGRAMS.find((p) => p.id === ps.programId)) {
            clearProgramState();
            return null;
        }
        return ps;
    } catch (e) {
        clearProgramState();
        return null;
    }
}

function offerProgramResume(ps) {
    const prog = WORKOUT_PROGRAMS.find((p) => p.id === ps.programId);
    if (!prog) return;
    const totalSteps = prog.steps.length;
    const elapsed = _fmtProgTime(ps.programTotalElapsed);
    // Pre-load program into state (not running yet)
    activeProgram       = prog;
    programStepIndex    = ps.programStepIndex;
    programStepElapsed  = ps.programStepElapsed;
    programTotalElapsed = ps.programTotalElapsed;
    programUserOverride = ps.programUserOverride || false;
    programRunning      = false;
    programResuming     = true;
    programCompletedFlag = false;
    localStorage.setItem("wp_last_program_id", prog.id);
    // Show the resume notification inline in the session card
    const banner = document.createElement("div");
    banner.id = "prog-resume-banner";
    banner.className = "mt-1 p-2 rounded-lg bg-sky-50 dark:bg-sky-900/30 border border-sky-300 dark:border-sky-700 text-xs flex items-center justify-between gap-2";
    banner.innerHTML = `
        <span class="text-sky-700 dark:text-sky-300">
            <i class="fas fa-history mr-1"></i>
            <strong>${prog.name}</strong> interrupted — step ${ps.programStepIndex + 1}/${totalSteps}, ${elapsed} elapsed
        </span>
        <div class="flex gap-1.5 shrink-0">
            <button id="prog-resume-confirm" class="bg-sky-500 hover:bg-sky-600 text-white rounded px-2 py-0.5 font-semibold">Resume</button>
            <button id="prog-resume-dismiss" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-1">✕</button>
        </div>`;
    const section = document.getElementById("program-section");
    if (section) section.insertAdjacentElement("afterend", banner);

    document.getElementById("prog-resume-confirm").addEventListener("click", () => {
        banner.remove();
        clearProgramState();
        renderProgramSection();
        renderProgramPicker();
    });
    document.getElementById("prog-resume-dismiss").addEventListener("click", () => {
        banner.remove();
        programResuming = false;
        activeProgram = null;
        programStepIndex = 0;
        programStepElapsed = 0;
        programTotalElapsed = 0;
        clearProgramState();
        renderProgramSection();
        renderProgramPicker();
    });
    renderProgramSection();
    renderProgramPicker();
}

function syncRecoveryRow() {
    const row = document.getElementById("recoveryBtnRow");
    const anyVisible =
        !document
            .getElementById("recoverExportBtn")
            .classList.contains("hidden") ||
        !document
            .getElementById("recoverSessionBtn")
            .classList.contains("hidden");
    if (anyVisible) {
        row.classList.remove("hidden");
        row.classList.add("flex");
    } else {
        row.classList.add("hidden");
        row.classList.remove("flex");
    }
}

function updateRecoverBtn() {
    const backup = JSON.parse(
        localStorage.getItem("wp_session_backup") || "null",
    );
    const btn = document.getElementById("recoverSessionBtn");
    const today = new Date().toLocaleDateString();
    const isToday =
        backup && backup.savedAt && backup.savedAt.startsWith(today);
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
    cumDistance += snapshot.cumDistance;
    cumCalories += snapshot.cumCalories;
    cumTimeSeconds += snapshot.cumTimeSeconds;
    pauseCount += snapshot.pauseCount;
    totalPauseTime += snapshot.totalPauseTime;
    cumTotalPower += snapshot.cumTotalPower;
    cumEstimatedDistance += snapshot.cumEstimatedDistance;
    if (snapshot.maxSpeed > maxSpeed) maxSpeed = snapshot.maxSpeed;
    if (snapshot.maxSpeed > deltaMaxSpeed) deltaMaxSpeed = snapshot.maxSpeed;
    speedSum += snapshot.speedSum;
    speedSamples += snapshot.speedSamples;
    autoSaveCumulativeStats();
    updateCumulativeStats();
}

function recoverFromSnapshot(snapshot) {
    cumDistance = snapshot.cumDistance;
    cumCalories = snapshot.cumCalories;
    cumTimeSeconds = snapshot.cumTimeSeconds;
    pauseCount = snapshot.pauseCount;
    totalPauseTime = snapshot.totalPauseTime;
    cumTotalPower = snapshot.cumTotalPower;
    cumEstimatedDistance = snapshot.cumEstimatedDistance;
    maxSpeed = snapshot.maxSpeed;
    deltaMaxSpeed = snapshot.maxSpeed;
    speedSum = snapshot.speedSum;
    speedSamples = snapshot.speedSamples;
    autoSaveCumulativeStats();
    updateCumulativeStats();
}

function recoverSession() {
    const backup = JSON.parse(
        localStorage.getItem("wp_session_backup") || "null",
    );
    if (!backup) return;
    mergeFromSnapshot(backup);
    localStorage.removeItem("wp_session_backup");
    updateRecoverBtn();
}

function loadCumulativeStats() {
    cumDistance = parseFloat(localStorage.getItem("wp_cumDistance")) || 0;
    cumCalories = parseFloat(localStorage.getItem("wp_cumCalories")) || 0;
    cumTimeSeconds = parseInt(localStorage.getItem("wp_cumTimeSeconds")) || 0;
    pauseCount = parseInt(localStorage.getItem("wp_cumPauseCount")) || 0;
    totalPauseTime =
        parseFloat(localStorage.getItem("wp_cumTotalPauseTime")) || 0;
    isPaused = localStorage.getItem("wp_isPaused") === "1";
    const savedTimestamp = localStorage.getItem("wp_pauseStartTimestamp");
    pauseStartTimestamp = savedTimestamp ? parseInt(savedTimestamp) : null;
    if (isPaused && pauseStartTimestamp) {
        totalPauseTime += (Date.now() - pauseStartTimestamp) / 1000;
        pauseStartTimestamp = Date.now();
    }
    lastHistoryDistance =
        parseFloat(localStorage.getItem("wp_lastHistoryDistance")) || 0;
    lastHistoryCalories =
        parseFloat(localStorage.getItem("wp_lastHistoryCalories")) || 0;
    lastHistorySpeedSum =
        parseFloat(localStorage.getItem("wp_lastHistorySpeedSum")) || 0;
    lastHistorySpeedSamples =
        parseInt(localStorage.getItem("wp_lastHistorySpeedSamples")) || 0;
    lastHistoryTimeSeconds =
        parseInt(localStorage.getItem("wp_lastHistoryTimeSeconds")) || 0;
    lastHistoryPauseCount =
        parseInt(localStorage.getItem("wp_lastHistoryPauseCount")) || 0;
    lastHistorySteps =
        parseInt(localStorage.getItem("wp_lastHistorySteps")) || 0;
    cumEstimatedDistance =
        parseFloat(localStorage.getItem("wp_cumEstimatedDistance")) || 0;
    maxSpeed = parseFloat(localStorage.getItem("wp_maxSpeed")) || 0;
    speedSum = parseFloat(localStorage.getItem("wp_speedSum")) || 0;
    speedSamples = parseInt(localStorage.getItem("wp_speedSamples")) || 0;
    deltaMaxSpeed = parseFloat(localStorage.getItem("wp_deltaMaxSpeed")) || 0;
}

const DEFAULT_SPEED_PRESETS = [3.5, 4.5, 5.5, 6.5, 7.5, 8.5];

function applySpeedPresets(presets) {
    presets.forEach((speed, i) => {
        const label = speed % 1 === 0 ? speed.toFixed(1) : speed.toString();
        const desktop = document.getElementById(`presetBtn${i}`);
        const mobile = document.getElementById(`presetBtn${i}M`);
        if (desktop) {
            desktop.textContent = label;
            desktop.onclick = () => {
                haptic(30);
                startAndSetSpeed(speed);
            };
        }
        if (mobile) {
            mobile.textContent = label;
            mobile.onclick = () => {
                haptic(30);
                startAndSetSpeed(speed);
            };
        }
    });
}

function loadDefaults() {
    const savedPresets =
        JSON.parse(localStorage.getItem("wp_speed_presets") || "null") ||
        DEFAULT_SPEED_PRESETS;
    savedPresets.forEach((v, i) => {
        const el = document.getElementById(`speedPreset${i}`);
        if (el) el.value = v;
    });
    applySpeedPresets(savedPresets);
    const w = localStorage.getItem("wp_weight");
    const storedCm = localStorage.getItem("wp_height_cm");
    const a = localStorage.getItem("wp_age");
    if (!w || storedCm == null || !a) {
        showOnboardingModal();
        return;
    }
    userWeight = parseFloat(w);
    userHeightCm = parseFloat(storedCm);
    userHeightUnit = localStorage.getItem("wp_height_unit") || "ftin";
    userAge = parseInt(a);
    document.getElementById("weightInput").value = userWeight;
    applyHeightToSettingsInputs();
    document.getElementById("ageInput").value = userAge;
    webhookUrl = localStorage.getItem("wp_webhook_url") || "";
    webhookSecret = localStorage.getItem("wp_webhook_secret") || "";
    document.getElementById("webhookUrlInput").value = webhookUrl;
    document.getElementById("webhookSecretInput").value = webhookSecret;
    const wud = parseInt(localStorage.getItem("wp_warmup_duration_mins"), 10);
    if (!isNaN(wud) && wud >= 5 && wud <= 30) warmupDurationMins = wud;
    document.getElementById("warmupDurationInput").value = warmupDurationMins;
}

function setPillActive(activeId, inactiveId) {
    for (const [id, isActive] of [[activeId, true], [inactiveId, false]]) {
        const el = document.getElementById(id);
        if (!el) continue;
        el.classList.toggle("bg-sporty", isActive);
        el.classList.toggle("text-white", isActive);
        el.classList.toggle("bg-gray-100", !isActive);
        el.classList.toggle("dark:bg-gray-800", !isActive);
        el.classList.toggle("text-gray-500", !isActive);
        el.classList.toggle("dark:text-gray-400", !isActive);
    }
}

function applyHeightToSettingsInputs() {
    const isFtIn = userHeightUnit === "ftin";
    const ftInDiv = document.getElementById("heightFtInInputs");
    const cmDiv = document.getElementById("heightCmInputs");
    if (ftInDiv) {
        ftInDiv.classList.toggle("hidden", !isFtIn);
        ftInDiv.classList.toggle("flex", isFtIn);
    }
    if (cmDiv) {
        cmDiv.classList.toggle("hidden", isFtIn);
        cmDiv.classList.toggle("flex", !isFtIn);
    }
    setPillActive(isFtIn ? "heightUnitFtIn" : "heightUnitCm",
                  isFtIn ? "heightUnitCm"   : "heightUnitFtIn");
    if (isFtIn) {
        const { ft, inches } = cmToFtIn(userHeightCm);
        const ftEl = document.getElementById("heightFtInput");
        const inEl = document.getElementById("heightInInput");
        if (ftEl) ftEl.value = ft;
        if (inEl) inEl.value = inches;
    } else {
        const cmEl = document.getElementById("heightCmInput");
        if (cmEl) cmEl.value = Math.round(userHeightCm);
    }
}

function applyHeightToOnboardingInputs() {
    const isFtIn = userHeightUnit === "ftin";
    const ftInDiv = document.getElementById("onboardingHeightFtInInputs");
    const cmDiv = document.getElementById("onboardingHeightCmInputs");
    if (ftInDiv) {
        ftInDiv.classList.toggle("hidden", !isFtIn);
        ftInDiv.classList.toggle("flex", isFtIn);
    }
    if (cmDiv) {
        cmDiv.classList.toggle("hidden", isFtIn);
        cmDiv.classList.toggle("flex", !isFtIn);
    }
    setPillActive(isFtIn ? "onboardingHeightUnitFtIn" : "onboardingHeightUnitCm",
                  isFtIn ? "onboardingHeightUnitCm"   : "onboardingHeightUnitFtIn");
}

function saveDefaults() {
    userWeight =
        parseFloat(document.getElementById("weightInput").value) || userWeight;
    if (userHeightUnit === "ftin") {
        const ft = parseInt(document.getElementById("heightFtInput").value, 10);
        const inches = parseInt(document.getElementById("heightInInput").value, 10);
        if (!isNaN(ft) && !isNaN(inches)) userHeightCm = ftInToCm(ft, inches);
    } else {
        const cm = parseFloat(document.getElementById("heightCmInput").value);
        if (!isNaN(cm) && cm > 0) userHeightCm = cm;
    }
    userAge = parseInt(document.getElementById("ageInput").value) || userAge;
    localStorage.setItem("wp_weight", userWeight);
    localStorage.setItem("wp_height_cm", userHeightCm);
    localStorage.setItem("wp_height_unit", userHeightUnit);
    localStorage.setItem("wp_age", userAge);
    webhookUrl = document.getElementById("webhookUrlInput").value.trim();
    webhookSecret = document.getElementById("webhookSecretInput").value.trim();
    localStorage.setItem("wp_webhook_url", webhookUrl);
    localStorage.setItem("wp_webhook_secret", webhookSecret);
    const wudInput = parseInt(document.getElementById("warmupDurationInput").value, 10);
    if (!isNaN(wudInput) && wudInput >= 5 && wudInput <= 30) {
        warmupDurationMins = wudInput;
        localStorage.setItem("wp_warmup_duration_mins", warmupDurationMins);
    }
    const presets = DEFAULT_SPEED_PRESETS.map((def, i) => {
        const el = document.getElementById(`speedPreset${i}`);
        const v = el ? parseFloat(el.value) : def;
        return Math.min(12, Math.max(1, isNaN(v) ? def : v));
    });
    localStorage.setItem("wp_speed_presets", JSON.stringify(presets));
    applySpeedPresets(presets);
}

// ============================================================
// Export
// ============================================================

function saveExportSnapshot() {
    const snapshot = {
        cumDistance,
        cumCalories,
        cumTimeSeconds,
        pauseCount,
        totalPauseTime,
        cumTotalPower,
        maxSpeed,
        speedSum,
        speedSamples,
        cumEstimatedDistance,
        savedAt: new Date().toLocaleString(),
    };
    localStorage.setItem("wp_export_snapshot", JSON.stringify(snapshot));
    updateExportRecoverBtn();
}

function updateExportRecoverBtn() {
    const snapshot = JSON.parse(
        localStorage.getItem("wp_export_snapshot") || "null",
    );
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
    const snapshot = JSON.parse(
        localStorage.getItem("wp_export_snapshot") || "null",
    );
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
    const avgSpeed =
        speedSamples > 0 ? (speedSum / speedSamples).toFixed(2) : "0.00";
    const avgPause =
        pauseCount > 0 ? (totalPauseTime / pauseCount).toFixed(0) : "0";
    const rows = [
        [
            "Type",
            "Speed",
            "Max Speed",
            "Avg Speed",
            "Distance",
            "Calories",
            "Time",
            "Pauses",
            "Total Pause Time (s)",
            "Avg Pause Time (s)",
        ],
        [
            "Current",
            currentSpeed,
            maxSpeed,
            avgSpeed,
            cumDistance,
            Math.round(cumCalories),
            new Date(cumTimeSeconds * 1000).toISOString().slice(11, 19),
            pauseCount,
            totalPauseTime.toFixed(0),
            avgPause,
        ],
        [
            "Cumulative",
            currentSpeed,
            maxSpeed,
            avgSpeed,
            cumDistance,
            Math.round(cumCalories),
            new Date(cumTimeSeconds * 1000).toISOString().slice(11, 19),
            pauseCount,
            totalPauseTime.toFixed(0),
            avgPause,
        ],
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const file = new File([blob], "walking_pad_stats.csv", {
        type: "text/csv",
    });
    if (!webhookUrl) {
        if (
            navigator.share &&
            navigator.canShare &&
            navigator.canShare({ files: [file] })
        ) {
            try {
                await navigator.share({
                    title: "Walking Pad Stats",
                    files: [file],
                });
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
                distance: cumDistance,
                calories: Math.round(cumCalories),
                timeSeconds: cumTimeSeconds,
                maxSpeed,
                avgSpeed: speedSamples > 0 ? speedSum / speedSamples : 0,
                pace:
                    speedSamples > 0 && speedSum / speedSamples > 0
                        ? 60 / (speedSum / speedSamples)
                        : 0,
                steps: cumSteps,
                pauseCount,
                pauseTimeSeconds: totalPauseTime,
                sessionStart: sessionStartTime || null,
                programId: activeProgram?.id ?? null,
                programName: activeProgram?.name ?? null,
                programCompleted: programCompletedFlag,
            },
            cumulative: {
                distance: cumDistance,
                calories: Math.round(cumCalories),
                timeSeconds: cumTimeSeconds,
                maxSpeed,
                avgSpeed: speedSamples > 0 ? speedSum / speedSamples : 0,
                pace:
                    speedSamples > 0 && speedSum / speedSamples > 0
                        ? 60 / (speedSum / speedSamples)
                        : 0,
                steps: cumSteps,
                pauseCount,
                pauseTimeSeconds: totalPauseTime,
            },
            sessions: loadSessions(),
        };
        fetch(webhookUrl, {
            method: "POST",
            mode: "no-cors",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify(payload),
        }).catch((e) => console.warn("Webhook failed:", e));
    }
    renderCharts();
    renderSessionHistory();
    updateRecoverBtn();
}

async function copyForSheets() {
    const sessions = loadSessions()
        .slice()
        .sort((a, b) => a.savedAt.localeCompare(b.savedAt));
    const fmtTime = (sec) => new Date(sec * 1000).toISOString().slice(11, 19);
    const fmtPace = (avg) => {
        if (avg <= 0) return "—";
        const p = 60 / avg;
        return `${Math.floor(p)}:${String(Math.round((p % 1) * 60)).padStart(2, "0")}`;
    };
    const header = [
        "Date",
        "Week",
        "Month",
        "Year",
        "Session Start",
        "Duration",
        "Distance (km)",
        "Calories (kcal)",
        "Avg Speed (km/h)",
        "Max Speed (km/h)",
        "Pace (min/km)",
        "Steps",
        "Pauses",
        "Program",
        "Completed",
    ];
    const rows = sessions.map((s) => {
        const dt = new Date(s.date);
        const week = Math.ceil(
            ((dt - new Date(dt.getFullYear(), 0, 1)) / 86400000 + 1) / 7,
        );
        const month = dt.toLocaleDateString("en-US", {
            month: "short",
            year: "numeric",
        });
        const year = dt.getFullYear();
        const sessionStart = s.sessionStart
            ? new Date(s.sessionStart).toLocaleString()
            : "—";
        const avg = s.speedSamples > 0 ? s.speedSum / s.speedSamples : 0;
        const programCol = s.programName ?? "—";
        const completedCol = s.programName
            ? (s.programCompleted ? "Yes" : "No")
            : "—";
        return [
            s.date,
            week,
            month,
            year,
            sessionStart,
            fmtTime(s.timeSeconds || 0),
            parseFloat((s.distance || 0).toFixed(2)),
            Math.round(s.calories || 0),
            parseFloat(avg.toFixed(2)),
            parseFloat((s.maxSpeed || 0).toFixed(1)),
            fmtPace(avg),
            s.steps || 0,
            s.pauses || 0,
            programCol,
            completedCol,
        ];
    });
    const tsv = [header, ...rows].map((r) => r.join("\t")).join("\n");
    try {
        await navigator.clipboard.writeText(tsv);
        const btn = document.getElementById("copyForSheetsBtn");
        const orig = btn.innerHTML;
        btn.innerHTML =
            '<i class="fas fa-check"></i><span class="hidden sm:inline"> Copied!</span>';
        setTimeout(() => {
            btn.innerHTML = orig;
        }, 2000);
    } catch (e) {
        console.warn("Clipboard write failed:", e);
    }
}

// ============================================================
// Session History
// ============================================================

function saveSessionToHistory() {
    const deltaDistance = cumDistance - lastHistoryDistance;
    const deltaCalories = cumCalories - lastHistoryCalories;
    const deltaSpeedSum = speedSum - lastHistorySpeedSum;
    const deltaSpeedSamples = speedSamples - lastHistorySpeedSamples;
    const deltaTimeSeconds = cumTimeSeconds - lastHistoryTimeSeconds;
    const deltaPauses = Math.max(0, pauseCount - lastHistoryPauseCount);
    const deltaSteps = Math.max(0, cumSteps - lastHistorySteps);
    if (deltaDistance <= 0 && deltaSpeedSamples <= 0) return;
    const sessions = loadSessions();
    sessions.push({
        date: new Date().toISOString().slice(0, 10),
        savedAt: new Date().toISOString(),
        sessionStart: sessionStartTime || new Date().toISOString(),
        distance: deltaDistance,
        calories: deltaCalories,
        timeSeconds: Math.max(0, deltaTimeSeconds),
        speedSum: deltaSpeedSum,
        speedSamples: deltaSpeedSamples,
        maxSpeed: deltaMaxSpeed || maxSpeed,
        pauses: deltaPauses,
        steps: deltaSteps,
        programId:        activeProgram?.id   ?? null,
        programName:      activeProgram?.name ?? null,
        programCompleted: programCompletedFlag,
    });
    localStorage.setItem("wp_sessions", JSON.stringify(sessions));
    lastHistoryDistance = cumDistance;
    lastHistoryCalories = cumCalories;
    lastHistorySpeedSum = speedSum;
    lastHistorySpeedSamples = speedSamples;
    lastHistoryTimeSeconds = cumTimeSeconds;
    lastHistoryPauseCount = pauseCount;
    lastHistorySteps = cumSteps;
    deltaMaxSpeed = 0;
}

function getChartData() {
    let history = loadHistory();
    let dates = Object.keys(history).sort();
    let distanceData = [],
        caloriesData = [],
        speedData = [];
    dates.forEach((date) => {
        distanceData.push(parseFloat(history[date].distance.toFixed(2)));
        caloriesData.push(parseFloat(history[date].calories.toFixed(1)));
        const avgSpeed =
            history[date].speedSamples > 0
                ? history[date].speedSum / history[date].speedSamples
                : 0;
        speedData.push(parseFloat(avgSpeed.toFixed(2)));
    });
    return { dates, distanceData, caloriesData, speedData };
}

function renderCharts() {
    const { dates, distanceData, caloriesData, speedData } = getChartData();
    const isDark = document.documentElement.classList.contains("dark");
    const tickColor = isDark ? "#e5e7eb" : "#374151";
    const gridColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
    const chartOpts = (label, color) => ({
        type: "line",
        data: {
            labels: dates,
            datasets: [
                {
                    label,
                    data:
                        dates.length === 0
                            ? []
                            : label.includes("Distance")
                              ? distanceData
                              : label.includes("Calor")
                                ? caloriesData
                                : speedData,
                    borderColor: color,
                    backgroundColor: color
                        .replace(")", ",0.2)")
                        .replace("rgb", "rgba"),
                    fill: true,
                    tension: 0.3,
                    pointRadius: 3,
                },
            ],
        },
        options: {
            responsive: true,
            plugins: { legend: { labels: { color: tickColor } } },
            scales: {
                x: { ticks: { color: tickColor }, grid: { color: gridColor } },
                y: { ticks: { color: tickColor }, grid: { color: gridColor } },
            },
        },
    });

    if (wpCharts.distance) wpCharts.distance.destroy();
    if (wpCharts.calories) wpCharts.calories.destroy();
    if (wpCharts.speedHist) wpCharts.speedHist.destroy();

    wpCharts.distance = new Chart(
        document.getElementById("distanceChart").getContext("2d"),
        chartOpts("Distance (km)", "#0ea5e9"),
    );
    const calOpts = chartOpts("Calories (kcal)", "#f59e42");
    calOpts.data.datasets[0].data = caloriesData;
    wpCharts.calories = new Chart(
        document.getElementById("caloriesChart").getContext("2d"),
        calOpts,
    );
    const spdOpts = chartOpts("Avg Speed (km/h)", "#38bdf8");
    spdOpts.data.datasets[0].data = speedData;
    wpCharts.speedHist = new Chart(
        document.getElementById("speedChart").getContext("2d"),
        spdOpts,
    );
}

function renderSessionHistory() {
    if (historyView === "day") {
        renderHistoryByDay();
    } else {
        renderHistoryBySessions();
    }
}

function renderHistoryByDay() {
    const history = loadHistory();
    const dates = Object.keys(history).sort().reverse();
    const thead = document.getElementById("historyTableHead");
    const tbody = document.getElementById("historyTableBody");

    // Update header for day view
    thead.innerHTML = "";
    const trHead = document.createElement("tr");
    trHead.className =
        "text-left border-b border-gray-200 dark:border-gray-700";
    [
        "Date",
        "km",
        "kcal",
        "Time",
        "Avg km/h",
        "Steps",
        "Sessions",
        "Pauses",
    ].forEach((label, i) => {
        const th = document.createElement("th");
        th.className =
            "pb-2 font-semibold" + (i >= 5 ? " hidden md:table-cell" : "");
        th.textContent = label;
        trHead.appendChild(th);
    });
    thead.appendChild(trHead);

    if (dates.length === 0) {
        tbody.innerHTML =
            '<tr><td colspan="8" class="py-4 text-center text-gray-400">No history yet</td></tr>';
        return;
    }
    // Build set of streak dates for fire indicators
    const streakDates = new Set();
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayActive =
        (history[todayKey] && (history[todayKey].distance || 0) > 0) ||
        cumDistance > 0;
    const sd = new Date();
    if (!todayActive) sd.setDate(sd.getDate() - 1);
    for (let i = 0; i < 365; i++) {
        const key = sd.toISOString().slice(0, 10);
        const active =
            key === todayKey
                ? todayActive
                : history[key] && (history[key].distance || 0) > 0;
        if (active) {
            streakDates.add(key);
            sd.setDate(sd.getDate() - 1);
        } else break;
    }
    const fragment = document.createDocumentFragment();
    dates.forEach((date) => {
        const d = history[date];
        const avgSpeed =
            d.speedSamples > 0
                ? (d.speedSum / d.speedSamples).toFixed(2)
                : "0.00";
        const steps = (d.steps || 0).toLocaleString();
        const timeStr =
            d.timeSeconds > 0
                ? new Date(d.timeSeconds * 1000).toISOString().slice(11, 19)
                : "—";

        const tr = document.createElement("tr");
        tr.className =
            "border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800";

        const tdDate = document.createElement("td");
        tdDate.className = "py-2 text-gray-600 dark:text-gray-300";
        if (streakDates.has(date)) {
            const icon = document.createElement("i");
            icon.className = "fas fa-fire text-orange-400 text-xs mr-1";
            tdDate.appendChild(icon);
        }
        tdDate.appendChild(document.createTextNode(date));

        const tdDist = document.createElement("td");
        tdDist.className = "py-2 font-semibold text-sporty";
        tdDist.textContent = d.distance.toFixed(2);

        const tdCal = document.createElement("td");
        tdCal.className = "py-2 font-semibold text-accent";
        tdCal.textContent = Math.round(d.calories);

        const tdTime = document.createElement("td");
        tdTime.className = "py-2 font-semibold text-yellow-400";
        tdTime.textContent = timeStr;

        const tdSpeed = document.createElement("td");
        tdSpeed.className = "py-2 font-semibold text-blue-400";
        tdSpeed.textContent = avgSpeed;

        const tdSteps = document.createElement("td");
        tdSteps.className =
            "py-2 font-semibold text-sporty hidden md:table-cell";
        tdSteps.textContent = steps;

        const tdSessions = document.createElement("td");
        tdSessions.className =
            "py-2 font-semibold text-green-400 hidden md:table-cell";
        tdSessions.textContent = d.sessions || 0;

        const tdPauses = document.createElement("td");
        tdPauses.className =
            "py-2 font-semibold text-purple-400 hidden md:table-cell";
        tdPauses.textContent = d.pauses || 0;

        tr.append(
            tdDate,
            tdDist,
            tdCal,
            tdTime,
            tdSpeed,
            tdSteps,
            tdSessions,
            tdPauses,
        );
        fragment.appendChild(tr);
    });
    tbody.innerHTML = "";
    tbody.appendChild(fragment);
}

function renderHistoryBySessions() {
    const sessions = loadSessions().slice().reverse(); // newest first
    const thead = document.getElementById("historyTableHead");
    const tbody = document.getElementById("historyTableBody");

    // Update header for session view
    thead.innerHTML = "";
    const trHead = document.createElement("tr");
    trHead.className =
        "text-left border-b border-gray-200 dark:border-gray-700";
    [
        "Start",
        "Date",
        "km",
        "kcal",
        "Duration",
        "Avg km/h",
        "Program",
        "Steps",
        "Pauses",
    ].forEach((label, i) => {
        const th = document.createElement("th");
        th.className =
            "pb-2 font-semibold" + (i >= 6 ? " hidden md:table-cell" : "");
        th.textContent = label;
        trHead.appendChild(th);
    });
    thead.appendChild(trHead);

    if (sessions.length === 0) {
        tbody.innerHTML =
            '<tr><td colspan="9" class="py-4 text-center text-gray-400">No history yet</td></tr>';
        return;
    }
    const fragment = document.createDocumentFragment();
    sessions.forEach((s) => {
        const avgSpeed =
            s.speedSamples > 0
                ? (s.speedSum / s.speedSamples).toFixed(2)
                : "0.00";
        const steps = (s.steps || 0).toLocaleString();
        const timeStr =
            s.timeSeconds > 0
                ? new Date(s.timeSeconds * 1000).toISOString().slice(11, 19)
                : "—";
        const startTime = s.sessionStart
            ? new Date(s.sessionStart).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
              })
            : "—";

        const tr = document.createElement("tr");
        tr.className =
            "border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800";

        const tdStart = document.createElement("td");
        tdStart.className = "py-2 text-gray-600 dark:text-gray-300";
        tdStart.textContent = startTime;

        const tdDate = document.createElement("td");
        tdDate.className = "py-2 text-gray-500 dark:text-gray-400";
        tdDate.textContent = s.date;

        const tdDist = document.createElement("td");
        tdDist.className = "py-2 font-semibold text-sporty";
        tdDist.textContent = (s.distance || 0).toFixed(2);

        const tdCal = document.createElement("td");
        tdCal.className = "py-2 font-semibold text-accent";
        tdCal.textContent = Math.round(s.calories || 0);

        const tdTime = document.createElement("td");
        tdTime.className = "py-2 font-semibold text-yellow-400";
        tdTime.textContent = timeStr;

        const tdSpeed = document.createElement("td");
        tdSpeed.className = "py-2 font-semibold text-blue-400";
        tdSpeed.textContent = avgSpeed;

        const tdProgram = document.createElement("td");
        tdProgram.className = "py-2 hidden md:table-cell";
        if (s.programName) {
            const badge = s.programCompleted ? " ✓" : " ✗";
            tdProgram.innerHTML = `<span class="text-xs text-sky-600 dark:text-sky-400 font-medium">${s.programName}</span><span class="text-xs ${s.programCompleted ? "text-green-500" : "text-red-400"}">${badge}</span>`;
        } else {
            tdProgram.textContent = "—";
            tdProgram.className += " text-gray-400";
        }

        const tdSteps = document.createElement("td");
        tdSteps.className =
            "py-2 font-semibold text-sporty hidden md:table-cell";
        tdSteps.textContent = steps;

        const tdPauses = document.createElement("td");
        tdPauses.className =
            "py-2 font-semibold text-purple-400 hidden md:table-cell";
        tdPauses.textContent = s.pauses || 0;

        tr.append(
            tdStart,
            tdDate,
            tdDist,
            tdCal,
            tdTime,
            tdSpeed,
            tdProgram,
            tdSteps,
            tdPauses,
        );
        fragment.appendChild(tr);
    });
    tbody.innerHTML = "";
    tbody.appendChild(fragment);
}

// ============================================================
// Live Speed Chart
// ============================================================

function initLiveSpeedChart() {
    const isDark = document.documentElement.classList.contains("dark");
    const tickColor = isDark ? "#e5e7eb" : "#374151";
    const gridColor = isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.1)";
    wpCharts.liveSpeed = new Chart(
        document.getElementById("liveSpeedChart").getContext("2d"),
        {
            type: "line",
            data: {
                labels: liveSpeedLabels,
                datasets: [
                    {
                        label: "Speed (km/h)",
                        data: liveSpeedData,
                        borderColor: "#0ea5e9",
                        backgroundColor: "rgba(14,165,233,0.15)",
                        fill: true,
                        tension: 0.3,
                        pointRadius: 2,
                    },
                ],
            },
            options: {
                animation: false,
                responsive: true,
                plugins: { legend: { labels: { color: tickColor } } },
                scales: {
                    x: {
                        ticks: { color: tickColor, maxTicksLimit: 10 },
                        grid: { color: gridColor },
                    },
                    y: {
                        min: 0,
                        ...(liveChartYMax > 0 ? { max: liveChartYMax } : {}),
                        ticks: { color: tickColor },
                        grid: { color: gridColor },
                    },
                },
            },
        },
    );
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
    const hasExistingGoals = localStorage.getItem("wp_goal_distance") !== null;
    const defaultAuto = !hasExistingGoals;

    // Active days & sessions
    goalActiveDays = parseInt(localStorage.getItem("wp_goal_active_days") ?? 5);
    goalDaySessions = parseInt(
        localStorage.getItem("wp_goal_day_sessions") ?? 1,
    );
    goalWeekSessions = parseInt(
        localStorage.getItem("wp_goal_week_sessions") ?? goalActiveDays,
    );
    goalMonthSessions = parseInt(
        localStorage.getItem("wp_goal_month_sessions") ?? 0,
    );

    // Daily goals — default 5km / 30min on first launch
    goalDistanceKm = parseFloat(localStorage.getItem("wp_goal_distance") ?? 5);
    goalTimeSeconds = parseInt(
        localStorage.getItem("wp_goal_time_seconds") ?? 1800,
    );

    // Period goals
    goalWeekDistanceKm =
        parseFloat(localStorage.getItem("wp_goal_week_distance")) || 0;
    goalWeekTimeSeconds =
        parseInt(localStorage.getItem("wp_goal_week_time_seconds")) || 0;
    goalMonthDistanceKm =
        parseFloat(localStorage.getItem("wp_goal_month_distance")) || 0;
    goalMonthTimeSeconds =
        parseInt(localStorage.getItem("wp_goal_month_time_seconds")) || 0;
    goalThreeMonthDistanceKm =
        parseFloat(localStorage.getItem("wp_goal_threemonth_distance")) || 0;
    goalThreeMonthTimeSeconds =
        parseInt(localStorage.getItem("wp_goal_threemonth_time_seconds")) || 0;
    goalSixMonthDistanceKm =
        parseFloat(localStorage.getItem("wp_goal_sixmonth_distance")) || 0;
    goalSixMonthTimeSeconds =
        parseInt(localStorage.getItem("wp_goal_sixmonth_time_seconds")) || 0;
    goalYearDistanceKm =
        parseFloat(localStorage.getItem("wp_goal_year_distance")) || 0;
    goalYearTimeSeconds =
        parseInt(localStorage.getItem("wp_goal_year_time_seconds")) || 0;

    // Auto flags — per-period, default true for new users
    const loadFlag = (key) =>
        localStorage.getItem(key) !== null
            ? localStorage.getItem(key) === "true"
            : defaultAuto;
    autoWeek = loadFlag("wp_goal_auto_week");
    autoMonth = loadFlag("wp_goal_auto_month");
    autoThreeMonth = loadFlag("wp_goal_auto_threemonth");
    autoSixMonth = loadFlag("wp_goal_auto_sixmonth");
    autoYear = loadFlag("wp_goal_auto_year");

    // Populate UI
    document.getElementById("goalActiveDaysSlider").value = goalActiveDays;
    document.getElementById("goalActiveDaysDisplay").textContent =
        goalActiveDays;

    document.getElementById("goalDistanceSlider").value = goalDistanceKm;
    document.getElementById("goalDistanceDisplay").textContent =
        goalDistanceKm > 0 ? goalDistanceKm.toFixed(1) : "—";

    const timeMins = Math.round(goalTimeSeconds / 60);
    document.getElementById("goalTimeSlider").value = timeMins;
    document.getElementById("goalTimeDisplay").textContent =
        goalTimeSeconds > 0 ? timeMins + ":00" : "—";

    document.getElementById("goalDaySessionsSlider").value = goalDaySessions;
    document.getElementById("goalDaySessionsDisplay").textContent =
        goalDaySessions;
    document.getElementById("goalWeekSessionsSlider").value = goalWeekSessions;
    document.getElementById("goalWeekSessionsDisplay").textContent =
        goalWeekSessions;
    document.getElementById("goalMonthSessionsSlider").value =
        goalMonthSessions;
    document.getElementById("goalMonthSessionsDisplay").textContent =
        goalMonthSessions || "—";

    syncAutoUI();

    // Populate period sliders with stored values (recalculateGoals will override auto ones)
    document.getElementById("goalWeekDistanceSlider").value =
        goalWeekDistanceKm;
    document.getElementById("goalWeekDistanceDisplay").textContent =
        goalWeekDistanceKm > 0 ? goalWeekDistanceKm.toFixed(1) : "—";
    document.getElementById("goalWeekTimeSlider").value = Math.round(
        goalWeekTimeSeconds / 60,
    );
    document.getElementById("goalWeekTimeDisplay").textContent =
        goalWeekTimeSeconds > 0 ? formatHHMM(goalWeekTimeSeconds) : "—";
    document.getElementById("goalMonthDistanceSlider").value =
        goalMonthDistanceKm;
    document.getElementById("goalMonthDistanceDisplay").textContent =
        goalMonthDistanceKm > 0 ? goalMonthDistanceKm.toFixed(1) : "—";
    document.getElementById("goalMonthTimeSlider").value = Math.round(
        goalMonthTimeSeconds / 60,
    );
    document.getElementById("goalMonthTimeDisplay").textContent =
        goalMonthTimeSeconds > 0 ? formatHHMM(goalMonthTimeSeconds) : "—";
    document.getElementById("goalThreeMonthDistanceSlider").value =
        goalThreeMonthDistanceKm;
    document.getElementById("goalThreeMonthDistanceDisplay").textContent =
        goalThreeMonthDistanceKm > 0
            ? goalThreeMonthDistanceKm.toFixed(1)
            : "—";
    document.getElementById("goalThreeMonthTimeSlider").value = Math.round(
        goalThreeMonthTimeSeconds / 60,
    );
    document.getElementById("goalThreeMonthTimeDisplay").textContent =
        goalThreeMonthTimeSeconds > 0
            ? formatHHMM(goalThreeMonthTimeSeconds)
            : "—";
    document.getElementById("goalSixMonthDistanceSlider").value =
        goalSixMonthDistanceKm;
    document.getElementById("goalSixMonthDistanceDisplay").textContent =
        goalSixMonthDistanceKm > 0 ? goalSixMonthDistanceKm.toFixed(1) : "—";
    document.getElementById("goalSixMonthTimeSlider").value = Math.round(
        goalSixMonthTimeSeconds / 60,
    );
    document.getElementById("goalSixMonthTimeDisplay").textContent =
        goalSixMonthTimeSeconds > 0 ? formatHHMM(goalSixMonthTimeSeconds) : "—";
    document.getElementById("goalYearDistanceSlider").value =
        goalYearDistanceKm;
    document.getElementById("goalYearDistanceDisplay").textContent =
        goalYearDistanceKm > 0 ? goalYearDistanceKm.toFixed(0) : "—";
    document.getElementById("goalYearTimeSlider").value = Math.round(
        goalYearTimeSeconds / 60,
    );
    document.getElementById("goalYearTimeDisplay").textContent =
        goalYearTimeSeconds > 0 ? formatHHMM(goalYearTimeSeconds) : "—";

    // Apply auto-calculations on top of loaded values
    recalculateGoals();
}

function syncAutoUI() {
    [
        ["weekly", autoWeek],
        ["monthly", autoMonth],
        ["threemonth", autoThreeMonth],
        ["sixmonth", autoSixMonth],
        ["yearly", autoYear],
    ].forEach(([tab, isAuto]) => {
        const pip = document.querySelector(
            `[data-tab="${tab}"] .goal-auto-pip`,
        );
        if (pip) pip.classList.toggle("invisible", !isAuto);
        const id = "goalAuto" + tab.charAt(0).toUpperCase() + tab.slice(1);
        const cb = document.getElementById(id);
        if (cb) cb.checked = isAuto;
    });
}

function recalculateGoals() {
    const N = goalActiveDays;
    const wkDist = goalDistanceKm * N;
    const wkTimeMins = Math.round(goalTimeSeconds / 60) * N;

    if (autoWeek) {
        goalWeekDistanceKm = Math.min(70, Math.round(wkDist / 0.5) * 0.5);
        localStorage.setItem("wp_goal_week_distance", goalWeekDistanceKm);
        document.getElementById("goalWeekDistanceSlider").value =
            goalWeekDistanceKm;
        document.getElementById("goalWeekDistanceDisplay").textContent =
            goalWeekDistanceKm > 0 ? goalWeekDistanceKm.toFixed(1) : "—";

        const wkMins = Math.min(840, Math.round(wkTimeMins / 15) * 15);
        goalWeekTimeSeconds = wkMins * 60;
        localStorage.setItem("wp_goal_week_time_seconds", goalWeekTimeSeconds);
        document.getElementById("goalWeekTimeSlider").value = wkMins;
        document.getElementById("goalWeekTimeDisplay").textContent =
            goalWeekTimeSeconds > 0 ? formatHHMM(goalWeekTimeSeconds) : "—";

        goalWeekSessions = N;
        localStorage.setItem("wp_goal_week_sessions", goalWeekSessions);
        document.getElementById("goalWeekSessionsSlider").value =
            goalWeekSessions;
        document.getElementById("goalWeekSessionsDisplay").textContent =
            goalWeekSessions;
    }
    if (autoMonth) {
        goalMonthDistanceKm = Math.min(300, Math.round(wkDist * 4.348));
        localStorage.setItem("wp_goal_month_distance", goalMonthDistanceKm);
        document.getElementById("goalMonthDistanceSlider").value =
            goalMonthDistanceKm;
        document.getElementById("goalMonthDistanceDisplay").textContent =
            goalMonthDistanceKm > 0 ? goalMonthDistanceKm.toFixed(1) : "—";

        const moMins = Math.min(
            3600,
            Math.round((wkTimeMins * 4.348) / 30) * 30,
        );
        goalMonthTimeSeconds = moMins * 60;
        localStorage.setItem(
            "wp_goal_month_time_seconds",
            goalMonthTimeSeconds,
        );
        document.getElementById("goalMonthTimeSlider").value = moMins;
        document.getElementById("goalMonthTimeDisplay").textContent =
            goalMonthTimeSeconds > 0 ? formatHHMM(goalMonthTimeSeconds) : "—";

        goalMonthSessions = Math.round(goalWeekSessions * 4.348);
        localStorage.setItem("wp_goal_month_sessions", goalMonthSessions);
        document.getElementById("goalMonthSessionsSlider").value =
            goalMonthSessions;
        document.getElementById("goalMonthSessionsDisplay").textContent =
            goalMonthSessions;
    }
    if (autoThreeMonth) {
        goalThreeMonthDistanceKm = Math.min(
            600,
            Math.round((wkDist * 13.04) / 5) * 5,
        );
        localStorage.setItem(
            "wp_goal_threemonth_distance",
            goalThreeMonthDistanceKm,
        );
        document.getElementById("goalThreeMonthDistanceSlider").value =
            goalThreeMonthDistanceKm;
        document.getElementById("goalThreeMonthDistanceDisplay").textContent =
            goalThreeMonthDistanceKm > 0
                ? goalThreeMonthDistanceKm.toFixed(1)
                : "—";

        const q1Mins = Math.min(
            10800,
            Math.round((wkTimeMins * 13.04) / 60) * 60,
        );
        goalThreeMonthTimeSeconds = q1Mins * 60;
        localStorage.setItem(
            "wp_goal_threemonth_time_seconds",
            goalThreeMonthTimeSeconds,
        );
        document.getElementById("goalThreeMonthTimeSlider").value = q1Mins;
        document.getElementById("goalThreeMonthTimeDisplay").textContent =
            goalThreeMonthTimeSeconds > 0
                ? formatHHMM(goalThreeMonthTimeSeconds)
                : "—";
    }
    if (autoSixMonth) {
        goalSixMonthDistanceKm = Math.min(
            1200,
            Math.round((wkDist * 26.09) / 10) * 10,
        );
        localStorage.setItem(
            "wp_goal_sixmonth_distance",
            goalSixMonthDistanceKm,
        );
        document.getElementById("goalSixMonthDistanceSlider").value =
            goalSixMonthDistanceKm;
        document.getElementById("goalSixMonthDistanceDisplay").textContent =
            goalSixMonthDistanceKm > 0
                ? goalSixMonthDistanceKm.toFixed(1)
                : "—";

        const s6Mins = Math.min(
            21600,
            Math.round((wkTimeMins * 26.09) / 60) * 60,
        );
        goalSixMonthTimeSeconds = s6Mins * 60;
        localStorage.setItem(
            "wp_goal_sixmonth_time_seconds",
            goalSixMonthTimeSeconds,
        );
        document.getElementById("goalSixMonthTimeSlider").value = s6Mins;
        document.getElementById("goalSixMonthTimeDisplay").textContent =
            goalSixMonthTimeSeconds > 0
                ? formatHHMM(goalSixMonthTimeSeconds)
                : "—";
    }
    if (autoYear) {
        goalYearDistanceKm = Math.min(
            3000,
            Math.round((wkDist * 52.18) / 10) * 10,
        );
        localStorage.setItem("wp_goal_year_distance", goalYearDistanceKm);
        document.getElementById("goalYearDistanceSlider").value =
            goalYearDistanceKm;
        document.getElementById("goalYearDistanceDisplay").textContent =
            goalYearDistanceKm > 0 ? goalYearDistanceKm.toFixed(0) : "—";

        const yrMins = Math.min(
            43200,
            Math.round((wkTimeMins * 52.18) / 60) * 60,
        );
        goalYearTimeSeconds = yrMins * 60;
        localStorage.setItem("wp_goal_year_time_seconds", goalYearTimeSeconds);
        document.getElementById("goalYearTimeSlider").value = yrMins;
        document.getElementById("goalYearTimeDisplay").textContent =
            goalYearTimeSeconds > 0 ? formatHHMM(goalYearTimeSeconds) : "—";
    }
    updateGoalProgress();
}

function updateGoalProgress() {
    const today = getPeriodStats(1);
    if (goalDistanceKm > 0) {
        const pct = Math.min(100, (today.dist / goalDistanceKm) * 100);
        document.getElementById("goalDistanceBar").style.width = pct + "%";
        document.getElementById("goalDistanceProgress").textContent =
            today.dist.toFixed(2);
        document.getElementById("goalDistanceTarget").textContent =
            goalDistanceKm.toFixed(1);
    }
    if (goalTimeSeconds > 0) {
        const pct = Math.min(100, (today.time / goalTimeSeconds) * 100);
        document.getElementById("goalTimeBar").style.width = pct + "%";
        document.getElementById("goalTimeProgress").textContent = new Date(
            today.time * 1000,
        )
            .toISOString()
            .slice(11, 19);
        document.getElementById("goalTimeTarget").textContent =
            formatSeconds(goalTimeSeconds);
    }
    const week = getPeriodStats(7);
    if (goalWeekDistanceKm > 0) {
        const pct = Math.min(100, (week.dist / goalWeekDistanceKm) * 100);
        document.getElementById("weekGoalBar").style.width = pct + "%";
        document.getElementById("weekGoalProgress").textContent =
            week.dist.toFixed(2);
        document.getElementById("weekGoalTarget").textContent =
            goalWeekDistanceKm.toFixed(1);
    }
    if (goalWeekTimeSeconds > 0) {
        const pct = Math.min(100, (week.time / goalWeekTimeSeconds) * 100);
        document.getElementById("weekTimeGoalBar").style.width = pct + "%";
        document.getElementById("weekTimeGoalProgress").textContent = new Date(
            week.time * 1000,
        )
            .toISOString()
            .slice(11, 19);
        document.getElementById("weekTimeGoalTarget").textContent =
            formatHHMM(goalWeekTimeSeconds);
    }
    const month = getPeriodStats(30);
    if (goalMonthDistanceKm > 0) {
        const pct = Math.min(100, (month.dist / goalMonthDistanceKm) * 100);
        document.getElementById("monthGoalBar").style.width = pct + "%";
        document.getElementById("monthGoalProgress").textContent =
            month.dist.toFixed(2);
        document.getElementById("monthGoalTarget").textContent =
            goalMonthDistanceKm.toFixed(1);
    }
    if (goalMonthTimeSeconds > 0) {
        const pct = Math.min(100, (month.time / goalMonthTimeSeconds) * 100);
        document.getElementById("monthTimeGoalBar").style.width = pct + "%";
        document.getElementById("monthTimeGoalProgress").textContent = new Date(
            month.time * 1000,
        )
            .toISOString()
            .slice(11, 19);
        document.getElementById("monthTimeGoalTarget").textContent =
            formatHHMM(goalMonthTimeSeconds);
    }
    const threeMonth = getPeriodStats(91);
    if (goalThreeMonthDistanceKm > 0) {
        const pct = Math.min(
            100,
            (threeMonth.dist / goalThreeMonthDistanceKm) * 100,
        );
        document.getElementById("threeMonthGoalBar").style.width = pct + "%";
        document.getElementById("threeMonthGoalProgress").textContent =
            threeMonth.dist.toFixed(2);
        document.getElementById("threeMonthGoalTarget").textContent =
            goalThreeMonthDistanceKm.toFixed(1);
    }
    if (goalThreeMonthTimeSeconds > 0) {
        const pct = Math.min(
            100,
            (threeMonth.time / goalThreeMonthTimeSeconds) * 100,
        );
        document.getElementById("threeMonthTimeGoalBar").style.width =
            pct + "%";
        document.getElementById("threeMonthTimeGoalProgress").textContent =
            new Date(threeMonth.time * 1000).toISOString().slice(11, 19);
        document.getElementById("threeMonthTimeGoalTarget").textContent =
            formatHHMM(goalThreeMonthTimeSeconds);
    }
    const sixMonth = getPeriodStats(182);
    if (goalSixMonthDistanceKm > 0) {
        const pct = Math.min(
            100,
            (sixMonth.dist / goalSixMonthDistanceKm) * 100,
        );
        document.getElementById("sixMonthGoalBar").style.width = pct + "%";
        document.getElementById("sixMonthGoalProgress").textContent =
            sixMonth.dist.toFixed(2);
        document.getElementById("sixMonthGoalTarget").textContent =
            goalSixMonthDistanceKm.toFixed(1);
    }
    if (goalSixMonthTimeSeconds > 0) {
        const pct = Math.min(
            100,
            (sixMonth.time / goalSixMonthTimeSeconds) * 100,
        );
        document.getElementById("sixMonthTimeGoalBar").style.width = pct + "%";
        document.getElementById("sixMonthTimeGoalProgress").textContent =
            new Date(sixMonth.time * 1000).toISOString().slice(11, 19);
        document.getElementById("sixMonthTimeGoalTarget").textContent =
            formatHHMM(goalSixMonthTimeSeconds);
    }
    const year = getPeriodStats(365);
    if (goalYearDistanceKm > 0) {
        const pct = Math.min(100, (year.dist / goalYearDistanceKm) * 100);
        document.getElementById("yearGoalBar").style.width = pct + "%";
        document.getElementById("yearGoalProgress").textContent =
            year.dist.toFixed(2);
        document.getElementById("yearGoalTarget").textContent =
            goalYearDistanceKm.toFixed(0);
    }
    if (goalYearTimeSeconds > 0) {
        const pct = Math.min(100, (year.time / goalYearTimeSeconds) * 100);
        document.getElementById("yearTimeGoalBar").style.width = pct + "%";
        document.getElementById("yearTimeGoalProgress").textContent = new Date(
            year.time * 1000,
        )
            .toISOString()
            .slice(11, 19);
        document.getElementById("yearTimeGoalTarget").textContent =
            formatHHMM(goalYearTimeSeconds);
    }
    if (goalDaySessions > 0) {
        const daySess = getPeriodStats(1).sess;
        const pct = Math.min(100, (daySess / goalDaySessions) * 100);
        document.getElementById("daySessionsGoalBar").style.width = pct + "%";
        document.getElementById("daySessionsGoalProgress").textContent =
            daySess;
        document.getElementById("daySessionsGoalTarget").textContent =
            goalDaySessions;
    }
    if (goalWeekSessions > 0) {
        const weekSess = getPeriodStats(7).sess;
        const pct = Math.min(100, (weekSess / goalWeekSessions) * 100);
        document.getElementById("weekSessionsGoalBar").style.width = pct + "%";
        document.getElementById("weekSessionsGoalProgress").textContent =
            weekSess;
        document.getElementById("weekSessionsGoalTarget").textContent =
            goalWeekSessions;
    }
    if (goalMonthSessions > 0) {
        const monthSess = getPeriodStats(30).sess;
        const pct = Math.min(100, (monthSess / goalMonthSessions) * 100);
        document.getElementById("monthSessionsGoalBar").style.width = pct + "%";
        document.getElementById("monthSessionsGoalProgress").textContent =
            monthSess;
        document.getElementById("monthSessionsGoalTarget").textContent =
            goalMonthSessions;
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
    document.getElementById("todayTime").textContent = fmt(s.time);
    document.getElementById("todayAvgSpeed").textContent =
        s.avgSpeed.toFixed(2);
    document.getElementById("todayMaxSpd").textContent = s.maxSpd.toFixed(2);
    document.getElementById("todaySessions").textContent = s.sess;
    document.getElementById("todayPauses").textContent = s.pauses;
    document.getElementById("todaySteps").textContent = Math.round(s.steps).toLocaleString();
    document.getElementById("todayActive").textContent =
        getActiveDays(1) + "/1";
}

// ============================================================
// Period Stats (Week / Month)
// ============================================================

function getPeriodStats(days) {
    const history = loadHistory();
    const today = new Date().toISOString().slice(0, 10);
    const cutoff = new Date(Date.now() - (days - 1) * 86400000)
        .toISOString()
        .slice(0, 10);
    let dist = 0,
        cal = 0,
        time = 0,
        spdSum = 0,
        spdSamp = 0,
        sess = 0,
        pauses = 0,
        maxSpd = 0,
        steps = 0;
    Object.entries(history).forEach(([date, d]) => {
        if (date >= cutoff && date <= today) {
            dist += d.distance || 0;
            cal += d.calories || 0;
            time += d.timeSeconds || 0;
            spdSum += d.speedSum || 0;
            spdSamp += d.speedSamples || 0;
            sess += d.sessions || 0;
            pauses += d.pauses || 0;
            maxSpd = Math.max(maxSpd, d.maxSpeed || 0);
            steps += d.steps || 0;
        }
    });
    // Add current unsaved session delta for today
    if (today >= cutoff) {
        const dDist = Math.max(0, cumDistance - lastHistoryDistance);
        const dSamp = Math.max(0, speedSamples - lastHistorySpeedSamples);
        dist += dDist;
        cal += Math.max(0, cumCalories - lastHistoryCalories);
        time += Math.max(0, cumTimeSeconds - lastHistoryTimeSeconds);
        spdSum += Math.max(0, speedSum - lastHistorySpeedSum);
        spdSamp += dSamp;
        pauses += Math.max(0, pauseCount - lastHistoryPauseCount);
        maxSpd = Math.max(maxSpd, maxSpeed);
        steps += Math.max(0, cumSteps - lastHistorySteps);
        if (dDist > 0 || dSamp > 0) sess += 1;
    }
    let avgSpeed = spdSamp > 0 ? spdSum / spdSamp : 0;
    if (maxSpd > 0 && avgSpeed > maxSpd) avgSpeed = maxSpd;
    return { dist, cal, time, avgSpeed, sess, pauses, maxSpd, steps };
}

function updatePeriodStats() {
    const week = getPeriodStats(7);
    const month = getPeriodStats(30);
    const threeMonth = getPeriodStats(91);
    const sixMonth = getPeriodStats(182);
    const year = getPeriodStats(365);

    const fmt = (s) => new Date(s * 1000).toISOString().slice(11, 19);

    document.getElementById("weekDist").textContent = week.dist.toFixed(2);
    document.getElementById("weekCal").textContent = Math.round(week.cal);
    document.getElementById("weekTime").textContent = fmt(week.time);
    document.getElementById("weekAvgSpd").textContent =
        week.avgSpeed.toFixed(2);
    document.getElementById("weekSessions").textContent = week.sess;
    document.getElementById("weekPauses").textContent = week.pauses;
    document.getElementById("weekSteps").textContent = Math.round(week.steps).toLocaleString();
    document.getElementById("weekMaxSpd").textContent = week.maxSpd.toFixed(2);

    document.getElementById("monthDist").textContent = month.dist.toFixed(2);
    document.getElementById("monthCal").textContent = Math.round(month.cal);
    document.getElementById("monthTime").textContent = fmt(month.time);
    document.getElementById("monthAvgSpd").textContent =
        month.avgSpeed.toFixed(2);
    document.getElementById("monthSessions").textContent = month.sess;
    document.getElementById("monthPauses").textContent = month.pauses;
    document.getElementById("monthSteps").textContent = Math.round(month.steps).toLocaleString();
    document.getElementById("monthMaxSpd").textContent = month.maxSpd.toFixed(2);

    document.getElementById("threeMonthDist").textContent =
        threeMonth.dist.toFixed(2);
    document.getElementById("threeMonthCal").textContent = Math.round(
        threeMonth.cal,
    );
    document.getElementById("threeMonthTime").textContent = fmt(
        threeMonth.time,
    );
    document.getElementById("threeMonthAvgSpd").textContent =
        threeMonth.avgSpeed.toFixed(2);
    document.getElementById("threeMonthSessions").textContent = threeMonth.sess;
    document.getElementById("threeMonthPauses").textContent = threeMonth.pauses;
    document.getElementById("threeMonthSteps").textContent = Math.round(threeMonth.steps).toLocaleString();
    document.getElementById("threeMonthMaxSpd").textContent = threeMonth.maxSpd.toFixed(2);

    document.getElementById("sixMonthDist").textContent =
        sixMonth.dist.toFixed(2);
    document.getElementById("sixMonthCal").textContent = Math.round(
        sixMonth.cal,
    );
    document.getElementById("sixMonthTime").textContent = fmt(sixMonth.time);
    document.getElementById("sixMonthAvgSpd").textContent =
        sixMonth.avgSpeed.toFixed(2);
    document.getElementById("sixMonthSessions").textContent = sixMonth.sess;
    document.getElementById("sixMonthPauses").textContent = sixMonth.pauses;
    document.getElementById("sixMonthSteps").textContent = Math.round(sixMonth.steps).toLocaleString();
    document.getElementById("sixMonthMaxSpd").textContent = sixMonth.maxSpd.toFixed(2);

    document.getElementById("yearDist").textContent = year.dist.toFixed(2);
    document.getElementById("yearCal").textContent = Math.round(year.cal);
    document.getElementById("yearTime").textContent = fmt(year.time);
    document.getElementById("yearAvgSpd").textContent =
        year.avgSpeed.toFixed(2);
    document.getElementById("yearSessions").textContent = year.sess;
    document.getElementById("yearPauses").textContent = year.pauses;
    document.getElementById("yearSteps").textContent = Math.round(year.steps).toLocaleString();
    document.getElementById("yearMaxSpd").textContent = year.maxSpd.toFixed(2);

    document.getElementById("weekActive").textContent = getActiveDays(7) + "/7";
    document.getElementById("monthActive").textContent =
        getActiveDays(30) + "/30";
    document.getElementById("threeMonthActive").textContent =
        getActiveDays(91) + "/91";
    document.getElementById("sixMonthActive").textContent =
        getActiveDays(182) + "/182";
    document.getElementById("yearActive").textContent =
        getActiveDays(365) + "/365";
}

function getAllTimeExtras() {
    const history = loadHistory();
    let bestDayDist = 0,
        bestDayDate = null,
        totalSessions = 0,
        totalSteps = 0,
        allTimeSpdSum = 0,
        allTimeSpdSamp = 0,
        allTimeMaxSpd = 0;
    let bestAvgSpeed = 0,
        bestAvgSpeedDate = null;
    Object.entries(history).forEach(([date, d]) => {
        if ((d.distance || 0) > bestDayDist) {
            bestDayDist = d.distance;
            bestDayDate = date;
        }
        totalSessions += d.sessions || 0;
        totalSteps += d.steps || 0;
        allTimeSpdSum += d.speedSum || 0;
        allTimeSpdSamp += d.speedSamples || 0;
        allTimeMaxSpd = Math.max(allTimeMaxSpd, d.maxSpeed || 0);
        const avg = d.speedSamples > 0 ? d.speedSum / d.speedSamples : 0;
        if (avg > bestAvgSpeed) {
            bestAvgSpeed = avg;
            bestAvgSpeedDate = date;
        }
    });
    // Add unsaved current session delta
    const liveDist = Math.max(0, cumDistance - lastHistoryDistance);
    const liveSamp = Math.max(0, speedSamples - lastHistorySpeedSamples);
    totalSteps += Math.max(0, cumSteps - lastHistorySteps);
    allTimeSpdSum += Math.max(0, speedSum - lastHistorySpeedSum);
    allTimeSpdSamp += liveSamp;
    allTimeMaxSpd = Math.max(allTimeMaxSpd, maxSpeed);
    if (liveDist > 0 || liveSamp > 0) totalSessions += 1;
    let allTimeAvgSpeed = allTimeSpdSamp > 0 ? allTimeSpdSum / allTimeSpdSamp : 0;
    if (allTimeMaxSpd > 0 && allTimeAvgSpeed > allTimeMaxSpd) allTimeAvgSpeed = allTimeMaxSpd;
    const sessions = loadSessions();
    const programsCompleted = sessions.filter(
        (s) => s.programCompleted === true,
    ).length;
    return {
        bestDayDist,
        bestDayDate,
        totalSessions,
        totalSteps,
        allTimeAvgSpeed,
        allTimeMaxSpd,
        bestAvgSpeed,
        bestAvgSpeedDate,
        programsCompleted,
    };
}

function getStreak() {
    const history = loadHistory();
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayActive =
        (history[todayKey] && (history[todayKey].distance || 0) > 0) ||
        cumDistance > 0;
    const d = new Date();
    if (!todayActive) d.setDate(d.getDate() - 1);
    let streak = 0;
    while (streak < 365) {
        const key = d.toISOString().slice(0, 10);
        const active =
            key === todayKey
                ? todayActive
                : history[key] && (history[key].distance || 0) > 0;
        if (active) {
            streak++;
            d.setDate(d.getDate() - 1);
        } else break;
    }
    return streak;
}

function getActiveDays(days) {
    const history = loadHistory();
    const todayKey = new Date().toISOString().slice(0, 10);
    const todayActive =
        (history[todayKey] && (history[todayKey].distance || 0) > 0) ||
        cumDistance > 0;
    let count = 0;
    const d = new Date();
    for (let i = 0; i < days; i++) {
        const key = d.toISOString().slice(0, 10);
        const active =
            key === todayKey
                ? todayActive
                : history[key] && (history[key].distance || 0) > 0;
        if (active) count++;
        d.setDate(d.getDate() - 1);
    }
    return count;
}

function updateAllTimeExtras() {
    const {
        bestDayDist,
        bestDayDate,
        totalSessions,
        totalSteps,
        allTimeAvgSpeed,
        allTimeMaxSpd,
        bestAvgSpeed,
        bestAvgSpeedDate,
        programsCompleted,
    } = getAllTimeExtras();
    document.getElementById("allTimeBestDay").textContent = bestDayDate
        ? `${bestDayDist.toFixed(2)} km (${bestDayDate})`
        : "—";
    document.getElementById("allTimeTotalSessions").textContent = totalSessions;
    document.getElementById("allTimeStreak").textContent =
        getStreak() + " days";
    document.getElementById("allTimeActive30").textContent =
        getActiveDays(30) + "/30";
    document.getElementById("allTimeBestAvgSpeed").textContent =
        bestAvgSpeedDate
            ? `${bestAvgSpeed.toFixed(2)} km/h (${bestAvgSpeedDate})`
            : "—";
    document.getElementById("allTimeProgramsCompleted").textContent =
        programsCompleted;
    document.getElementById("cumSteps").textContent =
        Math.round(totalSteps).toLocaleString();
    document.getElementById("cumAvgSpeed").textContent =
        allTimeAvgSpeed.toFixed(2);
    document.getElementById("cumMaxSpeed").textContent =
        allTimeMaxSpd.toFixed(2);
}

// ============================================================
// Onboarding
// ============================================================

function showOnboardingModal() {
    const modal = document.getElementById("onboardingModal");
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    applyHeightToOnboardingInputs();
}

function saveOnboarding() {
    const w = parseFloat(document.getElementById("onboardingWeight").value);
    const a = parseInt(document.getElementById("onboardingAge").value);
    const err = document.getElementById("onboardingError");
    let newHeightCm;
    if (userHeightUnit === "ftin") {
        const ft = parseInt(document.getElementById("onboardingHeightFt").value, 10);
        const inches = parseInt(document.getElementById("onboardingHeightIn").value, 10);
        newHeightCm = isNaN(ft) || isNaN(inches) ? NaN : ftInToCm(ft, inches);
    } else {
        newHeightCm = parseFloat(document.getElementById("onboardingHeightCm").value);
    }
    if (!w || isNaN(newHeightCm) || newHeightCm <= 0 || !a) {
        err.classList.remove("hidden");
        return;
    }
    err.classList.add("hidden");
    userWeight = w;
    userHeightCm = newHeightCm;
    userAge = a;
    localStorage.setItem("wp_weight", userWeight);
    localStorage.setItem("wp_height_cm", userHeightCm);
    localStorage.setItem("wp_height_unit", userHeightUnit);
    localStorage.setItem("wp_age", userAge);
    document.getElementById("weightInput").value = userWeight;
    applyHeightToSettingsInputs();
    document.getElementById("ageInput").value = userAge;
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
        const tickColor = isDark ? "#e5e7eb" : "#374151";
        wpCharts.liveSpeed.options.scales.x.ticks.color = tickColor;
        wpCharts.liveSpeed.options.scales.y.ticks.color = tickColor;
        wpCharts.liveSpeed.update();
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
let statsIntervalId = null;

statsIntervalId = setInterval(() => {
    const speed = currentSpeed || 0;
    const now = Date.now();
    const dt = (now - lastDistanceUpdate) / 3600000;

    autoBackupTick++;
    if (
        autoBackupTick % 10 === 0 &&
        cumDistance > 0 &&
        (isRunning || isPaused)
    ) {
        saveSessionBackup();
    }

    if (dt > 0) {
        if (speed > 0) {
            estimatedDistanceKm += speed * dt;
            cumEstimatedDistance += speed * dt;
        }
        lastDistanceUpdate = now;
    }

    currentSteps = estimateSteps(cumEstimatedDistance, userHeightCm);
    if (document.getElementById("currentSteps"))
        document.getElementById("currentSteps").textContent = currentSteps;
    cumSteps = estimateSteps(cumEstimatedDistance, userHeightCm);

    const powerThisSecond = estimatePower(currentSpeed, userWeight);
    cumPower = powerThisSecond;
    if (isRunning) cumTotalPower += powerThisSecond;
    if (isRunning) updateLiveSpeedChart();
    tickProgram();
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
    if (!cFTMSControl) {
        showStartupIndicator(0);
        return;
    }
    const hasPreviousStats = cumDistance > 0 || cumTimeSeconds > 0 || cumCalories > 0;
    if (hasPreviousStats) {
        showContinueModal();
    } else {
        setStatus("Starting…", "bg-yellow-400");
        ftmsCmd([0x07]);
        showStartupIndicator(0);
    }
});

document
    .getElementById("continueYesBtn")
    .addEventListener("click", async () => {
        hideContinueModal();
        if (!cFTMSControl) {
            showStartupIndicator(0);
            return;
        }
        loadCumulativeStats();
        updateCumulativeStats();
        localStorage.removeItem("wp_session_backup");
        updateRecoverBtn();
        setStatus("Starting…", "bg-yellow-400");
        ftmsCmd([0x07]);
        showStartupIndicator(0);
    });

document.getElementById("continueNoBtn").addEventListener("click", () => {
    hideContinueModal();
    if (!cFTMSControl) {
        showStartupIndicator(0);
        return;
    }
    if (programRunning) cancelProgram();
    saveSessionBackup();
    cumDistance = 0;
    cumCalories = 0;
    cumTimeSeconds = 0;
    pauseCount = 0;
    totalPauseTime = 0;
    cumTotalPower = 0;
    maxSpeed = 0;
    speedSum = 0;
    speedSamples = 0;
    deltaMaxSpeed = 0;
    estimatedDistanceKm = 0;
    cumEstimatedDistance = 0;
    liveSpeedData = [];
    liveSpeedLabels = [];
    liveSecondCount = 0;
    lastHistoryDistance = 0;
    lastHistoryCalories = 0;
    lastHistorySpeedSum = 0;
    lastHistorySpeedSamples = 0;
    lastHistoryTimeSeconds = 0;
    lastHistoryPauseCount = 0;
    lastHistorySteps = 0;
    cumSteps = 0;
    currentSteps = 0;
    autoSaveCumulativeStats();
    setStatus("Starting…", "bg-yellow-400");
    ftmsCmd([0x07]);
    showStartupIndicator(0);
});

document.getElementById("stopBtn").addEventListener("click", () => {
    haptic([50, 30, 50]);
    isPaused = false;
    ftmsCmd([0x08, 0x01]);
});

document.getElementById("pauseBtn").addEventListener("click", () => {
    if (isRunning && !isPaused) {
        haptic();
        isPaused = true;
        pauseCount++;
        pauseStartTimestamp = Date.now();
        ftmsCmd([0x08, 0x01]);
        setStatus("Pausing…", "bg-yellow-400");
        updateCumulativeStats();
    }
});

document.getElementById("resumeBtn").addEventListener("click", () => {
    if (!isRunning) {
        if (!cFTMSControl) {
            showStartupIndicator(lastSpeed);
            return;
        }
        haptic();
        if (pauseStartTimestamp) {
            totalPauseTime += (Date.now() - pauseStartTimestamp) / 1000;
            pauseStartTimestamp = null;
        }
        isPaused = false;
        updateCumulativeStats();
        pendingResumeSpeed = (programRunning && activeProgram)
            ? activeProgram.steps[programStepIndex].speed
            : lastSpeed;
        ftmsCmd([0x07]);
        showStartupIndicator(pendingResumeSpeed);
    }
});

document.getElementById("speedDownBtn").addEventListener("click", () => {
    haptic(30);
    lastSpeed = Math.max(1.0, Math.round(lastSpeed * 10 - 5) / 10);
    if (programRunning) programUserOverride = true;
    ftmsCmd(ftmsSpeedBytes(lastSpeed));
});

document.getElementById("speedUpBtn").addEventListener("click", () => {
    haptic(30);
    lastSpeed = Math.min(12.0, Math.round(lastSpeed * 10 + 5) / 10);
    if (programRunning) programUserOverride = true;
    ftmsCmd(ftmsSpeedBytes(lastSpeed));
});

function startAndSetSpeed(targetSpeed) {
    if (!isRunning && !cFTMSControl) {
        showStartupIndicator(targetSpeed);
        return;
    }
    haptic(30);
    lastSpeed = targetSpeed;
    if (programRunning) programUserOverride = true;
    if (!isRunning) {
        pendingResumeSpeed = targetSpeed;
        ftmsCmd([0x07]);
        showStartupIndicator(targetSpeed);
    } else {
        ftmsCmd(ftmsSpeedBytes(targetSpeed));
    }
}

// Settings tab switching
document.querySelectorAll(".settings-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        const nextId = `settingsGroup-${btn.dataset.tab}`;
        const current = document.querySelector('[id^="settingsGroup-"]:not(.hidden)');
        const next = document.getElementById(nextId);
        if (current === next) return;

        // Update tab button active state immediately
        document.querySelectorAll(".settings-tab-btn").forEach((b) => {
            b.classList.remove("bg-sporty", "text-white");
            b.classList.add("bg-gray-200", "dark:bg-gray-700", "text-gray-700", "dark:text-gray-300");
        });
        btn.classList.remove("bg-gray-200", "dark:bg-gray-700", "text-gray-700", "dark:text-gray-300");
        btn.classList.add("bg-sporty", "text-white");

        // Fade out current tab, swap invisibly, fade in next tab
        current.style.opacity = "0";
        setTimeout(() => {
            current.classList.add("hidden");
            current.style.opacity = "";
            next.classList.remove("hidden");
            next.style.opacity = "0";
            requestAnimationFrame(() => requestAnimationFrame(() => {
                next.style.opacity = "";
            }));
        }, 150);
    });
});

// Speed presets — reset to defaults
document.getElementById("speedResetDefaultsBtn").addEventListener("click", () => {
    document.getElementById("speedResetConfirm").classList.remove("hidden");
    document.getElementById("speedResetDefaultsBtn").classList.add("hidden");
});
document.getElementById("speedResetCancelBtn").addEventListener("click", () => {
    document.getElementById("speedResetConfirm").classList.add("hidden");
    document.getElementById("speedResetDefaultsBtn").classList.remove("hidden");
});
document.getElementById("speedResetConfirmBtn").addEventListener("click", () => {
    DEFAULT_SPEED_PRESETS.forEach((v, i) => {
        const el = document.getElementById(`speedPreset${i}`);
        if (el) el.value = v;
    });
    localStorage.setItem("wp_speed_presets", JSON.stringify(DEFAULT_SPEED_PRESETS));
    applySpeedPresets(DEFAULT_SPEED_PRESETS);
    document.getElementById("speedResetConfirm").classList.add("hidden");
    document.getElementById("speedResetDefaultsBtn").classList.remove("hidden");
});

// Integrations — clear webhook settings
function showClearConfirm() {
    document.getElementById("integrationsClearConfirm").classList.remove("hidden");
    document.getElementById("integrationsClearConfirm").classList.add("flex");
    document.getElementById("integrationsClearBtn").classList.add("hidden");
}
function hideClearConfirm() {
    document.getElementById("integrationsClearConfirm").classList.add("hidden");
    document.getElementById("integrationsClearConfirm").classList.remove("flex");
    document.getElementById("integrationsClearBtn").classList.remove("hidden");
}
document.getElementById("integrationsClearBtn").addEventListener("click", showClearConfirm);
document.getElementById("integrationsClearCancelBtn").addEventListener("click", hideClearConfirm);
document.getElementById("integrationsClearConfirmBtn").addEventListener("click", () => {
    webhookUrl = "";
    webhookSecret = "";
    document.getElementById("webhookUrlInput").value = "";
    document.getElementById("webhookSecretInput").value = "";
    localStorage.removeItem("wp_webhook_url");
    localStorage.removeItem("wp_webhook_secret");
    hideClearConfirm();
});

// ============================================================
// Integrations — example script generator
// ============================================================
const WEBHOOK_FIELDS = [
    { id: "wf-distance",         key: "distance",         label: "distance (km)",     expr: "s.distance" },
    { id: "wf-calories",         key: "calories",         label: "calories",           expr: "s.calories" },
    { id: "wf-time",             key: "timeSeconds",      label: "timeSeconds",        expr: "s.timeSeconds" },
    { id: "wf-avgSpeed",         key: "avgSpeed",         label: "avgSpeed (km/h)",    expr: "parseFloat(s.avgSpeed.toFixed(2))" },
    { id: "wf-maxSpeed",         key: "maxSpeed",         label: "maxSpeed (km/h)",    expr: "parseFloat(s.maxSpeed.toFixed(1))" },
    { id: "wf-steps",            key: "steps",            label: "steps",              expr: "s.steps" },
    { id: "wf-pace",             key: "pace",             label: "pace (min/km)",      expr: "s.pace" },
    { id: "wf-pauses",           key: "pauseCount",       label: "pauseCount",         expr: "s.pauseCount" },
    { id: "wf-sessionStart",     key: "sessionStart",     label: "sessionStart",       expr: "s.sessionStart" },
    { id: "wf-program",          key: "programName",      label: "program",            expr: "s.programName ?? '—'" },
    { id: "wf-programCompleted", key: "programCompleted", label: "programCompleted",   expr: "s.programName ? (s.programCompleted ? 'Yes' : 'No') : '—'" },
    { id: "wf-pauseTime",        key: "pauseTimeSeconds", label: "pauseTime (s)",      expr: "s.pauseTimeSeconds" },
];

const PAYLOAD_REFERENCE = `{
  "secret":     "string  — shared secret you configured",
  "exportedAt": "string  — ISO 8601 timestamp of the export",

  "session": {
    "distance":         number,  // km, this session
    "calories":         number,
    "timeSeconds":      number,  // active walk time (excludes pauses)
    "maxSpeed":         number,  // km/h
    "avgSpeed":         number,  // km/h (0 if no movement)
    "pace":             number,  // min/km (0 if speed ≤ 0)
    "steps":            number,  // estimated from height
    "pauseCount":       number,
    "pauseTimeSeconds": number,  // seconds spent paused this session
    "sessionStart":     "ISO 8601 | null",  // when belt first started
    "programId":        "string | null",    // program ID if one was active
    "programName":      "string | null",    // program display name
    "programCompleted": boolean             // true if program finished naturally
  },

  "cumulative": {
    "distance":         number,  // all-time totals
    "calories":         number,
    "timeSeconds":      number,
    "maxSpeed":         number,
    "avgSpeed":         number,
    "pace":             number,
    "steps":            number,
    "pauseCount":       number,
    "pauseTimeSeconds": number   // total time spent paused (all-time)
  },

  "sessions": [   // full history — one object per saved session
    {
      "date":             "YYYY-MM-DD",
      "savedAt":          "ISO 8601",
      "sessionStart":     "ISO 8601",
      "distance":         number,
      "calories":         number,
      "timeSeconds":      number,
      "speedSum":         number,
      "speedSamples":     number,
      "maxSpeed":         number,
      "pauses":           number,
      "steps":            number,
      "programId":        "string | null",
      "programName":      "string | null",
      "programCompleted": boolean
    }
  ]
}`;

function getSelectedFields() {
    return WEBHOOK_FIELDS.filter(f => document.getElementById(f.id).checked);
}

function buildGasSnippet(fields) {
    if (fields.length === 0) return "// Select at least one field above to generate a script.";
    const secret = webhookSecret || "your-secret";
    const headers = ["Date", ...fields.map(f => f.label), "Exported At"];
    const rowValues = ["  data.exportedAt.slice(0, 10),", ...fields.map(f => `  ${f.expr},`), "  data.exportedAt,"];
    return `// 1. In Google Apps Script, create a new project and paste this code.
// 2. Deploy > New deployment > Web app
//    Execute as: Me  |  Who has access: Anyone
// 3. Copy the Web App URL into the Webhook URL field above.
// 4. Re-deploy (new version) after any code change.

const SHEET_NAME = "Sessions"; // change to match your sheet
const SECRET     = "${secret}";

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.secret !== SECRET) {
      return respond({ error: "forbidden" });
    }

    const ss    = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(${JSON.stringify(headers)});
    }

    const s = data.session;
    sheet.appendRow([
${rowValues.join("\n")}
    ]);

    return respond({ ok: true });
  } catch (err) {
    return respond({ error: err.message });
  }
}

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}`;
}

function buildZapierSnippet(fields) {
    if (fields.length === 0) return "// Select at least one field above to generate a script.";
    const secret = webhookSecret || "your-secret";
    // Build input-data mapping comment lines and access lines
    const mappingLines = [
        "//   secret      = {{Secret}}",
        "//   exportedAt  = {{Exported At}}",
        ...fields.map(f => `//   ${f.key.padEnd(11)} = {{Session ${f.key.charAt(0).toUpperCase() + f.key.slice(1)}}}`),
    ];
    const outputLines = [
        "  date:       inputData.exportedAt?.slice(0, 10),",
        "  exportedAt: inputData.exportedAt,",
        ...fields.map(f => `  ${f.key.padEnd(11)}: inputData.${f.key},  // ${f.label}`),
    ];
    return `// Zap setup:
// Trigger : Webhooks by Zapier > Catch Hook
//           (paste the hook URL into the Webhook URL field above)
//
// The body is JSON — Zapier exposes every field directly in the UI.
// For most actions (Google Sheets, Notion, etc.) no Code step is needed:
//   just map {{Session Distance}}, {{Session Calories}}, etc. in the action.
//
// If you do need a Code by Zapier step, add these Input Data mappings
// in the step configuration, then use inputData below:
${mappingLines.join("\n")}

const SECRET = "${secret}";

if (inputData.secret !== SECRET) {
  throw new Error("Secret mismatch — request rejected");
}

output = {
${outputLines.join("\n")}
};`;
}

function buildN8nSnippet(fields) {
    if (fields.length === 0) return "// Select at least one field above to generate a script.";
    const secret = webhookSecret || "your-secret";
    const outputLines = [
        '    date:       data.exportedAt.slice(0, 10),',
        '    exportedAt: data.exportedAt,',
        ...fields.map(f => `    ${f.key.padEnd(11)}: s.${f.key},  // ${f.label}`),
    ];
    return `// Workflow setup:
// Node 1: Webhook  — HTTP Method: POST, Response Mode: Last Node
//         (paste the Production URL into the Webhook URL field above)
// Node 2: Code     — paste this JavaScript (Mode: Run Once for Each Item)
//
// Fields are also accessible directly in expressions without a Code node:
//   {{ $json.session.distance }},  {{ $json.session.calories }}, etc.

const SECRET = "${secret}";

const data  = $input.first().json;
const s     = data.session;

if (data.secret !== SECRET) {
  throw new Error("Secret mismatch — request rejected");
}

return [{
  json: {
${outputLines.join("\n")}
  }
}];`;
}

function saveWebhookFieldSelection() {
    const state = {};
    WEBHOOK_FIELDS.forEach(f => { state[f.id] = document.getElementById(f.id).checked; });
    localStorage.setItem("wp_webhook_fields", JSON.stringify(state));
}

// Restore persisted field selection.
// Stored as an object {id: bool} so new fields fall back to the HTML default (checked)
// when not present in a prior save. Old array format is ignored (one-time reset to defaults).
(function restoreWebhookFields() {
    try {
        const saved = JSON.parse(localStorage.getItem("wp_webhook_fields") || "null");
        if (saved && typeof saved === "object" && !Array.isArray(saved)) {
            WEBHOOK_FIELDS.forEach(f => {
                if (f.id in saved) document.getElementById(f.id).checked = saved[f.id];
                // else: not in saved → keep HTML default (checked)
            });
        }
    } catch (_) {}
})();

// Persist selection on change
WEBHOOK_FIELDS.forEach(f => {
    document.getElementById(f.id).addEventListener("change", saveWebhookFieldSelection);
});

// Copy buttons — generate script at click time from current field selection
async function copyWithFeedback(btn, text) {
    try {
        await navigator.clipboard.writeText(text);
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
        setTimeout(() => { btn.innerHTML = orig; }, 2000);
    } catch (err) {
        console.warn("Clipboard write failed:", err);
    }
}

document.getElementById("copy-payload").addEventListener("click", function () {
    copyWithFeedback(this, PAYLOAD_REFERENCE);
});
document.getElementById("copy-gas").addEventListener("click", function () {
    const fields = getSelectedFields();
    copyWithFeedback(this, fields.length ? buildGasSnippet(fields) : "// Select at least one field above.");
});
document.getElementById("copy-zapier").addEventListener("click", function () {
    const fields = getSelectedFields();
    copyWithFeedback(this, fields.length ? buildZapierSnippet(fields) : "// Select at least one field above.");
});
document.getElementById("copy-n8n").addEventListener("click", function () {
    const fields = getSelectedFields();
    copyWithFeedback(this, fields.length ? buildN8nSnippet(fields) : "// Select at least one field above.");
});

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
    document.getElementById("speedResetConfirm").classList.add("hidden");
    document.getElementById("speedResetDefaultsBtn").classList.remove("hidden");
    hideClearConfirm();
});

document.getElementById("goalsBtn").addEventListener("click", () => {
    document.getElementById("goalsModal").classList.remove("hidden");
});

document.getElementById("closeGoalsBtn").addEventListener("click", () => {
    document.getElementById("goalsModal").classList.add("hidden");
});

document.querySelectorAll(".trend-tab-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
        document.querySelectorAll(".trend-tab-btn").forEach((b) => {
            b.classList.remove("bg-sporty", "text-white");
            b.classList.add(
                "bg-gray-200",
                "dark:bg-gray-700",
                "text-gray-700",
                "dark:text-gray-300",
            );
        });
        this.classList.add("bg-sporty", "text-white");
        this.classList.remove(
            "bg-gray-200",
            "dark:bg-gray-700",
            "text-gray-700",
            "dark:text-gray-300",
        );
        // Use inline style so mobile tabs don't conflict with desktop md:block classes
        ["distance", "calories", "speed"].forEach((c) => {
            document.getElementById("trendChartWrap-" + c).style.display =
                c !== this.dataset.chart ? "none" : "";
        });
        const map = {
            distance: wpCharts.distance,
            calories: wpCharts.calories,
            speed: wpCharts.speedHist,
        };
        if (map[this.dataset.chart]) map[this.dataset.chart].resize();
    });
});

document.querySelectorAll(".goal-tab-btn").forEach((btn) => {
    btn.addEventListener("click", function () {
        document.querySelectorAll(".goal-tab-btn").forEach((b) => {
            b.classList.remove("bg-sporty", "text-white");
            b.classList.add(
                "bg-gray-200",
                "dark:bg-gray-700",
                "text-gray-700",
                "dark:text-gray-300",
            );
        });
        this.classList.add("bg-sporty", "text-white");
        this.classList.remove(
            "bg-gray-200",
            "dark:bg-gray-700",
            "text-gray-700",
            "dark:text-gray-300",
        );
        [
            "daily",
            "weekly",
            "monthly",
            "threemonth",
            "sixmonth",
            "yearly",
        ].forEach((tab) => {
            const el = document.getElementById("goalGroup-" + tab);
            if (tab === this.dataset.tab) {
                el.classList.remove("hidden");
                el.classList.add("flex", "flex-col");
            } else {
                el.classList.add("hidden");
                el.classList.remove("flex", "flex-col");
            }
        });
    });
});

[
    "settingsModal",
    "goalsModal",
    "continueModal",
    "recoverModal",
    "clearConfirmModal",
].forEach((id) => {
    document.getElementById(id).addEventListener("click", function (e) {
        if (e.target === this) this.classList.add("hidden");
    });
});

document
    .getElementById("copyForSheetsBtn")
    .addEventListener("click", copyForSheets);

document
    .getElementById("goalActiveDaysSlider")
    .addEventListener("input", function () {
        goalActiveDays = parseInt(this.value);
        localStorage.setItem("wp_goal_active_days", goalActiveDays);
        document.getElementById("goalActiveDaysDisplay").textContent =
            goalActiveDays;
        recalculateGoals();
    });

document
    .getElementById("goalDistanceSlider")
    .addEventListener("input", function () {
        const val = parseFloat(this.value);
        goalDistanceKm = val;
        localStorage.setItem("wp_goal_distance", val);
        document.getElementById("goalDistanceDisplay").textContent =
            val > 0 ? val.toFixed(1) : "—";
        recalculateGoals();
    });

document
    .getElementById("goalTimeSlider")
    .addEventListener("input", function () {
        const mins = parseInt(this.value);
        goalTimeSeconds = mins * 60;
        localStorage.setItem("wp_goal_time_seconds", goalTimeSeconds);
        document.getElementById("goalTimeDisplay").textContent =
            mins > 0 ? mins + ":00" : "—";
        recalculateGoals();
    });

document
    .getElementById("goalWeekDistanceSlider")
    .addEventListener("input", function () {
        autoWeek = false;
        localStorage.setItem("wp_goal_auto_week", false);
        syncAutoUI();
        const val = parseFloat(this.value);
        goalWeekDistanceKm = val;
        localStorage.setItem("wp_goal_week_distance", val);
        document.getElementById("goalWeekDistanceDisplay").textContent =
            val > 0 ? val.toFixed(1) : "—";
        updateGoalProgress();
    });

document
    .getElementById("goalWeekTimeSlider")
    .addEventListener("input", function () {
        autoWeek = false;
        localStorage.setItem("wp_goal_auto_week", false);
        syncAutoUI();
        const mins = parseInt(this.value);
        goalWeekTimeSeconds = mins * 60;
        localStorage.setItem("wp_goal_week_time_seconds", goalWeekTimeSeconds);
        document.getElementById("goalWeekTimeDisplay").textContent =
            mins > 0 ? formatHHMM(goalWeekTimeSeconds) : "—";
        updateGoalProgress();
    });

document
    .getElementById("goalWeekSessionsSlider")
    .addEventListener("input", function () {
        autoWeek = false;
        localStorage.setItem("wp_goal_auto_week", false);
        syncAutoUI();
        goalWeekSessions = parseInt(this.value);
        localStorage.setItem("wp_goal_week_sessions", goalWeekSessions);
        document.getElementById("goalWeekSessionsDisplay").textContent =
            goalWeekSessions;
        updateGoalProgress();
    });

document
    .getElementById("goalMonthDistanceSlider")
    .addEventListener("input", function () {
        autoMonth = false;
        localStorage.setItem("wp_goal_auto_month", false);
        syncAutoUI();
        const val = parseFloat(this.value);
        goalMonthDistanceKm = val;
        localStorage.setItem("wp_goal_month_distance", val);
        document.getElementById("goalMonthDistanceDisplay").textContent =
            val > 0 ? val.toFixed(1) : "—";
        updateGoalProgress();
    });

document
    .getElementById("goalMonthTimeSlider")
    .addEventListener("input", function () {
        autoMonth = false;
        localStorage.setItem("wp_goal_auto_month", false);
        syncAutoUI();
        const mins = parseInt(this.value);
        goalMonthTimeSeconds = mins * 60;
        localStorage.setItem(
            "wp_goal_month_time_seconds",
            goalMonthTimeSeconds,
        );
        document.getElementById("goalMonthTimeDisplay").textContent =
            mins > 0 ? formatHHMM(goalMonthTimeSeconds) : "—";
        updateGoalProgress();
    });

document
    .getElementById("goalDaySessionsSlider")
    .addEventListener("input", function () {
        goalDaySessions = parseInt(this.value);
        localStorage.setItem("wp_goal_day_sessions", goalDaySessions);
        document.getElementById("goalDaySessionsDisplay").textContent =
            goalDaySessions;
        updateGoalProgress();
    });

document
    .getElementById("goalMonthSessionsSlider")
    .addEventListener("input", function () {
        autoMonth = false;
        localStorage.setItem("wp_goal_auto_month", false);
        syncAutoUI();
        goalMonthSessions = parseInt(this.value);
        localStorage.setItem("wp_goal_month_sessions", goalMonthSessions);
        document.getElementById("goalMonthSessionsDisplay").textContent =
            goalMonthSessions;
        updateGoalProgress();
    });

document
    .getElementById("goalThreeMonthDistanceSlider")
    .addEventListener("input", function () {
        autoThreeMonth = false;
        localStorage.setItem("wp_goal_auto_threemonth", false);
        syncAutoUI();
        const val = parseFloat(this.value);
        goalThreeMonthDistanceKm = val;
        localStorage.setItem("wp_goal_threemonth_distance", val);
        document.getElementById("goalThreeMonthDistanceDisplay").textContent =
            val > 0 ? val.toFixed(1) : "—";
        updateGoalProgress();
    });

document
    .getElementById("goalThreeMonthTimeSlider")
    .addEventListener("input", function () {
        autoThreeMonth = false;
        localStorage.setItem("wp_goal_auto_threemonth", false);
        syncAutoUI();
        const mins = parseInt(this.value);
        goalThreeMonthTimeSeconds = mins * 60;
        localStorage.setItem(
            "wp_goal_threemonth_time_seconds",
            goalThreeMonthTimeSeconds,
        );
        document.getElementById("goalThreeMonthTimeDisplay").textContent =
            mins > 0 ? formatHHMM(goalThreeMonthTimeSeconds) : "—";
        updateGoalProgress();
    });

document
    .getElementById("goalSixMonthDistanceSlider")
    .addEventListener("input", function () {
        autoSixMonth = false;
        localStorage.setItem("wp_goal_auto_sixmonth", false);
        syncAutoUI();
        const val = parseFloat(this.value);
        goalSixMonthDistanceKm = val;
        localStorage.setItem("wp_goal_sixmonth_distance", val);
        document.getElementById("goalSixMonthDistanceDisplay").textContent =
            val > 0 ? val.toFixed(1) : "—";
        updateGoalProgress();
    });

document
    .getElementById("goalSixMonthTimeSlider")
    .addEventListener("input", function () {
        autoSixMonth = false;
        localStorage.setItem("wp_goal_auto_sixmonth", false);
        syncAutoUI();
        const mins = parseInt(this.value);
        goalSixMonthTimeSeconds = mins * 60;
        localStorage.setItem(
            "wp_goal_sixmonth_time_seconds",
            goalSixMonthTimeSeconds,
        );
        document.getElementById("goalSixMonthTimeDisplay").textContent =
            mins > 0 ? formatHHMM(goalSixMonthTimeSeconds) : "—";
        updateGoalProgress();
    });

document
    .getElementById("goalYearDistanceSlider")
    .addEventListener("input", function () {
        autoYear = false;
        localStorage.setItem("wp_goal_auto_year", false);
        syncAutoUI();
        const val = parseFloat(this.value);
        goalYearDistanceKm = val;
        localStorage.setItem("wp_goal_year_distance", val);
        document.getElementById("goalYearDistanceDisplay").textContent =
            val > 0 ? val.toFixed(0) : "—";
        updateGoalProgress();
    });

document
    .getElementById("goalYearTimeSlider")
    .addEventListener("input", function () {
        autoYear = false;
        localStorage.setItem("wp_goal_auto_year", false);
        syncAutoUI();
        const mins = parseInt(this.value);
        goalYearTimeSeconds = mins * 60;
        localStorage.setItem("wp_goal_year_time_seconds", goalYearTimeSeconds);
        document.getElementById("goalYearTimeDisplay").textContent =
            mins > 0 ? formatHHMM(goalYearTimeSeconds) : "—";
        updateGoalProgress();
    });

// Per-period auto checkbox listeners
[
    [
        "goalAutoWeek",
        "wp_goal_auto_week",
        (v) => {
            autoWeek = v;
        },
    ],
    [
        "goalAutoMonth",
        "wp_goal_auto_month",
        (v) => {
            autoMonth = v;
        },
    ],
    [
        "goalAutoThreeMonth",
        "wp_goal_auto_threemonth",
        (v) => {
            autoThreeMonth = v;
        },
    ],
    [
        "goalAutoSixMonth",
        "wp_goal_auto_sixmonth",
        (v) => {
            autoSixMonth = v;
        },
    ],
    [
        "goalAutoYear",
        "wp_goal_auto_year",
        (v) => {
            autoYear = v;
        },
    ],
].forEach(([id, storageKey, setFn]) => {
    document.getElementById(id).addEventListener("change", function () {
        setFn(this.checked);
        localStorage.setItem(storageKey, this.checked);
        syncAutoUI();
        if (this.checked) recalculateGoals();
    });
});

document.getElementById("goalResetAllAuto").addEventListener("click", () => {
    autoWeek = autoMonth = autoThreeMonth = autoSixMonth = autoYear = true;
    [
        "wp_goal_auto_week",
        "wp_goal_auto_month",
        "wp_goal_auto_threemonth",
        "wp_goal_auto_sixmonth",
        "wp_goal_auto_year",
    ].forEach((k) => localStorage.setItem(k, true));
    syncAutoUI();
    recalculateGoals();
});

document.querySelectorAll(".live-window-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        liveChartMax = parseInt(btn.dataset.window);
        while (liveSpeedData.length > liveChartMax) {
            liveSpeedData.shift();
            liveSpeedLabels.shift();
        }
        document.querySelectorAll(".live-window-btn").forEach((b) => {
            b.classList.remove("bg-sporty", "text-white");
            b.classList.add(
                "bg-gray-200",
                "dark:bg-gray-700",
                "text-gray-700",
                "dark:text-gray-300",
            );
        });
        btn.classList.remove(
            "bg-gray-200",
            "dark:bg-gray-700",
            "text-gray-700",
            "dark:text-gray-300",
            "hover:bg-sporty",
            "hover:text-white",
        );
        btn.classList.add("bg-sporty", "text-white");
    });
});

document.querySelectorAll(".live-ymax-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
        liveChartYMax = parseInt(btn.dataset.ymax);
        if (wpCharts.liveSpeed) {
            const yScale = wpCharts.liveSpeed.options.scales.y;
            if (liveChartYMax > 0) {
                yScale.max = liveChartYMax;
            } else {
                delete yScale.max;
            }
            wpCharts.liveSpeed.update();
        }
        document.querySelectorAll(".live-ymax-btn").forEach((b) => {
            b.classList.remove("bg-sporty", "text-white");
            b.classList.add(
                "bg-gray-200",
                "dark:bg-gray-700",
                "text-gray-700",
                "dark:text-gray-300",
            );
        });
        btn.classList.remove(
            "bg-gray-200",
            "dark:bg-gray-700",
            "text-gray-700",
            "dark:text-gray-300",
            "hover:bg-sporty",
            "hover:text-white",
        );
        btn.classList.add("bg-sporty", "text-white");
    });
});

// --- Recovery Modal ---
let pendingMergeFn = null;
let pendingReplaceFn = null;

function closeRecoverModal() {
    pendingMergeFn = null;
    pendingReplaceFn = null;
    const modal = document.getElementById("recoverModal");
    modal.classList.add("hidden");
    modal.classList.remove("flex");
}

function showRecoverModal(snapshot, title, onMerge, onReplace) {
    const avgSpeed =
        snapshot.speedSamples > 0
            ? (snapshot.speedSum / snapshot.speedSamples).toFixed(2)
            : "0.00";
    document.getElementById("recoverModalTitle").textContent = title;
    document.getElementById("recoverModalSavedAt").textContent =
        "Saved: " + snapshot.savedAt;
    document.getElementById("recoverModalDistance").textContent =
        snapshot.cumDistance.toFixed(2) + " km";
    document.getElementById("recoverModalCalories").textContent =
        snapshot.cumCalories.toFixed(1) + " kcal";
    document.getElementById("recoverModalTime").textContent = new Date(
        snapshot.cumTimeSeconds * 1000,
    )
        .toISOString()
        .slice(11, 19);
    document.getElementById("recoverModalMaxSpeed").textContent =
        snapshot.maxSpeed.toFixed(1) + " km/h";
    document.getElementById("recoverModalAvgSpeed").textContent =
        avgSpeed + " km/h";
    pendingMergeFn = onMerge;
    pendingReplaceFn = onReplace;
    const modal = document.getElementById("recoverModal");
    modal.classList.remove("hidden");
    modal.classList.add("flex");
}

document
    .getElementById("recoverModalMergeBtn")
    .addEventListener("click", () => {
        if (pendingMergeFn) pendingMergeFn();
        closeRecoverModal();
    });

document
    .getElementById("recoverModalReplaceBtn")
    .addEventListener("click", () => {
        if (pendingReplaceFn) pendingReplaceFn();
        closeRecoverModal();
    });

document
    .getElementById("recoverModalCancelBtn")
    .addEventListener("click", closeRecoverModal);

document.getElementById("recoverSessionBtn").addEventListener("click", () => {
    const snapshot = JSON.parse(
        localStorage.getItem("wp_session_backup") || "null",
    );
    if (!snapshot) return;
    showRecoverModal(
        snapshot,
        "Recover Session",
        recoverSession,
        recoverFromSnapshot.bind(null, snapshot),
    );
});

document.getElementById("recoverExportBtn").addEventListener("click", () => {
    const snapshot = JSON.parse(
        localStorage.getItem("wp_export_snapshot") || "null",
    );
    if (!snapshot) return;
    showRecoverModal(
        snapshot,
        "Restore from Last Export",
        mergeFromSnapshot.bind(null, snapshot),
        recoverFromExport,
    );
});

document.getElementById("historyViewDayBtn").addEventListener("click", () => {
    historyView = "day";
    document
        .getElementById("historyViewDayBtn")
        .classList.add("bg-sporty", "text-white");
    document
        .getElementById("historyViewDayBtn")
        .classList.remove(
            "bg-gray-200",
            "dark:bg-gray-700",
            "text-gray-700",
            "dark:text-gray-300",
            "hover:bg-sporty",
            "hover:text-white",
        );
    document
        .getElementById("historyViewSessionBtn")
        .classList.remove("bg-sporty", "text-white");
    document
        .getElementById("historyViewSessionBtn")
        .classList.add(
            "bg-gray-200",
            "dark:bg-gray-700",
            "text-gray-700",
            "dark:text-gray-300",
            "hover:bg-sporty",
            "hover:text-white",
        );
    renderSessionHistory();
});

document
    .getElementById("historyViewSessionBtn")
    .addEventListener("click", () => {
        historyView = "session";
        document
            .getElementById("historyViewSessionBtn")
            .classList.add("bg-sporty", "text-white");
        document
            .getElementById("historyViewSessionBtn")
            .classList.remove(
                "bg-gray-200",
                "dark:bg-gray-700",
                "text-gray-700",
                "dark:text-gray-300",
                "hover:bg-sporty",
                "hover:text-white",
            );
        document
            .getElementById("historyViewDayBtn")
            .classList.remove("bg-sporty", "text-white");
        document
            .getElementById("historyViewDayBtn")
            .classList.add(
                "bg-gray-200",
                "dark:bg-gray-700",
                "text-gray-700",
                "dark:text-gray-300",
                "hover:bg-sporty",
                "hover:text-white",
            );
        renderSessionHistory();
    });

document.getElementById("clearHistoryBtn").addEventListener("click", () => {
    document.getElementById("clearConfirmCheck").checked = false;
    document.getElementById("clearConfirmOk").disabled = true;
    document.getElementById("clearConfirmModal").classList.remove("hidden");
});

document
    .getElementById("clearConfirmCheck")
    .addEventListener("change", function () {
        document.getElementById("clearConfirmOk").disabled = !this.checked;
    });

document.getElementById("clearConfirmOk").addEventListener("click", () => {
    localStorage.removeItem("wp_sessions");
    document.getElementById("clearConfirmModal").classList.add("hidden");
    renderCharts();
    renderSessionHistory();
});

document.getElementById("clearConfirmCancel").addEventListener("click", () => {
    document.getElementById("clearConfirmModal").classList.add("hidden");
});

document
    .getElementById("saveOnboardingBtn")
    .addEventListener("click", saveOnboarding);

function onHeightUnitChange(newUnit) {
    if (newUnit === userHeightUnit) return;
    // Preserve any value already typed before switching
    if (userHeightUnit === "ftin") {
        const ft = parseInt(document.getElementById("heightFtInput")?.value, 10) || 0;
        const inches = parseInt(document.getElementById("heightInInput")?.value, 10) || 0;
        if (ft > 0) userHeightCm = ftInToCm(ft, inches);
    } else {
        const cm = parseFloat(document.getElementById("heightCmInput")?.value);
        if (cm > 0) userHeightCm = cm;
    }
    userHeightUnit = newUnit;
    applyHeightToSettingsInputs();
    applyHeightToOnboardingInputs();
}

document.getElementById("heightUnitFtIn").addEventListener("click", () => onHeightUnitChange("ftin"));
document.getElementById("heightUnitCm").addEventListener("click", () => onHeightUnitChange("cm"));
document.getElementById("onboardingHeightUnitFtIn").addEventListener("click", () => onHeightUnitChange("ftin"));
document.getElementById("onboardingHeightUnitCm").addEventListener("click", () => onHeightUnitChange("cm"));

// --- Mobile bottom bar ---
document
    .getElementById("startBtnM")
    .addEventListener("click", () =>
        document.getElementById("startBtn").click(),
    );
document
    .getElementById("stopBtnM")
    .addEventListener("click", () =>
        document.getElementById("stopBtn").click(),
    );
document
    .getElementById("pauseBtnM")
    .addEventListener("click", () =>
        document.getElementById("pauseBtn").click(),
    );
document
    .getElementById("resumeBtnM")
    .addEventListener("click", () =>
        document.getElementById("resumeBtn").click(),
    );
document
    .getElementById("speedDownBtnM")
    .addEventListener("click", () =>
        document.getElementById("speedDownBtn").click(),
    );
document
    .getElementById("speedUpBtnM")
    .addEventListener("click", () =>
        document.getElementById("speedUpBtn").click(),
    );
// Preset buttons are wired dynamically via applySpeedPresets() called from loadDefaults()

// ============================================================
// Workout Program Event Listeners
// ============================================================

function openProgramPicker() {
    document.getElementById("card-programs").classList.remove("hidden");
}

document.getElementById("programsBtn").addEventListener("click", () => {
    const card = document.getElementById("card-programs");
    card.classList.toggle("hidden");
});

document.getElementById("programsCloseBtn").addEventListener("click", () => {
    document.getElementById("card-programs").classList.add("hidden");
});

// Browse button in session card state-1
document.getElementById("programBrowseBtn").addEventListener("click", openProgramPicker);

// Change button in session card state-2
document.getElementById("programChangeBtn").addEventListener("click", openProgramPicker);
document.getElementById("programRemoveBtn").addEventListener("click", cancelProgram);

// Start button in session card state-2 — skips warm-up prompt or auto-starts belt+program
document.getElementById("programStartBtn").addEventListener("click", () => {
    if (!activeProgram) return;
    warmupPromptActive = false;
    launchOrQueueProgram(activeProgram.id);
});

document.getElementById("programCancelBtn").addEventListener("click", () => {
    cancelProgram();
});

// Program list click — select (with auto-start + warm-up logic) and close picker
document.getElementById("program-picker-list").addEventListener("click", (e) => {
    const item = e.target.closest(".program-item");
    if (!item) return;
    document.getElementById("card-programs").classList.add("hidden");
    programPickerSelected(item.dataset.id);
});

// Warm-up prompt buttons
document.getElementById("warmupYesBtn").addEventListener("click", () => {
    if (!activeProgram) return;
    const targetId = activeProgram.id;
    launchWarmup(targetId);
});

document.getElementById("warmupSkipBtn").addEventListener("click", () => {
    if (!activeProgram) return;
    warmupPromptActive = false;
    launchOrQueueProgram(activeProgram.id);
});

// Category filter pills (event delegation)
document.getElementById("program-filter-pills").addEventListener("click", (e) => {
    const pill = e.target.closest(".prog-pill");
    if (!pill) return;
    programFilterCategory = pill.dataset.cat;
    renderProgramPicker();
});

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
    const savedProgState = loadProgramState();
    if (savedProgState) {
        offerProgramResume(savedProgState);
    } else {
        const lastPid = localStorage.getItem("wp_last_program_id");
        if (lastPid) selectProgram(lastPid);
        else renderProgramPicker();
    }
    if ("serviceWorker" in navigator)
        navigator.serviceWorker.register("./sw.js");
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && isRunning)
            requestWakeLock();
    });

    // Persist session backup and program state before page unloads
    window.addEventListener("pagehide", () => {
        if (cumDistance > 0 || speedSamples > 0) saveSessionBackup();
        saveProgramState();
    });
    window.addEventListener("beforeunload", () => {
        if (cumDistance > 0 || speedSamples > 0) saveSessionBackup();
        saveProgramState();
    });
    if (window.innerWidth < 768) {
        [
            "liveSpeedContent",
            "historyChartsContent",
            "sessionHistoryContent",
        ].forEach((id) => {
            document.getElementById(id).classList.add("hidden");
        });
        [
            "liveSpeedChevron",
            "historyChartsChevron",
            "sessionHistoryChevron",
        ].forEach((id) => {
            document.getElementById(id).classList.add("rotate-180");
        });
    }
});
