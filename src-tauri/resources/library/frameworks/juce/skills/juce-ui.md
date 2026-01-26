---
name: juce-native-ui
description: JUCE Components, LookAndFeel customization, paint(), and UI/parameter binding with SliderAttachment. Invoke when building custom native UIs.
internal: true
---

# JUCE Native UI

This guide covers building native JUCE interfaces using Components and LookAndFeel.

## Plugin Editor Structure

```cpp
// PluginEditor.h
class MyPluginEditor : public juce::AudioProcessorEditor
{
public:
    explicit MyPluginEditor(MyPluginProcessor&);
    ~MyPluginEditor() override;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    MyPluginProcessor& processor;

    // IMPORTANT: Declare LookAndFeel BEFORE components that use it!
    MyLookAndFeel lookAndFeel;

    // UI components
    juce::Slider gainSlider;
    juce::Label gainLabel;

    // IMPORTANT: Declare attachments AFTER the components they connect!
    std::unique_ptr<juce::AudioProcessorValueTreeState::SliderAttachment> gainAttachment;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(MyPluginEditor)
};
```

## Correct Declaration Order

**This order is critical to avoid crashes:**

1. LookAndFeel objects
2. Component objects (Slider, Label, etc.)
3. Attachment objects (SliderAttachment, ButtonAttachment, etc.)

Attachments must be destroyed before the components they reference.

## Editor Constructor

```cpp
MyPluginEditor::MyPluginEditor(MyPluginProcessor& p)
    : AudioProcessorEditor(p), processor(p)
{
    // 1. Apply look and feel
    setLookAndFeel(&lookAndFeel);

    // 2. Configure components
    gainSlider.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
    gainSlider.setTextBoxStyle(juce::Slider::TextBoxBelow, false, 80, 20);
    addAndMakeVisible(gainSlider);

    gainLabel.setText("Gain", juce::dontSendNotification);
    gainLabel.setJustificationType(juce::Justification::centred);
    addAndMakeVisible(gainLabel);

    // 3. Create attachments AFTER configuring components
    gainAttachment = std::make_unique<juce::AudioProcessorValueTreeState::SliderAttachment>(
        processor.apvts, "gain", gainSlider);

    // 4. Set size
    setSize(400, 300);
}

MyPluginEditor::~MyPluginEditor()
{
    // CRITICAL: Remove look and feel before destruction
    setLookAndFeel(nullptr);
}
```

## paint() Method

```cpp
void MyPluginEditor::paint(juce::Graphics& g)
{
    // Solid background
    g.fillAll(juce::Colour(0xff1a1a2e));

    // Gradient background
    auto bounds = getLocalBounds().toFloat();
    g.setGradientFill(juce::ColourGradient(
        juce::Colour(0xff1a1a2e), bounds.getCentreX(), 0,
        juce::Colour(0xff0f0f1a), bounds.getCentreX(), bounds.getHeight(),
        false));  // false = linear, true = radial
    g.fillAll();

    // Text
    g.setColour(juce::Colours::white);
    g.setFont(juce::Font(20.0f, juce::Font::bold));
    g.drawText("My Plugin", getLocalBounds().removeFromTop(40), juce::Justification::centred);

    // Rectangle with rounded corners
    g.setColour(juce::Colour(0xff2b2b3d));
    g.fillRoundedRectangle(bounds.reduced(10), 8.0f);

    // Lines/strokes
    g.setColour(juce::Colours::grey);
    g.drawLine(0, 50, getWidth(), 50, 1.0f);
}
```

## resized() Method

```cpp
void MyPluginEditor::resized()
{
    auto bounds = getLocalBounds().reduced(20);

    // Remove areas from bounds
    auto titleArea = bounds.removeFromTop(40);
    auto sliderArea = bounds.removeFromTop(100);
    auto bottomArea = bounds;  // Remaining space

    // Position components
    gainLabel.setBounds(sliderArea.removeFromTop(20));
    gainSlider.setBounds(sliderArea.withSizeKeepingCentre(100, 80));

    // Grid layout alternative
    juce::FlexBox fb;
    fb.flexDirection = juce::FlexBox::Direction::row;
    fb.justifyContent = juce::FlexBox::JustifyContent::center;
    fb.alignItems = juce::FlexBox::AlignItems::center;
    fb.items.add(juce::FlexItem(gainSlider).withWidth(100).withHeight(100));
    fb.performLayout(bounds);
}
```

## Custom LookAndFeel

