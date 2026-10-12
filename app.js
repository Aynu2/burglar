/* ============================================================
   SENTINEL GUARD — ENTERPRISE INTRUSION MONITORING
   AI-Powered Browser Security — Core Logic
   
   Uses TensorFlow.js COCO-SSD for local person detection.
   All video processing happens on-device in client browser sandbox.
   ============================================================ */

const STATES = Object.freeze({
    DISARMED:            'DISARMED',
    ARMING:              'ARMING',
    ARMED:               'ARMED',
    INTRUSION_COUNTDOWN: 'INTRUSION_COUNTDOWN',
    ALARM:               'ALARM',
});

const EVENT_TYPES = Object.freeze({
    SYSTEM:    'SYSTEM',
    CAMERA:    'CAMERA',
    ARMED:     'ARMED',
    DETECTION: 'DETECTION',
    ALARM:     'ALARM',
    PIN:       'PIN',
    DEMO:      'DEMO',
});

const DEFAULT_SETTINGS = {
    armingCountdown:      5,
    alarmCountdown:       0,
    detectionConfidence:  0.30,
    detectionPersistence: 1,
    alarmVolume:          0.85,
    pin:                  '1234',
    demoMode:             false,
    selectedCamera:       '',
};

const STORAGE_KEY_SETTINGS = 'sba_settings';
const STORAGE_KEY_EVENTS   = 'sba_events';
const DETECTION_INTERVAL_MS = 200;
const COOLDOWN_MS           = 1000;

// Application State
const app = {
    state:    STATES.DISARMED,
    settings: { ...DEFAULT_SETTINGS },

    camera: {
        stream:  null,
        active:  false,
        devices: [],
    },

    detection: {
        model:                null,
        modelLoaded:          false,
        modelLoading:         false,
        running:              false,
        consecutiveDetections: 0,
        lastTriggerTime:      0,
        detectionTimer:       null,
        frameCount:           0,
        fpsTimestamp:          0,
        currentFps:           0,
    },

    alarm: {
        audioContext:  null,
        audioUnlocked: false,
        oscillators:   [],
        gainNode:      null,
        active:        false,
        testTimeout:   null,
    },

    pin: {
        entered:   '',
        maxLength: 8,
    },

    events: [],

    countdown: {
        timer:    null,
        value:    0,
        callback: null,
    },

    demo: {
        active:      false,
        isSimulated: false,
    },
};

// DOM helper
const $ = (id) => document.getElementById(id);

const DOM = {
    // Status banner
    statusBanner: $('status-banner'),
    statusPulse:  $('status-pulse'),
    statusText:   $('status-text'),
    statusDetail: $('status-detail'),

    // Clock
    clock: $('clock'),
    date:  $('date'),

    // Camera
    cameraFeed:        $('camera-feed'),
    detectionCanvas:   $('detection-canvas'),
    cameraPlaceholder: $('camera-placeholder'),
    cameraError:       $('camera-error'),
    cameraErrorTitle:  $('camera-error-title'),
    cameraErrorHint:   $('camera-error-hint'),
    cameraStatusBadge: $('camera-status-badge'),
    liveIndicator:     $('live-indicator'),

    // Camera info
    detectionStatusText: $('detection-status-text'),
    fpsCounter:          $('fps-counter'),
    modelLoadStatus:     $('model-load-status'),

    // Controls
    btnArm:      $('btn-arm'),
    btnDisarm:   $('btn-disarm'),
    btnTest:     $('btn-test'),
    btnDemo:     $('btn-demo'),
    btnSimulate: $('btn-simulate'),
    btnSettings: $('btn-settings'),

    // Info cards
    infoModel:       $('info-model'),
    infoConfidence:  $('info-confidence'),
    infoPersistence: $('info-persistence'),
    infoDemo:        $('info-demo'),

    // Event log
    eventLog:    $('event-log'),
    btnClearLog: $('btn-clear-log'),

    // PIN modal
    pinModal:     $('pin-modal'),
    pinDisplay:   $('pin-display'),
    pinMessage:   $('pin-message'),
    btnPinCancel: $('btn-pin-cancel'),

    // Settings modal
    settingsModal:       $('settings-modal'),
    btnCloseSettingsX:   $('btn-close-settings-x'),
    btnSaveSettings:     $('btn-save-settings'),
    btnCloseSettings:    $('btn-close-settings'),
    settingArmCountdown: $('setting-arming-countdown'),
    settingAlmCountdown: $('setting-alarm-countdown'),
    settingConfidence:   $('setting-confidence'),
    settingPersistence:  $('setting-persistence'),
    settingVolume:       $('setting-volume'),
    settingCurrentPin:   $('setting-current-pin'),
    settingNewPin:       $('setting-new-pin'),
    btnChangePin:        $('btn-change-pin'),
    pinChangeMessage:    $('pin-change-message'),
    settingCameraSelect: $('setting-camera-select'),
    settingDemoToggle:   $('setting-demo-toggle'),
    btnSoundTest:        $('btn-sound-test'),
    confidenceLabel:     $('confidence-value-label'),
    volumeLabel:         $('volume-value-label'),

    // Countdown overlay
    countdownOverlay:  $('countdown-overlay'),
    countdownTitle:    $('countdown-title'),
    countdownNumber:   $('countdown-number'),
    countdownSubtitle: $('countdown-subtitle'),

    // Intrusion overlay
    intrusionOverlay:   $('intrusion-overlay'),
    intrusionSubtitle:  $('intrusion-subtitle'),
    btnIntrusionDisarm: $('btn-intrusion-disarm'),
    intrusionDemoLabel: $('intrusion-demo-label'),

    // Audio init
    audioInitOverlay: $('audio-init-overlay'),
    btnEnableAudio:   $('btn-enable-audio'),
};

