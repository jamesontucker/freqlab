---
name: juce-basics
description: Core JUCE plugin patterns, APVTS setup, two-thread model, processBlock, and state management. Invoke when setting up plugin structure or working with parameters.
internal: true
---

# JUCE Framework Essentials

This plugin uses [JUCE](https://juce.com), a C++ framework for audio applications and plugins.

**Version requirement**: JUCE 8.0.12+ is required for macOS 15 (Sequoia) compatibility.

## Two-Thread Model

JUCE plugins have two threads you must understand:

1. **Audio Thread** - Real-time, called from `processBlock()`. No allocations, no locks, no UI access.
2. **Message Thread** - UI updates, parameter callbacks. Safe for allocations.

**Rule**: Never access UI from audio thread. Never block audio thread.

## Plugin Processor Structure

```cpp
class MyPluginProcessor : public juce::AudioProcessor
{
public:
    MyPluginProcessor();
    ~MyPluginProcessor() override;

    // Audio processing - called on audio thread
    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    // Plugin info
    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return false; }   // true for instruments
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    // Presets
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    // State persistence
    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    // Editor
    bool hasEditor() const override { return true; }
    juce::AudioProcessorEditor* createEditor() override;

    // Parameter state tree
    juce::AudioProcessorValueTreeState apvts;

private:
    static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();
    std::atomic<float>* gainParameter = nullptr;  // Cache for audio thread
};
```

## Real-Time Safety Rules

### Prohibited in processBlock()
```cpp
// NEVER do these in processBlock:
new, delete, malloc, free              // Memory allocation
std::vector::push_back()               // May reallocate
std::string / juce::String operations  // Allocates
std::mutex::lock()                     // Blocking
juce::CriticalSection::enter()         // Blocking
File I/O                               // Blocking
DBG() macro                            // Allocates strings
std::shared_ptr reference counting     // May deallocate
```

### Safe in processBlock()
```cpp
// These are safe:
buffer.getWritePointer(channel)        // Pre-allocated
apvts.getRawParameterValue("x")->load() // Atomic read
smoothedGain.getNextValue()            // Lock-free
std::atomic operations                 // Lock-free
std::sin, std::cos, etc.              // Pure math
```

## AudioProcessorValueTreeState (APVTS)

APVTS is the standard way to manage parameters in JUCE:

```cpp
// In constructor:
MyPluginProcessor::MyPluginProcessor()
    : AudioProcessor(BusesProperties()
          .withInput("Input", juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Parameters", createParameterLayout())
{
}

// Parameter layout definition:
juce::AudioProcessorValueTreeState::ParameterLayout MyPluginProcessor::createParameterLayout()
{
    std::vector<std::unique_ptr<juce::RangedAudioParameter>> params;

    // Float parameter with range
    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID{"gain", 1},  // ID with version
        "Gain",                         // Display name
        juce::NormalisableRange<float>(-30.0f, 30.0f, 0.1f),  // min, max, step
        0.0f,                           // Default value
        juce::String(),                 // Suffix
        juce::AudioProcessorParameter::genericParameter,
        // Value to string:
        [](float value, int) { return juce::String(value, 1) + " dB"; },
        // String to value:
        [](const juce::String& text) { return text.getFloatValue(); }
    ));

    // Bool parameter
    params.push_back(std::make_unique<juce::AudioParameterBool>(
        juce::ParameterID{"bypass", 1},
        "Bypass",
        false  // Default
    ));

    // Choice parameter
    params.push_back(std::make_unique<juce::AudioParameterChoice>(
        juce::ParameterID{"mode", 1},
        "Mode",
        juce::StringArray{"Clean", "Warm", "Aggressive"},
        0  // Default index
    ));

    return { params.begin(), params.end() };
}
```

### Parameter ID Constants

Centralize IDs to prevent typos:

```cpp
// ParameterIDs.h
namespace ParamIDs
{
    inline constexpr auto gain = "gain";
    inline constexpr auto bypass = "bypass";
    inline constexpr auto mode = "mode";
}

// Usage:
auto* gainParam = apvts.getRawParameterValue(ParamIDs::gain);
```

## Reading Parameters

```cpp
// In prepareToPlay - cache raw pointers for audio thread:
void MyPluginProcessor::prepareToPlay(double sampleRate, int samplesPerBlock)
{
    gainParameter = apvts.getRawParameterValue("gain");
}

// In processBlock - use cached pointers (lock-free):
void MyPluginProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    float gainDb = gainParameter->load();
    float gain = juce::Decibels::decibelsToGain(gainDb);
    // ...
}

// In UI - safe to use apvts directly:
float gainDb = *processor.apvts.getRawParameterValue("gain");
```

## processBlock Pattern

```cpp
void MyPluginProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages)
{
    // CRITICAL: Always include this to prevent denormal slowdowns
    juce::ScopedNoDenormals noDenormals;

    auto totalNumInputChannels = getTotalNumInputChannels();
    auto totalNumOutputChannels = getTotalNumOutputChannels();

    // Clear unused output channels
    for (auto i = totalNumInputChannels; i < totalNumOutputChannels; ++i)
        buffer.clear(i, 0, buffer.getNumSamples());

    // Get parameter values (cached pointers are lock-free)
    float gain = juce::Decibels::decibelsToGain(gainParameter->load());

    // Process audio
    for (int channel = 0; channel < totalNumInputChannels; ++channel)
    {
        float* channelData = buffer.getWritePointer(channel);

        for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
        {
            channelData[sample] *= gain;

            // ALWAYS protect against NaN/Inf (can crash DAWs)
            if (!std::isfinite(channelData[sample]))
                channelData[sample] = 0.0f;
        }
    }
}
```

## SmoothedValue for Click-free Automation

```cpp
// In class:
juce::SmoothedValue<float, juce::ValueSmoothingTypes::Linear> smoothedGain;

// In prepareToPlay:
smoothedGain.reset(sampleRate, 0.02);  // 20ms smoothing time
smoothedGain.setCurrentAndTargetValue(juce::Decibels::decibelsToGain(gainParameter->load()));

// In processBlock:
smoothedGain.setTargetValue(juce::Decibels::decibelsToGain(gainParameter->load()));

if (smoothedGain.isSmoothing())
{
    // Per-sample smoothing
    for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
    {
        float gain = smoothedGain.getNextValue();
        // Apply to all channels...
    }
}
else
{
    // Apply constant gain (more efficient)
    buffer.applyGain(smoothedGain.getTargetValue());
}
```

## MIDI Handling (Instruments)

For instrument plugins, set `acceptsMidi()` to return `true`:

```cpp
void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages) override
{
    juce::ScopedNoDenormals noDenormals;

    for (const auto metadata : midiMessages)
    {
        const auto message = metadata.getMessage();
        const int samplePosition = metadata.samplePosition;

        if (message.isNoteOn())
        {
            int note = message.getNoteNumber();        // 0-127
            float velocity = message.getFloatVelocity(); // 0.0-1.0
            // Trigger voice...
        }
        else if (message.isNoteOff())
        {
            int note = message.getNoteNumber();
            // Release voice...
        }
        else if (message.isController())
        {
            int cc = message.getControllerNumber();    // 1=mod wheel, 64=sustain
            int value = message.getControllerValue();  // 0-127
            // Handle CC...
        }
        else if (message.isPitchWheel())
        {
            int pitchWheel = message.getPitchWheelValue(); // 0-16383, center=8192
            // Handle pitch bend...
        }
    }

    // Process audio...
}
```

## State Save/Load

```cpp
void MyPluginProcessor::getStateInformation(juce::MemoryBlock& destData)
{
    auto state = apvts.copyState();
    std::unique_ptr<juce::XmlElement> xml(state.createXml());
    copyXmlToBinary(*xml, destData);
}

void MyPluginProcessor::setStateInformation(const void* data, int sizeInBytes)
{
    std::unique_ptr<juce::XmlElement> xml(getXmlFromBinary(data, sizeInBytes));

    if (xml != nullptr && xml->hasTagName(apvts.state.getType()))
        apvts.replaceState(juce::ValueTree::fromXml(*xml));
}
```

## Bus Configurations

```cpp
// Effect (stereo in/out):
BusesProperties()
    .withInput("Input", juce::AudioChannelSet::stereo(), true)
    .withOutput("Output", juce::AudioChannelSet::stereo(), true)

// Instrument (output only):
BusesProperties()
    .withOutput("Output", juce::AudioChannelSet::stereo(), true)

// Effect with sidechain:
BusesProperties()
    .withInput("Input", juce::AudioChannelSet::stereo(), true)
    .withInput("Sidechain", juce::AudioChannelSet::stereo(), false)
    .withOutput("Output", juce::AudioChannelSet::stereo(), true)
```

## Plugin Entry Point

At the end of PluginProcessor.cpp:

```cpp
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new MyPluginProcessor();
}
```

## Common dB Conversions

```cpp
// dB to linear gain
float gain = juce::Decibels::decibelsToGain(dbValue);

// Linear gain to dB
float db = juce::Decibels::gainToDecibels(linearValue);

// Common reference levels
const float unityGain = 1.0f;                          // 0 dB
const float halfVolume = juce::Decibels::decibelsToGain(-6.0f);   // ~0.5
const float doubleVolume = juce::Decibels::decibelsToGain(6.0f);  // ~2.0
```

## Logging and Debugging

```cpp
// Message thread only (safe):
DBG("Parameter changed: " << paramId);
DBG("Value: " << juce::String(value, 2));

// NEVER use DBG in processBlock - it allocates!
// Instead, use atomic flags for debugging:
std::atomic<float> debugValue{0.0f};

// In processBlock:
debugValue.store(someValue, std::memory_order_relaxed);

// In timer callback (message thread):
DBG("Audio value: " << debugValue.load());
```

## Common Gotchas

### Parameter IDs Are Permanent
Once shipped, never change `juce::ParameterID{"gain", 1}` strings. Changing them breaks:
- Saved presets
- DAW automation lanes

### ScopedNoDenormals Is Essential
Always include at the start of processBlock(). Denormals cause massive CPU spikes on silence.

### Attachment Declaration Order
In PluginEditor, declare in this order to avoid crashes:
1. LookAndFeel objects
2. Component objects (Slider, Button)
3. Attachment objects (SliderAttachment)

### prepareToPlay May Be Called Multiple Times
Sample rate can change between calls. Always recalculate coefficients in prepareToPlay(), not just in the constructor.

### DBG Causes Audio Glitches
DBG() allocates strings. Never use in processBlock(). Use atomic flags and print from timer callback instead.

### Plugin Not Updating in DAW
If DAW shows old version, check `COPY_PLUGIN_AFTER_BUILD` in CMake. Also try `killall -9 AudioComponentRegistrar` on macOS to refresh AU cache.
