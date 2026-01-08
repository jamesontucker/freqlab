# Live Audio Input Feature Design

## Overview
Add live audio input (microphone/audio interface) as a new input source type for the audio preview system.

## Requirements
- Quick device selector in Preview panel when Live mode is selected
- Input level meter visible only in Live mode
- Monitoring toggle to pause/resume input (sends silence when paused)
- Direct monitoring through loaded plugin with low latency

---

## Data Model

### Backend (`engine.rs`)
```rust
pub enum InputSource {
    Signal { config: SignalConfig },
    Sample { path: String },
    Live { device: Option<String> },  // None = system default
    None,
}
```

### New Shared State Fields
- `input_level_left/right: AtomicU32` - Input metering (pre-plugin)
- `live_paused: AtomicBool` - Pause toggle

### Frontend (`previewStore.ts`)
```typescript
interface InputSource {
  type: InputSourceType;  // already has 'live'
  liveDeviceId?: string;  // Selected input device
}

interface OutputMetering {
  // ...existing fields...
  inputLeft: number;
  inputRight: number;
  inputLeftDb: number;
  inputRightDb: number;
}

// New state
isLivePaused: boolean;
setLivePaused: (paused: boolean) => void;
availableInputDevices: AudioDevice[];
setAvailableInputDevices: (devices: AudioDevice[]) => void;
```

---

## Backend Architecture

### New File: `src-tauri/src/audio/input.rs`
Input capture using cpal with lock-free ring buffer:

```rust
pub struct InputCapture {
    buffer: Arc<RingBuffer>,  // Lock-free for audio thread
    sample_rate: u32,
    channels: u16,
}

impl InputCapture {
    pub fn new(device_name: Option<&str>, target_sample_rate: u32) -> Result<Self, String>;
    pub fn read_stereo_frame(&self) -> (f32, f32);  // Returns silence if buffer empty
    pub fn clear_buffer(&self);  // Call on start/unpause
    pub fn get_input_levels(&self) -> (f32, f32);
}
```

### Engine Integration
- Engine holds `Option<InputCapture>`
- When `InputSource::Live`, reads from capture buffer
- If `live_paused`, sends silence instead
- Input levels calculated from captured samples

### New Commands (`commands/preview.rs`)
```rust
#[tauri::command]
pub fn list_input_devices() -> Result<Vec<AudioDevice>, String>

#[tauri::command]
pub fn set_live_input(device_name: Option<String>) -> Result<(), String>

#[tauri::command]
pub fn set_live_paused(paused: bool) -> Result<(), String>

#[tauri::command]
pub fn get_input_levels() -> Result<(f32, f32), String>
```

---

## Edge Case Handling

### 1. macOS Microphone Permission
- Check `AVCaptureDevice.authorizationStatus` before enabling Live mode
- Show "Microphone access required" if denied
- Request permission on first Live mode selection

### 2. No Input Devices
- `list_input_devices()` returns empty list
- UI shows "No input devices available" message
- Live option disabled or grayed out

### 3. Device Disconnection
- Input stream error callback detects disconnect
- Set error state, fall back to silence
- Show "Input device disconnected" in UI

### 4. Sample Rate Mismatch
- Query input device supported rates
- Pick rate matching output, or closest available
- Resample if necessary (use same approach as SamplePlayer)

### 5. Mono Input
- Detect channel count from input device
- Duplicate mono sample to both L/R channels

### 6. Ring Buffer Management
- Clear buffer on:
  - Starting monitoring
  - Unpausing
  - Switching to Live mode
- Size: 3x output buffer size (balance latency vs underrun)

### 7. Feedback Warning
- Show headphone icon/tooltip near monitoring toggle
- "Use headphones to avoid feedback"

### 8. Engine Reinitialization
- When audio settings change, `reinit_engine()` must:
  - Stop existing input capture
  - Recreate with new sample rate
  - Restore Live mode if it was active

---

## UI Design

### Preview Panel - Live Mode Selected
```
┌─ Input Source ─────────────────────────────┐
│  [Sample] [Signal] [Live•]                 │
│                                            │
│  Device: [Built-in Microphone      ▼]      │
│                                            │
│  ┌─ Input Level ─────────────────────────┐ │
│  │ L ████████░░░░░░░░░░░░  -12.3 dB      │ │
│  │ R ████████░░░░░░░░░░░░  -11.8 dB      │ │
│  └───────────────────────────────────────┘ │
│                                            │
│  [▶ Monitoring] 🎧 Use headphones          │
└────────────────────────────────────────────┘
```

### New Component: `LiveInputControls.tsx`
- Device selector dropdown (populated from `list_input_devices()`)
- Input level meters (reuse LevelMeters pattern)
- Monitoring toggle button with pause/play states
- Headphone warning tooltip
- Error state display for permission/device issues

---

## Files to Create/Modify

### Create
| File | Purpose |
|------|---------|
| `src-tauri/src/audio/input.rs` | Input capture, ring buffer, level metering |
| `src/components/Preview/LiveInputControls.tsx` | Device picker, input meters, monitoring toggle |

### Modify
| File | Changes |
|------|---------|
| `src-tauri/src/audio/mod.rs` | Export input module |
| `src-tauri/src/audio/engine.rs` | Add Live variant, read from input, input metering |
| `src-tauri/src/audio/device.rs` | Add `list_input_devices()` |
| `src-tauri/src/commands/preview.rs` | New commands |
| `src-tauri/src/lib.rs` | Register new commands |
| `src/stores/previewStore.ts` | Add live state fields |
| `src/api/preview.ts` | Add API wrappers |
| `src/components/Preview/PreviewPanel.tsx` | Render LiveInputControls |

---

## Implementation Order

1. Backend: Add `list_input_devices()` to device.rs
2. Backend: Create input.rs with InputCapture struct
3. Backend: Add Live variant to engine.rs, integrate input capture
4. Backend: Add new commands to preview.rs
5. Backend: Register commands in lib.rs
6. Frontend: Update previewStore with new fields
7. Frontend: Add API wrappers
8. Frontend: Create LiveInputControls component
9. Frontend: Integrate into PreviewPanel
10. Test and fix edge cases
