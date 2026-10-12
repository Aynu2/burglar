# Sentinel Guard — Enterprise Security System

**AI-Powered Intrusion Detection System — Web Security Console**

A browser-based intrusion security monitoring system that utilizes standard video device feeds and TensorFlow.js object recognition for real-time person detection. All video analytics and audio synthesis run locally on-device inside the client browser sandbox.

---

## Key Features

- **Instant Arming**: Instantly initializes camera stream and AI detection loop on arming with zero delay.
- **Local Neural Inference**: Runs TensorFlow.js COCO-SSD object recognition model locally in WebAssembly/WebGL. Zero cloud dependencies, zero external video transfer.
- **Edge Person Detection**: Custom bounding reticles with confidence filtering and frame persistence verification to prevent false triggers.
- **Synthesized Audio Siren**: Built-in Web Audio API dual-tone siren synthesizer with volume control.
- **Passcode Authentication**: Modal security keypad with passcode protection (default passcode: `1234`).
- **System Audit Log**: Real-time event logging tracking state transitions, hardware events, detection alerts, and passcode attempts.
- **Configuration Panel**: Adjustable detection threshold, frame persistence, and video device selection.

---

## Quick Start Guide

### 1. Open the System
Open `index.html` in any WebRTC-compatible modern browser (Google Chrome or Microsoft Edge recommended):
- **Local HTTP Server**: `http://localhost:8000`

### 2. Arming the System
1. Click **ARM SYSTEM**.
2. Allow webcam permissions when prompted.
3. The camera feed instantly activates and AI object detection begins scanning for human targets.

### 3. Intrusion & Disarming
- When a person is detected for the configured persistence threshold, the alarm siren and intrusion alert engage immediately.
- Click **DISARM SYSTEM** or enter the passcode (default: `1234`) on the keypad to disarm and stop monitoring.

---

## Technical Stack
- **HTML5 & CSS3**: Industrial enterprise UI design system.
- **JavaScript (ES6+)**: Custom state machine, event dispatcher, and audio synthesizer.
- **TensorFlow.js (COCO-SSD)**: Neural network object detection engine.
- **Web Audio API**: Real-time siren oscillator synthesis.

---

## Security & Privacy
All camera frames are processed directly in your browser's local memory. No image data or video feeds are ever recorded, saved, or sent over any network interface.
