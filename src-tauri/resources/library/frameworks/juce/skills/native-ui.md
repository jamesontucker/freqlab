---
name: juce-native-ui
description: Pattern for plugins without custom editors, using DAW's generic parameter interface. Invoke for utility plugins or when UI development isn't a priority.
internal: true
---

# JUCE Native (No Editor)

This guide covers creating plugins that use the DAW's built-in generic parameter interface instead of a custom editor.

## When to Use Native (No UI)

- **Utility plugins**: Simple gain, phase flip, test tone generators
- **Rapid prototyping**: Focus on DSP first, add UI later
- **Accessibility**: DAWs often provide better accessibility for generic UIs
- **Minimal maintenance**: No UI code to maintain or debug

## Processor Configuration

The key is `hasEditor() = false` and `createEditor() = nullptr`:

```cpp
// PluginProcessor.h
class MyPluginProcessor : public juce::AudioProcessor
{
public:
    // ... standard methods ...

    // NO custom editor
    bool hasEditor() const override { return false; }
    juce::AudioProcessorEditor* createEditor() override { return nullptr; }

    juce::AudioProcessorValueTreeState apvts;

    // ... rest of class
};
```

## Complete Generic Plugin Example

```cpp
// PluginProcessor.h
#pragma once
#include <juce_audio_processors/juce_audio_processors.h>

class GainProcessor : public juce::AudioProcessor
{
public:
    GainProcessor();
    ~GainProcessor() override = default;

    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}

    void getStateInformation(juce::MemoryBlock& destData) override;
    void setStateInformation(const void* data, int sizeInBytes) override;

    // No custom editor
    bool hasEditor() const override { return false; }
    juce::AudioProcessorEditor* createEditor() override { return nullptr; }

    juce::AudioProcessorValueTreeState apvts;

private:
    static juce::AudioProcessorValueTreeState::ParameterLayout createParameterLayout();
    std::atomic<float>* gainParameter = nullptr;
    juce::SmoothedValue<float> smoothedGain;
};
```

```cpp
// PluginProcessor.cpp
#include "PluginProcessor.h"

GainProcessor::GainProcessor()
    : AudioProcessor(BusesProperties()
          .withInput("Input", juce::AudioChannelSet::stereo(), true)
          .withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      apvts(*this, nullptr, "Parameters", createParameterLayout())
{
}

juce::AudioProcessorValueTreeState::ParameterLayout GainProcessor::createParameterLayout()
{
    std::vector<std::unique_ptr<juce::RangedAudioParameter>> params;

    params.push_back(std::make_unique<juce::AudioParameterFloat>(
        juce::ParameterID{"gain", 1},
        "Gain",
        juce::NormalisableRange<float>(-30.0f, 30.0f, 0.1f),
        0.0f,
        juce::String(),
        juce::AudioProcessorParameter::genericParameter,
        [](float v, int) { return juce::String(v, 1) + " dB"; },
        [](const juce::String& s) { return s.getFloatValue(); }
    ));

    return { params.begin(), params.end() };
}

void GainProcessor::prepareToPlay(double sampleRate, int)
{
    gainParameter = apvts.getRawParameterValue("gain");
    smoothedGain.reset(sampleRate, 0.02);
    smoothedGain.setCurrentAndTargetValue(juce::Decibels::decibelsToGain(gainParameter->load()));
}

void GainProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    smoothedGain.setTargetValue(juce::Decibels::decibelsToGain(gainParameter->load()));

    for (int sample = 0; sample < buffer.getNumSamples(); ++sample)
    {
        float gain = smoothedGain.getNextValue();
        for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
        {
            float* data = buffer.getWritePointer(ch);
            data[sample] *= gain;
            if (!std::isfinite(data[sample])) data[sample] = 0.0f;
        }
    }
}

void GainProcessor::getStateInformation(juce::MemoryBlock& destData)
{
    auto state = apvts.copyState();
    std::unique_ptr<juce::XmlElement> xml(state.createXml());
    copyXmlToBinary(*xml, destData);
}

void GainProcessor::setStateInformation(const void* data, int sizeInBytes)
{
    auto xml = getXmlFromBinary(data, sizeInBytes);
    if (xml && xml->hasTagName(apvts.state.getType()))
        apvts.replaceState(juce::ValueTree::fromXml(*xml));
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new GainProcessor();
}
```

## Parameter Naming for Generic UI

Since the DAW shows your parameters directly, naming is important:

```cpp
// Good parameter names for generic UI
"Gain"              // Clear and simple
"Attack Time"       // Descriptive
"Filter Cutoff"     // Self-explanatory

// Bad parameter names
"p1"                // Meaningless
"gainDb"            // Implementation detail
"flt_fc"            // Abbreviated jargon
```

## Parameter Formatting

The DAW will display your value-to-string conversion:

```cpp
// Good: Shows units and precision
[](float v, int) { return juce::String(v, 1) + " dB"; }     // "0.0 dB"
[](float v, int) { return juce::String(v * 1000, 0) + " ms"; }  // "100 ms"
[](float v, int) { return juce::String(v * 100, 0) + "%"; }     // "50%"

// For frequency with "Hz" or "kHz":
[](float v, int) {
    if (v >= 1000.0f)
        return juce::String(v / 1000.0f, 2) + " kHz";
    return juce::String(v, 0) + " Hz";
}
```

## CMakeLists.txt for Generic Plugins

```cmake
juce_add_plugin(MyGenericPlugin
    COMPANY_NAME "My Company"
    PLUGIN_MANUFACTURER_CODE Myco
    PLUGIN_CODE Mygn

    FORMATS Standalone VST3 AU

    PRODUCT_NAME "My Generic Plugin"

    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS FALSE

    VST3_CATEGORIES "Fx" "Tools"
)

# Only processor, no editor
target_sources(MyGenericPlugin
    PRIVATE
        src/PluginProcessor.cpp
)

target_link_libraries(MyGenericPlugin
    PRIVATE
        juce::juce_audio_utils
        juce::juce_dsp
    PUBLIC
        juce::juce_recommended_config_flags
)

target_compile_definitions(MyGenericPlugin
    PUBLIC
        JUCE_WEB_BROWSER=0
        JUCE_USE_CURL=0
)
```

## Converting to Custom Editor Later

When you're ready to add a custom UI, simply:

1. Create `PluginEditor.h` and `PluginEditor.cpp`
2. Change `hasEditor()` to return `true`
3. Implement `createEditor()` to return `new MyPluginEditor(*this)`
4. Add the editor files to CMakeLists.txt

The parameter system (APVTS) remains the same, so no changes to your DSP code.
