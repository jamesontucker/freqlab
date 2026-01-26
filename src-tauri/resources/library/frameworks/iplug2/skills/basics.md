---
name: iplug2-basics
description: Core iPlug2 framework patterns, config setup, parameter system, and audio processing.
internal: true
---

# iPlug2 Basics

Core patterns for iPlug2 audio plugin development.

## Architecture Overview

iPlug2 uses a single Plugin class that handles everything:

```cpp
class MyPlugin : public Plugin {
public:
    MyPlugin(const InstanceInfo& info);

    void OnReset() override;           // Sample rate/block size changed
    void OnParamChange(int idx) override;  // Parameter changed (any thread!)
    void ProcessBlock(sample**, sample**, int) override;  // Audio processing
    void ProcessMidiMsg(const IMidiMsg&) override;  // MIDI handling
};
```

## OnReset Pattern

Called when sample rate or block size changes. Recalculate coefficients here:

```cpp
void MyPlugin::OnReset() {
    double sr = GetSampleRate();
    int bs = GetBlockSize();

    // Recalculate filter coefficients
    mFilter.SetCoefs(mCutoff, sr);

    // Resize buffers if needed
    mDelayBuffer.resize(static_cast<size_t>(sr * mMaxDelaySeconds));

    // Reset DSP state
    mFilter.Reset();
}
```

## Config Header

All plugin settings in `config.h`:

```cpp
#define PLUG_NAME "MyPlugin"
#define PLUG_MFR "MyCompany"
#define PLUG_UNIQUE_ID 'MpLg'  // 4-char unique ID
#define PLUG_MFR_ID 'MyCo'     // Manufacturer ID
#define PLUG_TYPE 0            // 0=effect, 1=instrument
#define PLUG_CHANNEL_IO "2-2"  // Stereo in/out
#define PLUG_DOES_MIDI_IN 0    // Set to 1 for instruments
```

## Parameter System

Define parameters in constructor:

```cpp
enum EParams { kGain = 0, kNumParams };

MyPlugin::MyPlugin(const InstanceInfo& info)
    : Plugin(info, MakeConfig(kNumParams, 1))
{
    // Double param: name, default, min, max, step, unit
    GetParam(kGain)->InitDouble("Gain", 0., -70., 12., 0.1, "dB");

    // Enum param
    GetParam(kMode)->InitEnum("Mode", 0, 3, "", IParam::kFlagsNone,
        "", "Off", "Normal", "Turbo");

    // Bool param
    GetParam(kBypass)->InitBool("Bypass", false);

    // Specialized helpers with proper display formatting:

    // Frequency with logarithmic scaling (20 Hz - 20 kHz)
    GetParam(kCutoff)->InitFrequency("Cutoff", 1000., 20., 20000.);

    // Percentage 0-100%
    GetParam(kMix)->InitPercentage("Mix", 50.);

    // Gain in dB with proper formatting
    GetParam(kVolume)->InitGain("Volume", 0., -70., 12.);

    // Seconds (for delay time, attack, etc.)
    GetParam(kDelay)->InitSeconds("Delay", 0.1, 0.001, 1.0);
}
```

## Two-Thread Model

**OnParamChange** - Called from ANY thread (audio or UI):
- Keep operations simple and atomic
- Cache values to thread-safe members
- No memory allocation or locks

```cpp
void MyPlugin::OnParamChange(int paramIdx) {
    switch (paramIdx) {
        case kGain:
            mGain = DBToAmp(GetParam(kGain)->Value());  // Cache for ProcessBlock
            break;
    }
}
```

**OnParamChangeUI** - Called on UI thread only:
- Safe for complex operations
- Send updates to UI

## ProcessBlock Pattern

```cpp
void MyPlugin::ProcessBlock(sample** inputs, sample** outputs, int nFrames) {
    // REAL-TIME SAFE: No allocation, no locks, no I/O

    const int nChans = NOutChansConnected();
    const double gain = mGain;  // Use cached value

    for (int s = 0; s < nFrames; s++) {
        for (int c = 0; c < nChans; c++) {
            double sample = inputs[c][s];
            sample *= gain;

            // Always protect against NaN/Inf
            if (!std::isfinite(sample)) sample = 0.0;

            outputs[c][s] = sample;
        }
    }
}
```

## MIDI Handling (Instruments)

```cpp
void MyPlugin::ProcessMidiMsg(const IMidiMsg& msg) {
    switch (msg.StatusMsg()) {
        case IMidiMsg::kNoteOn:
            if (msg.Velocity() > 0) {
                // Note on: msg.NoteNumber(), msg.Velocity()
            } else {
                // Note on with vel=0 is note off
            }
            break;
        case IMidiMsg::kNoteOff:
            // Note off: msg.NoteNumber()
            break;
        case IMidiMsg::kControlChange:
            // CC: msg.ControlChangeIdx(), msg.ControlChangeValue()
            break;
    }
}
```

## State Persistence

For simple parameters, iPlug2 handles state automatically. For complex state:

```cpp
#define PLUG_DOES_STATE_CHUNKS 1

bool MyPlugin::SerializeState(IByteChunk& chunk) const {
    chunk.Put(&mCustomData);
    return true;
}

int MyPlugin::UnserializeState(const IByteChunk& chunk, int startPos) {
    startPos = chunk.Get(&mCustomData, startPos);
    return startPos;
}
```

## Utility Functions

```cpp
// Decibels to amplitude
double amp = DBToAmp(-6.0);  // 0.5

// Amplitude to decibels
double db = AmpToDB(0.5);  // -6.02

// Sample rate and block size
double sr = GetSampleRate();
int bs = GetBlockSize();

// Channel count
int nIn = NInChansConnected();
int nOut = NOutChansConnected();
```

## Logging and Debugging

```cpp
// Debug output (appears in debugger console)
DBGMSG("Sample rate: %f, Block size: %d\n", GetSampleRate(), GetBlockSize());

// Conditional debug (only in debug builds)
#ifdef _DEBUG
DBGMSG("Parameter %d changed to %f\n", paramIdx, GetParam(paramIdx)->Value());
#endif

// NEVER use DBGMSG in ProcessBlock - it allocates!
```

## Best Practices

1. **Cache parameter values** in OnParamChange for ProcessBlock
2. **Use atomic types** for thread-safe parameter caching
3. **Protect against NaN/Inf** in ProcessBlock
4. **No allocations** in audio thread
5. **Use helper functions** (DBToAmp, etc.) for clean code
6. **Test all formats** - VST3, AU, CLAP may behave slightly differently

## Common Gotchas

### OnParamChange Thread Safety
`OnParamChange()` can be called from ANY thread (audio or UI). Keep it simple:
- Only cache values to atomic/thread-safe members
- No memory allocation
- No complex computations

### Parameter IDs are Permanent
Once you ship, never change parameter indices in `EParams` enum. Changing them breaks:
- Saved presets
- DAW automation

### PLUG_UNIQUE_ID Must Be Unique
The 4-character `PLUG_UNIQUE_ID` in config.h must be globally unique across all plugins. Collisions cause DAW confusion.

### OnReset vs Constructor
Don't assume sample rate in the constructor - it's not set yet. Use `OnReset()` for sample-rate-dependent initialization.

### State Chunks Version
If using `PLUG_DOES_STATE_CHUNKS`, version your state format so you can load old presets after updates.