// ──────────────────────────────────────────────
//  SETTINGS MANAGEMENT
// ──────────────────────────────────────────────
function loadSettings() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY_SETTINGS);
        if (stored) {
            const parsed = JSON.parse(stored);
            app.settings = { ...DEFAULT_SETTINGS, ...parsed };
            // Ensure responsive defaults
            if (app.settings.detectionConfidence > 0.40) app.settings.detectionConfidence = 0.30;
            if (app.settings.detectionPersistence > 2) app.settings.detectionPersistence = 1;
        } else {
            app.settings = { ...DEFAULT_SETTINGS };
        }
    } catch (e) {
        console.warn('Failed to load settings:', e);
        app.settings = { ...DEFAULT_SETTINGS };
    }
    app.demo.active = app.settings.demoMode;
}

function saveSettings() {
    try {
        localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(app.settings));
    } catch (e) {
        console.warn('Failed to save settings:', e);
    }
}

function populateSettingsUI() {
    if (DOM.settingArmCountdown) DOM.settingArmCountdown.value = app.settings.armingCountdown;
    if (DOM.settingAlmCountdown) DOM.settingAlmCountdown.value = app.settings.alarmCountdown;
    DOM.settingConfidence.value   = Math.round(app.settings.detectionConfidence * 100);
    DOM.settingPersistence.value  = app.settings.detectionPersistence;
    DOM.settingVolume.value       = Math.round(app.settings.alarmVolume * 100);
    if (DOM.settingDemoToggle) DOM.settingDemoToggle.checked = app.settings.demoMode;
    DOM.confidenceLabel.textContent = Math.round(app.settings.detectionConfidence * 100) + '%';
    DOM.volumeLabel.textContent     = Math.round(app.settings.alarmVolume * 100) + '%';
}

function applySettingsFromUI() {
    const armC = DOM.settingArmCountdown ? parseInt(DOM.settingArmCountdown.value, 10) : 5;
    const almC = DOM.settingAlmCountdown ? parseInt(DOM.settingAlmCountdown.value, 10) : 0;
    const conf = parseInt(DOM.settingConfidence.value, 10);
    const pers = parseInt(DOM.settingPersistence.value, 10);
    const vol  = parseInt(DOM.settingVolume.value, 10);
    const demo = DOM.settingDemoToggle ? DOM.settingDemoToggle.checked : false;
    const cam  = DOM.settingCameraSelect.value;

    app.settings.armingCountdown      = clamp(armC, 1, 30);
    app.settings.alarmCountdown       = clamp(almC, 0, 30);
    app.settings.detectionConfidence  = clamp(conf, 15, 95) / 100;
    app.settings.detectionPersistence = clamp(pers, 1, 20);
    app.settings.alarmVolume          = clamp(vol, 0, 100) / 100;
    app.settings.demoMode             = demo;
    app.settings.selectedCamera       = cam;

    if (demo !== app.demo.active) {
        toggleDemoMode(demo);
    }

    saveSettings();
    updateInfoCards();
    logEvent(EVENT_TYPES.SYSTEM, 'Configuration settings updated');
}

function clamp(val, min, max) {
    if (isNaN(val)) return min;
    return Math.max(min, Math.min(max, val));
}

// ──────────────────────────────────────────────
//  AUDIT EVENT LOG
// ──────────────────────────────────────────────
function logEvent(type, description) {
    const now = new Date();
    const event = {
        time: now.toLocaleTimeString('en-US', { hour12: false }),
        timestamp: now.getTime(),
        type,
        description,
    };
    app.events.unshift(event);
    if (app.events.length > 200) app.events.pop();
    renderEventLog();
    saveEvents();
}

function renderEventLog() {
    if (app.events.length === 0) {
        DOM.eventLog.innerHTML = '<div class="event-log-empty">Audit log empty. All system activities will be recorded here.</div>';
        return;
    }

    const typeClassMap = {
        [EVENT_TYPES.SYSTEM]:    'event-type-system',
        [EVENT_TYPES.CAMERA]:    'event-type-camera',
        [EVENT_TYPES.ARMED]:     'event-type-armed',
        [EVENT_TYPES.DETECTION]: 'event-type-detection',
        [EVENT_TYPES.ALARM]:     'event-type-alarm',
        [EVENT_TYPES.PIN]:       'event-type-pin',
        [EVENT_TYPES.DEMO]:      'event-type-demo',
    };

    const html = app.events.map(ev => `
        <div class="event-item">
            <span class="event-time">${ev.time}</span>
            <span class="event-type-badge ${typeClassMap[ev.type] || 'event-type-system'}">${ev.type}</span>
            <span class="event-description">${ev.description}</span>
        </div>
    `).join('');

    DOM.eventLog.innerHTML = html;
}

function clearEventLog() {
    app.events = [];
    renderEventLog();
    try { localStorage.removeItem(STORAGE_KEY_EVENTS); } catch (e) {}
}

function saveEvents() {
    try {
        const toSave = app.events.slice(0, 100);
        localStorage.setItem(STORAGE_KEY_EVENTS, JSON.stringify(toSave));
    } catch (e) {}
}

function loadEvents() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY_EVENTS);
        if (stored) {
            app.events = JSON.parse(stored);
            renderEventLog();
        }
    } catch (e) {}
}

