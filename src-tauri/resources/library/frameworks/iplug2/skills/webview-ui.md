---
name: iplug2-webview-ui
description: Creating HTML/CSS/JavaScript UIs for iPlug2 plugins using WebView editor delegate.
internal: true
---

# iPlug2 WebView UI

Creating HTML/CSS/JavaScript UIs for iPlug2 plugins.

## Config Setup

Enable WebView mode in `config.h`:

```cpp
#define PLUG_HAS_UI 1
#define PLUG_WIDTH 400
#define PLUG_HEIGHT 300
#define NO_IGRAPHICS 1
#define IGRAPHICS_WEBVIEW_EDITOR_DELEGATE 1
```

## Plugin Setup

Initialize WebView in constructor:

```cpp
#if IPLUG_EDITOR
mEditorInitFunc = [&]() {
    LoadFile("ui.html", GetBundleID());
};
#endif
```

## WebView Communication Protocol

iPlug2 uses a JSON-based messaging system between JavaScript and C++.

### JavaScript → C++ (UI to Plugin)

These functions send messages to the plugin. They use `IPlugSendMsg()` which is injected by the WebView system.

| Function | Purpose |
|----------|---------|
| `SPVFUI(paramIdx, value)` | Set Parameter Value From UI |
| `BPCFUI(paramIdx)` | Begin Parameter Change From UI (automation recording) |
| `EPCFUI(paramIdx)` | End Parameter Change From UI (automation recording) |
| `SAMFUI(msgTag, ctrlTag, data)` | Send Arbitrary Message From UI |
| `SMMFUI(statusByte, d1, d2)` | Send MIDI Message From UI |
| `SSMFUI(data)` | Send Sysex From UI |

### C++ → JavaScript (Plugin to UI)

These are global callback functions called by iPlug2. Define them in your HTML.

| Function | Purpose |
|----------|---------|
| `SPVFD(paramIdx, val)` | Set Parameter Value From Delegate (host automation) |
| `SCVFD(ctrlTag, val)` | Set Control Value From Delegate |
| `SAMFD(msgTag, dataSize, msg)` | Send Arbitrary Message From Delegate |
| `SMMFD(statusByte, d1, d2)` | Send MIDI Message From Delegate |
| `SSMFD(offset, size, msg)` | Send Sysex From Delegate |

## JavaScript Bridge Functions

Include these in your HTML to handle communication:

```javascript
// IPlugSendMsg is injected by iPlug2's WebView on macOS/Windows
// This fallback allows testing in a browser
function IPlugSendMsg(message) {
    if (typeof webkit !== 'undefined' && webkit.messageHandlers && webkit.messageHandlers.callback) {
        webkit.messageHandlers.callback.postMessage(message);
    } else {
        console.log('IPlugSendMsg (stub):', message);
    }
}

// Set Parameter Value From UI
function SPVFUI(paramIdx, value) {
    IPlugSendMsg({ msg: "SPVFUI", paramIdx: parseInt(paramIdx), value: value });
}

// Begin Parameter Change From UI (for automation)
function BPCFUI(paramIdx) {
    IPlugSendMsg({ msg: "BPCFUI", paramIdx: parseInt(paramIdx) });
}

// End Parameter Change From UI (for automation)
function EPCFUI(paramIdx) {
    IPlugSendMsg({ msg: "EPCFUI", paramIdx: parseInt(paramIdx) });
}

// Send Arbitrary Message From UI
function SAMFUI(msgTag, ctrlTag = -1, data = 0) {
    IPlugSendMsg({ msg: "SAMFUI", msgTag: msgTag, ctrlTag: ctrlTag, data: data });
}

// Send MIDI Message From UI
function SMMFUI(statusByte, dataByte1, dataByte2) {
    IPlugSendMsg({ msg: "SMMFUI", statusByte: statusByte, dataByte1: dataByte1, dataByte2: dataByte2 });
}
```

## Callback Functions (Plugin → JavaScript)

Define these global functions to receive messages from the plugin:

```javascript
// Called when host automation changes a parameter
function SPVFD(paramIdx, val) {
    console.log("SPVFD: paramIdx=" + paramIdx + " value=" + val);
    OnParamChange(paramIdx, val);
}

// Called when plugin sends control value
function SCVFD(ctrlTag, val) {
    console.log("SCVFD: ctrlTag=" + ctrlTag + " value=" + val);
}

// Called when plugin sends arbitrary message
function SAMFD(msgTag, dataSize, msg) {
    OnMessage(msgTag, dataSize, msg);
}

// Called when plugin sends MIDI message
function SMMFD(statusByte, dataByte1, dataByte2) {
    console.log("SMMFD: " + statusByte + ":" + dataByte1 + ":" + dataByte2);
}

// Your handler functions
function OnParamChange(paramIdx, normalizedValue) {
    // Update UI for this parameter
}

function OnMessage(msgTag, dataSize, msg) {
    // Handle custom messages
}
```

## Knob Control Example

