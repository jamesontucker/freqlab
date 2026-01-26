---
name: iplug2-igraphics-ui
description: Creating native UIs with iPlug2's IGraphics framework for cross-platform vector graphics.
internal: true
---

# iPlug2 IGraphics UI

Creating native UIs with iPlug2's IGraphics framework.

## Setup

In constructor, define graphics and layout functions:

```cpp
#if IPLUG_EDITOR
mMakeGraphicsFunc = [&]() {
    return MakeGraphics(*this, PLUG_WIDTH, PLUG_HEIGHT, PLUG_FPS,
        GetScaleForScreen(PLUG_WIDTH, PLUG_HEIGHT));
};

mLayoutFunc = [&](IGraphics* pGraphics) {
    // Build UI here
};
#endif
```

## Layout Basics

```cpp
mLayoutFunc = [&](IGraphics* pGraphics) {
    const IRECT bounds = pGraphics->GetBounds();

    // Corner resizer for HiDPI
    pGraphics->AttachCornerResizer(EUIResizerMode::Scale, false);

    // Background
    pGraphics->AttachPanelBackground(COLOR_DARK_GRAY);

    // Load font
    pGraphics->LoadFont("Roboto-Regular", ROBOTO_FN);

    // Add controls...
};
```

## Built-in Controls

### Knobs and Sliders

```cpp
// Knob with label
pGraphics->AttachControl(new IVKnobControl(
    IRECT(x, y, x + 70, y + 90),
    kGain,      // Parameter index
    "Gain"      // Label
));

// Slider
pGraphics->AttachControl(new IVSliderControl(
    bounds.GetCentredInside(30, 200),
    kVolume,
    "Volume"
));
```

### Buttons and Toggles

```cpp
// Toggle button
pGraphics->AttachControl(new IVToggleControl(
    IRECT(x, y, x + 60, y + 30),
    kBypass,
    "Bypass"
));

// Momentary button
pGraphics->AttachControl(new IVButtonControl(
    IRECT(x, y, x + 80, y + 30),
    SplashClickActionFunc,
    "Reset"
));
```

### Text and Labels

```cpp
// Static text
pGraphics->AttachControl(new ITextControl(
    bounds.GetFromTop(40),
    "My Plugin",
    IText(24, COLOR_WHITE)
));

// Value display linked to parameter
pGraphics->AttachControl(new ICaptionControl(
    IRECT(x, y, x + 60, y + 20),
    kGain,
    IText(12)
));
```

## Control Tags

Use tags to access controls from code:

```cpp
enum EControlTags {
    kCtrlTagMeter = 0,
    kCtrlTagKeyboard
};

// Attach with tag
pGraphics->AttachControl(pMeterControl, kCtrlTagMeter);

// Access later
if (GetUI()) {
    auto* pMeter = GetUI()->GetControlWithTag(kCtrlTagMeter);
    if (pMeter) {
        pMeter->SetValue(newValue);
    }
}
```

## DSP to UI Communication (ISender)

For real-time data like meters, use ISender:

```cpp
// In header
#include "ISender.h"

class MyPlugin : public Plugin {
    IPeakSender<2> mPeakSender;  // Stereo peaks
};

// In ProcessBlock - send peaks
mPeakSender.ProcessBlock(outputs, nFrames, kCtrlTagMeter);

// In layout - create meter control
pGraphics->AttachControl(
    new IVPeakAvgMeterControl<2>(meterBounds, ""),
    kCtrlTagMeter
)->As<IVPeakAvgMeterControl<2>>()->SetPeakSize(3.f);

// In OnIdle - pump data to UI (called from UI thread)
void OnIdle() override {
    mPeakSender.TransmitData(*this);
}
```

## Custom Controls

```cpp
class MyCustomControl : public IControl {
public:
    MyCustomControl(const IRECT& bounds)
        : IControl(bounds) {}

    void Draw(IGraphics& g) override {
        // Drawing code
        g.FillRect(COLOR_BLUE, mRECT);
        g.DrawText(mText, "Hello", mRECT);
    }

    void OnMouseDown(float x, float y, const IMouseMod& mod) override {
        // Handle click
        SetDirty(true);  // Request redraw
    }

private:
    IText mText{14, COLOR_WHITE};
};
```

## Keyboard Control (Instruments)

```cpp
auto* pKeyboard = new IVKeyboardControl(
    bounds.GetFromBottom(100).GetPadded(-10),
    36,   // Low note (C2)
    72    // High note (C5)
);

pKeyboard->SetNoteFromMIDIHandler([this](int note, bool on) {
    IMidiMsg msg;
    if (on) msg.MakeNoteOnMsg(note, 100, 0);
    else msg.MakeNoteOffMsg(note, 0);
    ProcessMidiMsg(msg);
    SendMidiMsg(msg);
});

pGraphics->AttachControl(pKeyboard, kCtrlTagKeyboard);
```

## Styling (IVStyle)

```cpp
// Create custom style
const IVStyle myStyle {
    true,                   // Show label
    true,                   // Show value
    {
        COLOR_TRANSPARENT,  // Background
        COLOR_DARK_GRAY,    // Foreground
        COLOR_BLUE,         // Pressed
        COLOR_MID_GRAY,     // Frame
        COLOR_LIGHT_GRAY,   // Highlight
        COLOR_WHITE,        // Shadow
        COLOR_BLUE,         // Extra 1
        COLOR_GREEN         // Extra 2
    },
    IText(14, COLOR_WHITE)  // Label text
};

// Apply to control
pGraphics->AttachControl(new IVKnobControl(bounds, kGain, "", myStyle));
```

## Best Practices

1. **Use control tags** for runtime access to controls
2. **Use ISender** for DSP→UI data (never access DSP state directly from UI)
3. **SetDirty(true)** to request redraw after state changes
4. **Cache IGraphics pointer** if needed, but check for null
5. **Use IRECT helpers** (GetFromTop, GetCentredInside, etc.) for layout
6. **Load fonts early** in layout function before using IText