// ──────────────────────────────────────────────
//  CLOCK
// ──────────────────────────────────────────────
function updateClock() {
    const now = new Date();
    DOM.clock.textContent = now.toLocaleTimeString('en-US', { hour12: false });
    DOM.date.textContent  = now.toLocaleDateString('en-US', {
        weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
    }).toUpperCase();
}

// ──────────────────────────────────────────────
//  CAMERA MANAGEMENT
// ──────────────────────────────────────────────
async function startCamera() {
    if (app.camera.active) return true;

    try {
        const constraints = { video: true, audio: false };
        if (app.settings.selectedCamera) {
            constraints.video = { deviceId: { exact: app.settings.selectedCamera } };
        }

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        app.camera.stream = stream;
        DOM.cameraFeed.srcObject = stream;

        await new Promise((resolve) => {
            DOM.cameraFeed.onloadedmetadata = () => {
                DOM.cameraFeed.play();
                resolve();
            };
        });

        app.camera.active = true;

        DOM.detectionCanvas.width  = DOM.cameraFeed.videoWidth;
        DOM.detectionCanvas.height = DOM.cameraFeed.videoHeight;

        DOM.cameraPlaceholder.classList.add('hidden');
        DOM.cameraError.classList.add('hidden');
        DOM.liveIndicator.classList.remove('hidden');
        DOM.cameraStatusBadge.textContent = 'ONLINE';
        DOM.cameraStatusBadge.className = 'badge badge-online';

        logEvent(EVENT_TYPES.CAMERA, 'Video stream initialized (CAM-01)');
        await enumerateCameras();

        // Also auto-start detection if armed & model loaded
        if (app.state === STATES.ARMED && app.detection.modelLoaded) {
            startDetection();
        }

        return true;
    } catch (err) {
        console.error('Camera error:', err);
        app.camera.active = false;

        DOM.cameraPlaceholder.classList.add('hidden');
        DOM.cameraError.classList.remove('hidden');

        if (err.name === 'NotAllowedError') {
            DOM.cameraErrorTitle.textContent = 'Camera Access Denied';
            DOM.cameraErrorHint.innerHTML =
                'Permission requested for video stream was denied by browser settings.<br>' +
                'Grant camera permission and reload the application.';
        } else if (err.name === 'NotFoundError') {
            DOM.cameraErrorTitle.textContent = 'No Device Detected';
            DOM.cameraErrorHint.innerHTML =
                'No compatible webcam device was detected.<br>' +
                'Connect a video input device and reload.';
        } else {
            DOM.cameraErrorTitle.textContent = 'Device Fault';
            DOM.cameraErrorHint.innerHTML =
                `Camera initialize failure: ${err.message}<br>` +
                'Ensure camera is not in use by another software.';
        }

        DOM.cameraStatusBadge.textContent = 'OFFLINE';
        DOM.cameraStatusBadge.className = 'badge badge-offline';

        logEvent(EVENT_TYPES.CAMERA, `Camera fault: ${err.message}`);
        return false;
    }
}

function stopCamera() {
    if (app.camera.stream) {
        app.camera.stream.getTracks().forEach(track => track.stop());
        app.camera.stream = null;
    }
    app.camera.active = false;
    DOM.cameraFeed.srcObject = null;
    DOM.cameraPlaceholder.classList.remove('hidden');
    DOM.cameraError.classList.add('hidden');
    DOM.liveIndicator.classList.add('hidden');
    DOM.cameraStatusBadge.textContent = 'OFFLINE';
    DOM.cameraStatusBadge.className = 'badge badge-offline';

    const ctx = DOM.detectionCanvas.getContext('2d');
    ctx.clearRect(0, 0, DOM.detectionCanvas.width, DOM.detectionCanvas.height);

    logEvent(EVENT_TYPES.CAMERA, 'Video stream terminated');
}

async function enumerateCameras() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        app.camera.devices = devices.filter(d => d.kind === 'videoinput');

        DOM.settingCameraSelect.innerHTML = '<option value="">Default Camera Device</option>';
        app.camera.devices.forEach((dev, i) => {
            const opt = document.createElement('option');
            opt.value = dev.deviceId;
            opt.textContent = dev.label || `Camera Input ${i + 1}`;
            if (dev.deviceId === app.settings.selectedCamera) opt.selected = true;
            DOM.settingCameraSelect.appendChild(opt);
        });
    } catch (e) {
        console.warn('Could not enumerate video devices:', e);
    }
}

// ──────────────────────────────────────────────
//  PERSON DETECTION (TensorFlow.js COCO-SSD)
// ──────────────────────────────────────────────
async function loadDetectionModel() {
    if (app.detection.modelLoaded || app.detection.modelLoading) return;
    app.detection.modelLoading = true;

    DOM.modelLoadStatus.textContent = 'Model: Initializing...';
    DOM.infoModel.textContent = 'Loading...';
    DOM.infoModel.className = 'info-card-value';
    logEvent(EVENT_TYPES.SYSTEM, 'Initializing neural detection model (COCO-SSD)...');

    try {
        if (typeof cocoSsd === 'undefined') {
            throw new Error('Neural network library not available in global runtime scope');
        }

        app.detection.model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
        app.detection.modelLoaded = true;
        app.detection.modelLoading = false;

        DOM.modelLoadStatus.textContent = 'Model: Ready';
        DOM.infoModel.textContent = 'COCO-SSD Lite';
        DOM.infoModel.className = 'info-card-value value-loaded';
        logEvent(EVENT_TYPES.SYSTEM, 'Vision model compiled and ready');

        if (app.state === STATES.ARMED && app.camera.active) {
            startDetection();
        }
    } catch (err) {
        console.error('Model load error:', err);
        app.detection.modelLoading = false;
        DOM.modelLoadStatus.textContent = 'Model: Failed';
        DOM.infoModel.textContent = 'Failed';
        DOM.infoModel.className = 'info-card-value';
        logEvent(EVENT_TYPES.SYSTEM, `Vision model failed to initialize: ${err.message}`);
    }
}