```cpp
class MyLookAndFeel : public juce::LookAndFeel_V4
{
public:
    MyLookAndFeel()
    {
        // Set colors for built-in components
        setColour(juce::Slider::backgroundColourId, juce::Colour(0xff2b2b2b));
        setColour(juce::Slider::thumbColourId, juce::Colour(0xff6c9ced));
        setColour(juce::Slider::trackColourId, juce::Colour(0xff4a4a4a));
        setColour(juce::Slider::rotarySliderFillColourId, juce::Colour(0xff6c9ced));
        setColour(juce::Slider::rotarySliderOutlineColourId, juce::Colour(0xff4a4a4a));
        setColour(juce::Label::textColourId, juce::Colours::white);
    }

    // Override specific component rendering
    void drawRotarySlider(juce::Graphics& g, int x, int y, int width, int height,
                          float sliderPosProportional, float rotaryStartAngle,
                          float rotaryEndAngle, juce::Slider& slider) override
    {
        auto radius = (float)juce::jmin(width / 2, height / 2) - 4.0f;
        auto centreX = (float)x + (float)width * 0.5f;
        auto centreY = (float)y + (float)height * 0.5f;
        auto angle = rotaryStartAngle + sliderPosProportional * (rotaryEndAngle - rotaryStartAngle);

        // Background circle
        g.setColour(slider.findColour(juce::Slider::rotarySliderOutlineColourId));
        g.fillEllipse(centreX - radius, centreY - radius, radius * 2, radius * 2);

        // Value arc
        juce::Path arcPath;
        arcPath.addCentredArc(centreX, centreY, radius - 2, radius - 2,
                              0.0f, rotaryStartAngle, angle, true);
        g.setColour(slider.findColour(juce::Slider::rotarySliderFillColourId));
        g.strokePath(arcPath, juce::PathStrokeType(4.0f));

        // Pointer
        juce::Path pointer;
        pointer.addRoundedRectangle(-2.0f, -radius + 6, 4.0f, radius * 0.5f, 2.0f);
        pointer.applyTransform(juce::AffineTransform::rotation(angle).translated(centreX, centreY));
        g.setColour(juce::Colours::white);
        g.fillPath(pointer);
    }
};
```

## Slider Styles

```cpp
// Rotary knob
slider.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
slider.setTextBoxStyle(juce::Slider::TextBoxBelow, false, 80, 20);

// Horizontal bar
slider.setSliderStyle(juce::Slider::LinearHorizontal);
slider.setTextBoxStyle(juce::Slider::TextBoxRight, false, 50, 20);

// Vertical bar
slider.setSliderStyle(juce::Slider::LinearVertical);
slider.setTextBoxStyle(juce::Slider::TextBoxBelow, true, 50, 20);

// Two-value (range)
slider.setSliderStyle(juce::Slider::TwoValueHorizontal);
```

## Buttons

```cpp
// Toggle button
juce::ToggleButton bypassButton;
bypassButton.setButtonText("Bypass");
addAndMakeVisible(bypassButton);

bypassAttachment = std::make_unique<juce::AudioProcessorValueTreeState::ButtonAttachment>(
    processor.apvts, "bypass", bypassButton);

// Text button (for actions, not parameters)
juce::TextButton presetButton{"Load Preset"};
presetButton.onClick = [this] {
    // Handle click
};
addAndMakeVisible(presetButton);
```

## ComboBox

```cpp
juce::ComboBox modeSelector;
modeSelector.addItem("Clean", 1);
modeSelector.addItem("Warm", 2);
modeSelector.addItem("Aggressive", 3);
addAndMakeVisible(modeSelector);

modeAttachment = std::make_unique<juce::AudioProcessorValueTreeState::ComboBoxAttachment>(
    processor.apvts, "mode", modeSelector);
```

## Custom Component Example

```cpp
class LevelMeter : public juce::Component, private juce::Timer
{
public:
    LevelMeter() { startTimerHz(30); }

    void setLevel(float newLevel) { level = newLevel; }

    void paint(juce::Graphics& g) override
    {
        auto bounds = getLocalBounds().toFloat();

        // Background
        g.setColour(juce::Colour(0xff2b2b2b));
        g.fillRoundedRectangle(bounds, 4.0f);

        // Level bar
        auto levelHeight = bounds.getHeight() * level;
        auto levelBounds = bounds.removeFromBottom(levelHeight);
        g.setColour(juce::Colour(0xff6c9ced));
        g.fillRoundedRectangle(levelBounds, 4.0f);
    }

private:
    void timerCallback() override { repaint(); }
    float level = 0.0f;
};
```

## Thread Safety Notes

- `repaint()` is safe to call from any thread
- `setSize()` must be called from message thread
- Use `juce::MessageManager::callAsync()` to safely update UI from audio thread
- SliderAttachments handle thread safety automatically
