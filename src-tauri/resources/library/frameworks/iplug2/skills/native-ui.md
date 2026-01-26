---
name: iplug2-native-ui
description: Creating plugins that use the DAW's generic parameter interface with no custom UI.
internal: true
---

# iPlug2 Native (No Custom UI)

Creating plugins that use the DAW's generic parameter interface.

## When to Use

- Utility plugins (gain, mono-to-stereo, etc.)
- Plugins where UI is not important
- Maximum compatibility across hosts
- Smallest binary size

## Config Setup

Disable UI in `config.h`:

```cpp
#define PLUG_HAS_UI 0
#define PLUG_WIDTH 400   // Still define (some hosts use these)
#define PLUG_HEIGHT 300
```

## CMake Setup

No graphics library needed:

```cmake
iplug2_add_plugin(${PROJECT_NAME}
    SOURCES ${PLUGIN_SOURCES}
    FORMATS VST3 AU CLAP APP
    NO_GRAPHICS
)
```

## Plugin Structure

Simpler without UI code:

```cpp
class MyPlugin final : public Plugin {
public:
    MyPlugin(const InstanceInfo& info);

    void OnReset() override;
    void OnParamChange(int paramIdx) override;
    void ProcessBlock(sample** inputs, sample** outputs, int nFrames) override;

private:
    double mGain = 1.0;
};
```

## Constructor

No editor setup needed:

```cpp
MyPlugin::MyPlugin(const InstanceInfo& info)
    : Plugin(info, MakeConfig(kNumParams, 1))
{
    // Define parameters - these appear in DAW's generic interface
    GetParam(kGain)->InitDouble("Gain", 0., -70., 12., 0.1, "dB");
    GetParam(kPan)->InitDouble("Pan", 0., -100., 100., 1., "%");

    // Initialize cached values
    mGain = DBToAmp(GetParam(kGain)->Value());
}
```

## Parameter Types for Generic UI

The DAW displays parameters differently based on type:

```cpp
// Continuous (shows as slider/knob)
GetParam(kGain)->InitDouble("Gain", 0., -70., 12., 0.1, "dB");

// Enum (shows as dropdown)
GetParam(kMode)->InitEnum("Mode", 0, 3, "", IParam::kFlagsNone,
    "", "Off", "Low", "High");

// Bool (shows as toggle/checkbox)
GetParam(kBypass)->InitBool("Bypass", false);

// Frequency with logarithmic scaling
GetParam(kFreq)->InitFrequency("Frequency", 1000., 20., 20000.);

// Percentage
GetParam(kMix)->InitPercentage("Mix", 100.);
```

## Process Block

Same as any other plugin:

```cpp
void MyPlugin::ProcessBlock(sample** inputs, sample** outputs, int nFrames) {
    const int nChans = NOutChansConnected();
    const double gain = mGain;

    for (int s = 0; s < nFrames; s++) {
        for (int c = 0; c < nChans; c++) {
            double sample = inputs[c][s];
            sample *= gain;

            if (!std::isfinite(sample)) sample = 0.0;

            outputs[c][s] = sample;
        }
    }
}
```

## Instruments Without UI

For instruments, MIDI still works:

```cpp
#define PLUG_TYPE 1
#define PLUG_DOES_MIDI_IN 1
#define PLUG_HAS_UI 0

void MyPlugin::ProcessMidiMsg(const IMidiMsg& msg) {
    switch (msg.StatusMsg()) {
        case IMidiMsg::kNoteOn:
            // Handle note on
            break;
        case IMidiMsg::kNoteOff:
            // Handle note off
            break;
    }
}
```

## Parameter Organization

Group related parameters with naming conventions:

```cpp
// Use prefixes for grouping in DAW
GetParam(kOsc1Pitch)->InitDouble("Osc1 Pitch", 0., -24., 24., 1., "st");
GetParam(kOsc1Wave)->InitEnum("Osc1 Wave", 0, 4, ...);
GetParam(kOsc2Pitch)->InitDouble("Osc2 Pitch", 0., -24., 24., 1., "st");
GetParam(kOsc2Wave)->InitEnum("Osc2 Wave", 0, 4, ...);
GetParam(kFilterCutoff)->InitFrequency("Filter Cutoff", 1000.);
GetParam(kFilterRes)->InitPercentage("Filter Resonance", 0.);
```

## Advantages

1. **No UI code** to maintain
2. **Smaller binary** size
3. **DAW integration** - parameters appear natively
4. **Automation** works out of the box
5. **Accessibility** - DAW handles accessible controls

## Limitations

1. No visual feedback (meters, waveforms)
2. No custom control types
3. Layout controlled by DAW
4. Less brand identity

## Best Practices

1. **Use descriptive parameter names** - they're all users see
2. **Include units** in parameter definitions (dB, Hz, %, etc.)
3. **Use appropriate parameter types** (enum for discrete choices)
4. **Order parameters logically** - some DAWs show them in order
5. **Set sensible defaults** - users may not adjust all parameters