function startDetection() {
    if (app.detection.running) return;
    if (!app.detection.modelLoaded) {
        DOM.detectionStatusText.textContent = 'Analytics: Model uninitialized';
        return;
    }
    if (!app.camera.active) {
        DOM.detectionStatusText.textContent = 'Analytics: No video stream';
        return;
    }

    app.detection.running = true;
    app.detection.consecutiveDetections = 0;
    app.detection.frameCount = 0;
    app.detection.fpsTimestamp = performance.now();
    DOM.detectionStatusText.textContent = 'Analytics: Active Monitoring';

    logEvent(EVENT_TYPES.SYSTEM, 'Target object recognition loop started');
    runDetectionLoop();
}

function stopDetection() {
    app.detection.running = false;
    app.detection.consecutiveDetections = 0;
    if (app.detection.detectionTimer) {
        clearTimeout(app.detection.detectionTimer);
        app.detection.detectionTimer = null;
    }
    DOM.detectionStatusText.textContent = 'Analytics: Standby';

    const ctx = DOM.detectionCanvas.getContext('2d');
    ctx.clearRect(0, 0, DOM.detectionCanvas.width, DOM.detectionCanvas.height);
}

function runDetectionLoop() {
    if (!app.detection.running) return;

    app.detection.detectionTimer = setTimeout(async () => {
        if (!app.detection.running) return;

        try {
            await detectFrame();
        } catch (e) {
            console.warn('Detection frame error:', e);
        }

        app.detection.frameCount++;
        const elapsed = performance.now() - app.detection.fpsTimestamp;
        if (elapsed >= 1000) {
            app.detection.currentFps = Math.round(
                (app.detection.frameCount / elapsed) * 1000
            );
            DOM.fpsCounter.textContent = `FPS: ${app.detection.currentFps}`;
            app.detection.frameCount = 0;
            app.detection.fpsTimestamp = performance.now();
        }

        runDetectionLoop();
    }, DETECTION_INTERVAL_MS);
}

async function detectFrame() {
    if (!app.detection.model || !app.camera.active) return;
    if (DOM.cameraFeed.readyState < 2) return;

    const predictions = await app.detection.model.detect(DOM.cameraFeed);

    // Filter for persons (class 'person') above confidence threshold
    const persons = predictions.filter(
        p => (p.class === 'person' || p.class === 'human') && p.score >= app.settings.detectionConfidence
    );

    drawDetections(persons);

    if (predictions.length > 0) {
        const topPred = predictions[0];
        if (persons.length > 0) {
            DOM.detectionStatusText.textContent = `Target: Person (${Math.round(persons[0].score * 100)}%)`;
        } else {
            DOM.detectionStatusText.textContent = `Scanning... (${topPred.class} ${Math.round(topPred.score * 100)}%)`;
        }
    } else {
        DOM.detectionStatusText.textContent = 'Analytics: Active Monitoring';
    }

    if (app.state === STATES.ARMED) {
        if (persons.length > 0) {
            app.detection.consecutiveDetections++;

            if (app.detection.consecutiveDetections >= app.settings.detectionPersistence) {
                const now = Date.now();
                if (now - app.detection.lastTriggerTime > COOLDOWN_MS) {
                    app.detection.lastTriggerTime = now;
                    logEvent(EVENT_TYPES.DETECTION, `Target identified: Person (${Math.round(persons[0].score * 100)}%)`);
                    logEvent(EVENT_TYPES.ALARM, 'Intrusion verified — activating alarm siren');
                    triggerIntrusionCountdown(false);
                }
            }
        } else {
            if (app.detection.consecutiveDetections > 0) {
                app.detection.consecutiveDetections = Math.max(
                    0,
                    app.detection.consecutiveDetections - 1
                );
            }
        }
    }
}

function drawDetections(persons) {
    const canvas = DOM.detectionCanvas;
    const ctx = canvas.getContext('2d');

    if (canvas.width !== DOM.cameraFeed.videoWidth) {
        canvas.width  = DOM.cameraFeed.videoWidth;
        canvas.height = DOM.cameraFeed.videoHeight;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    persons.forEach(p => {
        const [x, y, w, h] = p.bbox;
        const confidence = Math.round(p.score * 100);

        ctx.strokeStyle = app.state === STATES.ARMED ? '#ef4444' : '#10b981';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        // Reticle corners
        const cornerSize = Math.min(w, h, 20);
        ctx.lineWidth = 3;
        // Top Left
        ctx.beginPath();
        ctx.moveTo(x, y + cornerSize); ctx.lineTo(x, y); ctx.lineTo(x + cornerSize, y);
        ctx.stroke();
        // Top Right
        ctx.beginPath();
        ctx.moveTo(x + w - cornerSize, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + cornerSize);
        ctx.stroke();
        // Bottom Left
        ctx.beginPath();
        ctx.moveTo(x, y + h - cornerSize); ctx.lineTo(x, y + h); ctx.lineTo(x + cornerSize, y + h);
        ctx.stroke();
        // Bottom Right
        ctx.beginPath();
        ctx.moveTo(x + w - cornerSize, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - cornerSize);
        ctx.stroke();

        const label = `PERSON [${confidence}%]`;
        ctx.font = '600 12px "JetBrains Mono", monospace';
        const textWidth = ctx.measureText(label).width;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillRect(x, y - 22, textWidth + 12, 22);

        ctx.fillStyle = '#090d16';
        ctx.fillText(label, x + 6, y - 6);
    });
}

// ──────────────────────────────────────────────
//  ALARM SYNTHESIZER
// ──────────────────────────────────────────────
function initAudioContext() {
    if (app.alarm.audioContext) return;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        app.alarm.audioContext = new AudioCtx();
        app.alarm.audioUnlocked = true;
    } catch (e) {
        console.error('AudioContext init failed:', e);
    }
}