```javascript
class KnobController {
    constructor(element, paramIdx) {
        this.element = element;
        this.paramIdx = paramIdx;
        this.value = 0.5;
        this.dragging = false;
        this.startY = 0;
        this.startValue = 0;

        element.addEventListener('mousedown', e => {
            this.dragging = true;
            this.startY = e.clientY;
            this.startValue = this.value;
            e.preventDefault();
            BPCFUI(this.paramIdx);  // Notify host
        });

        document.addEventListener('mousemove', e => {
            if (!this.dragging) return;
            const delta = this.startY - e.clientY;
            this.value = Math.max(0, Math.min(1, this.startValue + delta * 0.005));
            this.updateVisual();
            SPVFUI(this.paramIdx, this.value);  // Send to plugin
        });

        document.addEventListener('mouseup', () => {
            if (this.dragging) {
                this.dragging = false;
                EPCFUI(this.paramIdx);  // Notify host
            }
        });
    }

    setValue(v) {
        this.value = v;
        this.updateVisual();
    }

    updateVisual() {
        const rotation = (this.value - 0.5) * 270;
        this.element.style.setProperty('--rotation', `${rotation}deg`);
    }
}
```

## Keyboard for Instruments

Use MIDI messages for note events:

```javascript
function noteOn(note, velocity = 100) {
    // MIDI Note On: status 0x90 (144) + note + velocity
    SMMFUI(144, note, velocity);
}

function noteOff(note) {
    // MIDI Note Off: status 0x80 (128) + note + 0
    SMMFUI(128, note, 0);
}

// Computer keyboard mapping
const keyMap = {
    'z': 48, 'x': 50, 'c': 52, 'v': 53,  // C3, D3, E3, F3
    'b': 55, 'n': 57, 'm': 59,           // G3, A3, B3
    's': 49, 'd': 51, 'g': 54, 'h': 56, 'j': 58  // Black keys
};

document.addEventListener('keydown', e => {
    if (e.repeat) return;
    const note = keyMap[e.key.toLowerCase()];
    if (note) noteOn(note);
});

document.addEventListener('keyup', e => {
    const note = keyMap[e.key.toLowerCase()];
    if (note) noteOff(note);
});
```

## Complete HTML Template

```html
<!DOCTYPE html>
<html>
<head>
    <style>
        body {
            font-family: system-ui;
            background: #1a1a2e;
            color: #fff;
            margin: 0;
            user-select: none;
        }
        .knob {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: #2a2a4a;
            cursor: pointer;
        }
        .knob::before {
            content: '';
            position: absolute;
            width: 4px;
            height: 25px;
            background: #6c63ff;
            top: 8px;
            left: 50%;
            transform-origin: bottom center;
            transform: translateX(-50%) rotate(var(--rotation, 0deg));
        }
    </style>
</head>
<body>
    <div class="knob" id="gainKnob" data-param="0"></div>
    <div id="gainValue">0.0 dB</div>

    <script>
        // Bridge functions
        function IPlugSendMsg(message) {
            if (typeof webkit !== 'undefined' && webkit.messageHandlers?.callback) {
                webkit.messageHandlers.callback.postMessage(message);
            }
        }
        function SPVFUI(paramIdx, value) {
            IPlugSendMsg({ msg: "SPVFUI", paramIdx: parseInt(paramIdx), value: value });
        }
        function BPCFUI(paramIdx) {
            IPlugSendMsg({ msg: "BPCFUI", paramIdx: parseInt(paramIdx) });
        }
        function EPCFUI(paramIdx) {
            IPlugSendMsg({ msg: "EPCFUI", paramIdx: parseInt(paramIdx) });
        }

        // Callbacks from plugin
        function SPVFD(paramIdx, val) {
            if (paramIdx === 0) {
                gainKnob.setValue(val);
            }
        }

        // Knob logic
        const gainKnob = {
            el: document.getElementById('gainKnob'),
            value: 0.5,
            dragging: false,
            startY: 0,
            startValue: 0,
            setValue(v) {
                this.value = v;
                const rotation = (v - 0.5) * 270;
                this.el.style.setProperty('--rotation', `${rotation}deg`);
                document.getElementById('gainValue').textContent =
                    (-70 + v * 82).toFixed(1) + ' dB';
            }
        };

        gainKnob.el.addEventListener('mousedown', e => {
            gainKnob.dragging = true;
            gainKnob.startY = e.clientY;
            gainKnob.startValue = gainKnob.value;
            BPCFUI(0);
        });

        document.addEventListener('mousemove', e => {
            if (!gainKnob.dragging) return;
            const delta = gainKnob.startY - e.clientY;
            const newValue = Math.max(0, Math.min(1, gainKnob.startValue + delta * 0.005));
            gainKnob.setValue(newValue);
            SPVFUI(0, newValue);
        });

        document.addEventListener('mouseup', () => {
            if (gainKnob.dragging) {
                gainKnob.dragging = false;
                EPCFUI(0);
            }
        });
    </script>
</body>
</html>
```

## Best Practices

1. **Always use BPCFUI/EPCFUI** around parameter edits for proper DAW automation recording
2. **Values are normalized 0-1** - convert to display values in the UI
3. **Define all callback functions** (SPVFD, SCVFD, etc.) even if empty
4. **Use CSS transforms** for smooth animations
5. **Include IPlugSendMsg fallback** for browser testing
6. **MIDI status bytes**: Note On = 144 (0x90), Note Off = 128 (0x80), CC = 176 (0xB0)