async function unlockAudio() {
    initAudioContext();
    const ctx = app.alarm.audioContext;
    if (!ctx) return;

    if (ctx.state === 'suspended') {
        try {
            await ctx.resume();
        } catch (e) {
            console.warn('Audio resume failed:', e);
        }
    }

    try {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.001;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.05);
        app.alarm.audioUnlocked = true;
    } catch (e) {
        console.warn('Audio unlock failed:', e);
    }
}

async function startAlarmSound() {
    if (app.alarm.active) return;
    await unlockAudio();

    const ctx = app.alarm.audioContext;
    if (!ctx) return;

    if (ctx.state === 'suspended') {
        try { await ctx.resume(); } catch (e) {}
    }

    app.alarm.gainNode = ctx.createGain();
    const targetVol = Math.max(0.1, app.settings.alarmVolume);
    app.alarm.gainNode.gain.setValueAtTime(targetVol, ctx.currentTime);
    app.alarm.gainNode.connect(ctx.destination);

    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(850, ctx.currentTime);

    const osc2 = ctx.createOscillator();
    osc2.type = 'square';
    osc2.frequency.setValueAtTime(1150, ctx.currentTime);

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(3, ctx.currentTime);

    const lfoGain1 = ctx.createGain();
    lfoGain1.gain.setValueAtTime(400, ctx.currentTime);
    lfo.connect(lfoGain1);
    lfoGain1.connect(osc1.frequency);

    const lfoGain2 = ctx.createGain();
    lfoGain2.gain.setValueAtTime(500, ctx.currentTime);
    lfo.connect(lfoGain2);
    lfoGain2.connect(osc2.frequency);

    const gain1 = ctx.createGain();
    gain1.gain.setValueAtTime(0.6, ctx.currentTime);

    const gain2 = ctx.createGain();
    gain2.gain.setValueAtTime(0.3, ctx.currentTime);

    osc1.connect(gain1);
    gain1.connect(app.alarm.gainNode);

    osc2.connect(gain2);
    gain2.connect(app.alarm.gainNode);

    osc1.start();
    osc2.start();
    lfo.start();

    app.alarm.oscillators = [osc1, osc2, lfo];
    app.alarm.active = true;
}

function stopAlarmSound() {
    if (!app.alarm.active) return;

    app.alarm.oscillators.forEach(osc => {
        try { osc.stop(); } catch (e) {}
    });
    app.alarm.oscillators = [];

    if (app.alarm.gainNode) {
        try { app.alarm.gainNode.disconnect(); } catch (e) {}
        app.alarm.gainNode = null;
    }

    app.alarm.active = false;
}

async function testAlarmSound() {
    if (app.alarm.testTimeout) {
        clearTimeout(app.alarm.testTimeout);
        stopAlarmSound();
        app.alarm.testTimeout = null;
        return;
    }

    await unlockAudio();
    await startAlarmSound();
    logEvent(EVENT_TYPES.SYSTEM, 'Audio siren diagnostic test started');

    app.alarm.testTimeout = setTimeout(() => {
        stopAlarmSound();
        app.alarm.testTimeout = null;
        logEvent(EVENT_TYPES.SYSTEM, 'Audio siren diagnostic test completed');
    }, 3000);
}

// ──────────────────────────────────────────────
//  STATE MACHINE
// ──────────────────────────────────────────────
function transitionTo(newState) {
    app.state = newState;
    updateStatusBanner();
    updateButtons();
    updateBodyState();
}

function updateStatusBanner() {
    const banner = DOM.statusBanner;
    banner.className = 'status-banner';

    switch (app.state) {
        case STATES.DISARMED:
            banner.classList.add('status-disarmed');
            DOM.statusText.textContent = 'SYSTEM DISARMED';
            DOM.statusDetail.textContent = 'System standby — press ARM SYSTEM to begin monitoring';
            break;

        case STATES.ARMING:
            banner.classList.add('status-arming');
            DOM.statusText.textContent = 'SECURITY SYSTEM ARMING';
            DOM.statusDetail.textContent = 'Countdown in progress — please clear the monitored area';
            break;

        case STATES.ARMED:
            banner.classList.add('status-armed');
            DOM.statusText.textContent = 'SYSTEM ARMED — ACTIVE MONITORING';
            DOM.statusDetail.textContent = 'Camera active — scanning for intrusion targets';
            break;

        case STATES.INTRUSION_COUNTDOWN:
            banner.classList.add('status-alarm');
            DOM.statusText.textContent = 'INTRUSION DETECTED';
            DOM.statusDetail.textContent = 'Alarm countdown in progress';
            break;

        case STATES.ALARM:
            banner.classList.add('status-alarm');
            DOM.statusText.textContent = 'INTRUSION ALERT — ALARM ACTIVE';
            DOM.statusDetail.textContent = 'Security breach detected — Enter passcode to disarm';
            break;
    }
}

function updateButtons() {
    const s = app.state;

    DOM.btnArm.disabled      = s !== STATES.DISARMED;
    DOM.btnDisarm.disabled   = (s === STATES.DISARMED || s === STATES.ARMING);
    DOM.btnTest.disabled     = (s === STATES.ALARM || s === STATES.INTRUSION_COUNTDOWN);
    DOM.btnSettings.disabled = (s === STATES.ALARM || s === STATES.INTRUSION_COUNTDOWN || s === STATES.ARMING);

    if (DOM.btnSimulate) {
        if (app.demo.active && (s === STATES.ARMED || s === STATES.DISARMED)) {
            DOM.btnSimulate.classList.remove('hidden');
            DOM.btnSimulate.disabled = (s !== STATES.ARMED);
        } else {
            DOM.btnSimulate.classList.add('hidden');
        }
    }
}

function updateBodyState() {
    document.body.classList.toggle('alarm-active',
        app.state === STATES.ALARM || app.state === STATES.INTRUSION_COUNTDOWN
    );
}

// ──────────────────────────────────────────────
//  ARM / DISARM WORKFLOWS
// ──────────────────────────────────────────────
async function armSystem() {
    if (app.state !== STATES.DISARMED) return;

    // Reset detection counters & cooldown on fresh arm
    app.detection.lastTriggerTime = 0;
    app.detection.consecutiveDetections = 0;

    await unlockAudio();
    transitionTo(STATES.ARMING);
    logEvent(EVENT_TYPES.ARMED, 'Arming sequence initiated');

    if (!app.camera.active) {
        const ok = await startCamera();
        if (!ok) {
            transitionTo(STATES.DISARMED);
            logEvent(EVENT_TYPES.SYSTEM, 'Arming aborted — video device unavailable');
            return;
        }
    }

    if (!app.detection.modelLoaded && !app.demo.active) {
        await loadDetectionModel();
    }

    showCountdown('SECURITY SYSTEM ARMING', 'Please clear the monitored zone',
        app.settings.armingCountdown, false, () => {
            transitionTo(STATES.ARMED);
            logEvent(EVENT_TYPES.ARMED, 'System ARMED — intrusion monitoring active');

            // Force detection start
            startDetection();
        }
    );
}

function requestDisarm() {
    if (app.state === STATES.DISARMED || app.state === STATES.ARMING) return;
    showPinModal();
}

function disarmSystem() {
    stopAlarmSound();
    stopDetection();
    app.detection.consecutiveDetections = 0;
    app.detection.lastTriggerTime = 0;

    DOM.intrusionOverlay.classList.add('hidden');
    cancelCountdown();

    app.demo.isSimulated = false;

    transitionTo(STATES.DISARMED);
    logEvent(EVENT_TYPES.ARMED, 'System DISARMED');
}

// ──────────────────────────────────────────────
//  INTRUSION / ALARM CASCADE
// ──────────────────────────────────────────────
function triggerIntrusionCountdown(isDemo) {
    if (app.state !== STATES.ARMED) return;

    app.demo.isSimulated = isDemo;

    if (app.settings.alarmCountdown <= 0) {
        activateAlarm(isDemo);
    } else {
        transitionTo(STATES.INTRUSION_COUNTDOWN);

        const prefix = isDemo ? '[SIMULATION] ' : '';
        logEvent(isDemo ? EVENT_TYPES.DEMO : EVENT_TYPES.ALARM,
            `${prefix}Target detected — intrusion confirmation timer started`);

        showCountdown('INTRUSION DETECTED', 'Alarm activating in...',
            app.settings.alarmCountdown, true, () => {
                activateAlarm(isDemo);
            }
        );
    }
}

async function activateAlarm(isDemo) {
    transitionTo(STATES.ALARM);

    const prefix = isDemo ? '[SIMULATION] ' : '';
    logEvent(isDemo ? EVENT_TYPES.DEMO : EVENT_TYPES.ALARM,
        `${prefix}ALARM ACTIVATED — Siren engaged`);

    DOM.intrusionOverlay.classList.remove('hidden');
    if (DOM.intrusionDemoLabel) {
        DOM.intrusionDemoLabel.classList.toggle('hidden', !isDemo);
    }

    if (isDemo) {
        DOM.intrusionSubtitle.textContent = 'SIMULATION — ALARM ACTIVE — ENTER PASSCODE TO DISARM';
    } else {
        DOM.intrusionSubtitle.textContent = 'SECURITY ALARM ACTIVE — ENTER PASSCODE TO DISARM';
    }

    await startAlarmSound();
}

// ──────────────────────────────────────────────
//  COUNTDOWN ENGINE
// ──────────────────────────────────────────────
function showCountdown(title, subtitle, seconds, isIntrusion, onComplete) {
    cancelCountdown();

    if (DOM.countdownTitle) DOM.countdownTitle.textContent = title;
    if (DOM.countdownSubtitle) DOM.countdownSubtitle.textContent = subtitle;
    if (DOM.countdownNumber) {
        DOM.countdownNumber.textContent = seconds;
        DOM.countdownNumber.classList.toggle('countdown-intrusion', isIntrusion);
    }
    if (DOM.countdownOverlay) DOM.countdownOverlay.classList.remove('hidden');

    app.countdown.value    = seconds;
    app.countdown.callback = onComplete;

    logEvent(EVENT_TYPES.SYSTEM, `Timer started: ${seconds} seconds`);

    app.countdown.timer = setInterval(() => {
        app.countdown.value--;
        if (DOM.countdownNumber) DOM.countdownNumber.textContent = app.countdown.value;

        if (app.countdown.value <= 0) {
            clearInterval(app.countdown.timer);
            app.countdown.timer = null;
            if (DOM.countdownOverlay) DOM.countdownOverlay.classList.add('hidden');

            if (app.countdown.callback) {
                app.countdown.callback();
                app.countdown.callback = null;
            }
        }
    }, 1000);
}

function cancelCountdown() {
    if (app.countdown.timer) {
        clearInterval(app.countdown.timer);
        app.countdown.timer = null;
    }
    if (DOM.countdownOverlay) DOM.countdownOverlay.classList.add('hidden');
    app.countdown.callback = null;
}

// ──────────────────────────────────────────────
//  SIMULATION / DEMO MODE
// ──────────────────────────────────────────────
function toggleDemoMode(enable) {
    const newState = (enable !== undefined) ? enable : !app.demo.active;
    app.demo.active = newState;
    app.settings.demoMode = newState;
    saveSettings();

    if (DOM.btnDemo) DOM.btnDemo.classList.toggle('active', newState);
    if (DOM.infoDemo) {
        DOM.infoDemo.textContent = newState ? 'ENABLED' : 'DISABLED';
        DOM.infoDemo.className = newState
            ? 'info-card-value value-on'
            : 'info-card-value value-off';
    }

    if (newState) {
        logEvent(EVENT_TYPES.DEMO, 'Simulation engine ENABLED');
    } else {
        logEvent(EVENT_TYPES.DEMO, 'Simulation engine disabled');
        if (DOM.btnSimulate) DOM.btnSimulate.classList.add('hidden');
    }

    updateButtons();
}

function simulateIntrusion() {
    if (!app.demo.active) return;
    if (app.state !== STATES.ARMED) {
        logEvent(EVENT_TYPES.DEMO, 'Simulation request rejected — system must be armed');
        return;
    }

    logEvent(EVENT_TYPES.DEMO, 'SIMULATION: Target detection signal injected');
    triggerIntrusionCountdown(true);
}

// ──────────────────────────────────────────────
//  PASSCODE AUTHENTICATION
// ──────────────────────────────────────────────
function showPinModal() {
    app.pin.entered = '';
    updatePinDisplay();
    DOM.pinMessage.textContent = '';
    DOM.pinMessage.className = 'pin-message';
    DOM.pinModal.classList.remove('hidden');

    DOM.btnPinCancel.classList.toggle('hidden', app.state === STATES.ALARM);
}

function hidePinModal() {
    DOM.pinModal.classList.add('hidden');
    app.pin.entered = '';
    updatePinDisplay();
}

function handlePinKey(key) {
    if (key === 'clear') {
        app.pin.entered = '';
        DOM.pinMessage.textContent = '';
        DOM.pinMessage.className = 'pin-message';
        updatePinDisplay();
        return;
    }

    if (key === 'enter') {
        verifyPin();
        return;
    }

    if (app.pin.entered.length < app.pin.maxLength) {
        app.pin.entered += key;
        updatePinDisplay();

        if (app.pin.entered.length >= app.settings.pin.length) {
            setTimeout(() => verifyPin(), 200);
        }
    }
}

function updatePinDisplay() {
    const pinLen = Math.max(app.settings.pin.length, 4);
    const existingDots = DOM.pinDisplay.querySelectorAll('.pin-dot');
    if (existingDots.length !== pinLen) {
        DOM.pinDisplay.innerHTML = '';
        for (let i = 0; i < pinLen; i++) {
            const dot = document.createElement('span');
            dot.className = 'pin-dot';
            DOM.pinDisplay.appendChild(dot);
        }
    }

    const updatedDots = DOM.pinDisplay.querySelectorAll('.pin-dot');
    updatedDots.forEach((dot, i) => {
        dot.classList.toggle('filled', i < app.pin.entered.length);
    });
}

function verifyPin() {
    if (app.pin.entered === app.settings.pin) {
        DOM.pinMessage.textContent = 'ACCESS GRANTED';
        DOM.pinMessage.className = 'pin-message success';
        logEvent(EVENT_TYPES.PIN, 'Authentication successful — passcode verified');

        setTimeout(() => {
            hidePinModal();
            disarmSystem();
        }, 800);
    } else {
        DOM.pinMessage.textContent = 'INVALID PASSCODE';
        DOM.pinMessage.className = 'pin-message error';
        logEvent(EVENT_TYPES.PIN, 'Authentication failed — invalid passcode entered');

        app.pin.entered = '';
        setTimeout(() => updatePinDisplay(), 400);
    }
}

// ──────────────────────────────────────────────
//  INFO DISPLAY
// ──────────────────────────────────────────────
function updateInfoCards() {
    DOM.infoConfidence.textContent  = Math.round(app.settings.detectionConfidence * 100) + '%';
    DOM.infoPersistence.textContent = app.settings.detectionPersistence + ' frames';
    if (DOM.infoDemo) {
        DOM.infoDemo.textContent = app.demo.active ? 'ENABLED' : 'DISABLED';
        DOM.infoDemo.className   = app.demo.active
            ? 'info-card-value value-on'
            : 'info-card-value value-off';
    }
}

// ──────────────────────────────────────────────
//  CREDENTIAL UPDATES
// ──────────────────────────────────────────────
function handlePinChange() {
    const current = DOM.settingCurrentPin.value;
    const newPin  = DOM.settingNewPin.value;

    if (current !== app.settings.pin) {
        DOM.pinChangeMessage.textContent = 'Current passcode incorrect';
        DOM.pinChangeMessage.className = 'setting-message error';
        return;
    }

    if (newPin.length < 4) {
        DOM.pinChangeMessage.textContent = 'New passcode must be at least 4 digits';
        DOM.pinChangeMessage.className = 'setting-message error';
        return;
    }

    if (!/^\d+$/.test(newPin)) {
        DOM.pinChangeMessage.textContent = 'Passcode must contain numeric digits only';
        DOM.pinChangeMessage.className = 'setting-message error';
        return;
    }

    app.settings.pin = newPin;
    app.pin.maxLength = newPin.length;
    saveSettings();

    DOM.settingCurrentPin.value = '';
    DOM.settingNewPin.value     = '';
    DOM.pinChangeMessage.textContent = 'Passcode updated successfully';
    DOM.pinChangeMessage.className = 'setting-message success';
    logEvent(EVENT_TYPES.PIN, 'Authentication passcode changed');

    setTimeout(() => {
        DOM.pinChangeMessage.textContent = '';
    }, 3000);
}

// ──────────────────────────────────────────────
//  EVENT BINDINGS
// ──────────────────────────────────────────────
function setupEventListeners() {
    DOM.btnArm.addEventListener('click', () => armSystem());
    DOM.btnDisarm.addEventListener('click', () => requestDisarm());
    DOM.btnTest.addEventListener('click', () => testAlarmSound());
    if (DOM.btnDemo) DOM.btnDemo.addEventListener('click', () => toggleDemoMode());
    if (DOM.btnSimulate) DOM.btnSimulate.addEventListener('click', () => simulateIntrusion());
    DOM.btnSettings.addEventListener('click', () => openSettings());

    DOM.btnClearLog.addEventListener('click', () => clearEventLog());

    document.querySelectorAll('.pin-key').forEach(btn => {
        btn.addEventListener('click', () => handlePinKey(btn.dataset.key));
    });
    DOM.btnPinCancel.addEventListener('click', () => hidePinModal());

    DOM.btnIntrusionDisarm.addEventListener('click', () => showPinModal());

    DOM.btnCloseSettingsX.addEventListener('click', () => closeSettings());
    DOM.btnCloseSettings.addEventListener('click', () => closeSettings());
    DOM.btnSaveSettings.addEventListener('click', () => {
        applySettingsFromUI();
        closeSettings();
    });
    DOM.btnChangePin.addEventListener('click', () => handlePinChange());
    DOM.btnSoundTest.addEventListener('click', () => testAlarmSound());

    DOM.settingConfidence.addEventListener('input', () => {
        DOM.confidenceLabel.textContent = DOM.settingConfidence.value + '%';
    });
    DOM.settingVolume.addEventListener('input', () => {
        DOM.volumeLabel.textContent = DOM.settingVolume.value + '%';
    });

    DOM.btnEnableAudio.addEventListener('click', async () => {
        await unlockAudio();
        DOM.audioInitOverlay.classList.add('hidden');
        logEvent(EVENT_TYPES.SYSTEM, 'Audio hardware driver enabled');
    });

    document.addEventListener('keydown', (e) => {
        if (!DOM.pinModal.classList.contains('hidden')) {
            if (e.key >= '0' && e.key <= '9') {
                handlePinKey(e.key);
            } else if (e.key === 'Enter') {
                handlePinKey('enter');
            } else if (e.key === 'Backspace' || e.key === 'Delete') {
                app.pin.entered = app.pin.entered.slice(0, -1);
                updatePinDisplay();
            } else if (e.key === 'Escape') {
                if (app.state !== STATES.ALARM) {
                    hidePinModal();
                }
            }
        }

        if (!DOM.settingsModal.classList.contains('hidden') && e.key === 'Escape') {
            closeSettings();
        }
    });

    const firstInteraction = async () => {
        await unlockAudio();
        document.removeEventListener('click', firstInteraction);
        document.removeEventListener('keydown', firstInteraction);
    };
    document.addEventListener('click', firstInteraction);
    document.addEventListener('keydown', firstInteraction);
}

function openSettings() {
    populateSettingsUI();
    enumerateCameras();
    DOM.pinChangeMessage.textContent = '';
    DOM.settingsModal.classList.remove('hidden');
}

function closeSettings() {
    DOM.settingsModal.classList.add('hidden');
}

// ──────────────────────────────────────────────
//  INITIALIZATION
// ──────────────────────────────────────────────
async function init() {
    loadSettings();
    loadEvents();

    app.pin.maxLength = app.settings.pin.length;

    updateStatusBanner();
    updateButtons();
    updateInfoCards();

    updateClock();
    setInterval(updateClock, 1000);

    setupEventListeners();

    if (app.demo.active) {
        if (DOM.btnDemo) DOM.btnDemo.classList.add('active');
        if (DOM.infoDemo) {
            DOM.infoDemo.textContent = 'ENABLED';
            DOM.infoDemo.className = 'info-card-value value-on';
        }
    }

    logEvent(EVENT_TYPES.SYSTEM, 'Sentinel Guard System initialized');
    logEvent(EVENT_TYPES.SYSTEM, 'On-device neural engine active — local processing only');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        logEvent(EVENT_TYPES.SYSTEM, 'Hardware video input API unsupported by host browser');
    }

    setTimeout(() => {
        if (typeof cocoSsd !== 'undefined') {
            loadDetectionModel();
        } else {
            DOM.modelLoadStatus.textContent = 'Model: Unavailable';
            DOM.infoModel.textContent = 'Unavailable';
            logEvent(EVENT_TYPES.SYSTEM, 'Vision model library unavailable offline');
        }
    }, 1000);
}

document.addEventListener('DOMContentLoaded', init);
