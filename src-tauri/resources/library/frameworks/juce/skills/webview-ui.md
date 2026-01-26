---
name: juce-webview-ui
description: WebBrowserComponent integration (JUCE 8+), JavaScript bindings, resource serving, and bidirectional communication. Invoke when building web-based plugin UIs.
internal: true
---

# JUCE WebView UI

This guide covers building web-based UIs using JUCE 8's WebBrowserComponent.

## Requirements

- JUCE 8.0.0+
- CMake definition: `JUCE_WEB_BROWSER=1`
- Windows: WebView2 runtime (auto-bundled with `JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1`)
- macOS: Uses WKWebView (built-in)

## CMake Configuration

```cmake
juce_add_plugin(MyPlugin
    # ...
    NEEDS_WEBVIEW2 TRUE
)

# Embed HTML as binary data
juce_add_binary_data(MyPluginWebResources
    SOURCES
        src/ui.html
)

target_link_libraries(MyPlugin
    PRIVATE
        MyPluginWebResources
        juce::juce_gui_extra  # Required for WebBrowserComponent
)

target_compile_definitions(MyPlugin
    PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
)
```

## Editor Structure

```cpp
// PluginEditor.h
#pragma once
#include "PluginProcessor.h"
#include <juce_gui_extra/juce_gui_extra.h>
#include "BinaryData.h"

class MyPluginEditor : public juce::AudioProcessorEditor,
                       private juce::Timer
{
public:
    explicit MyPluginEditor(MyPluginProcessor&);
    ~MyPluginEditor() override;

    void paint(juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;
    std::optional<juce::WebBrowserComponent::Resource> getResource(const juce::String& url);
    void sendParameterUpdate(const juce::String& paramId, float value);

    MyPluginProcessor& processor;

    juce::WebBrowserComponent webView{
        juce::WebBrowserComponent::Options{}
            .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
            .withNativeIntegrationEnabled()
            .withResourceProvider([this](const auto& url) { return getResource(url); })
            // JavaScript -> C++
            .withNativeFunction("setParameter", [this](const juce::var::NativeFunctionArgs& args) {
                if (args.numArguments >= 2) {
                    juce::String paramId = args.arguments[0].toString();
                    float value = static_cast<float>(args.arguments[1]);
                    if (auto* param = processor.apvts.getParameter(paramId)) {
                        auto range = param->getNormalisableRange();
                        param->setValueNotifyingHost(range.convertTo0to1(value));
                    }
                }
                return juce::var();
            })
            .withNativeFunction("requestInit", [this](const juce::var::NativeFunctionArgs&) {
                // Send current parameter values to UI on load
                sendAllParameters();
                return juce::var();
            })
    };

    float lastGainValue = 0.0f;
};
```

## Editor Implementation

```cpp
// PluginEditor.cpp
#include "PluginEditor.h"

MyPluginEditor::MyPluginEditor(MyPluginProcessor& p)
    : AudioProcessorEditor(p), processor(p)
{
    addAndMakeVisible(webView);

    // Load from resource provider
    webView.goToURL(juce::WebBrowserComponent::getResourceProviderRoot());

    // Start timer for parameter sync (30Hz)
    startTimerHz(30);

    setSize(400, 300);
}

MyPluginEditor::~MyPluginEditor()
{
    stopTimer();
}

void MyPluginEditor::paint(juce::Graphics& g)
{
    g.fillAll(juce::Colour(0xff1a1a2e));
}

void MyPluginEditor::resized()
{
    webView.setBounds(getLocalBounds());
}

// Serve resources from binary data
std::optional<juce::WebBrowserComponent::Resource> MyPluginEditor::getResource(const juce::String& url)
{
    if (url == "/" || url == "/index.html" || url.isEmpty())
    {
        return juce::WebBrowserComponent::Resource{
            juce::String(BinaryData::ui_html, BinaryData::ui_htmlSize),
            "text/html"
        };
    }

    // Serve CSS files
    if (url.endsWith(".css"))
    {
        // Look up in BinaryData...
    }

    return std::nullopt;
}

// Sync parameters from host/automation to UI
void MyPluginEditor::timerCallback()
{
    if (auto* param = processor.apvts.getParameter("gain"))
    {
        float displayValue = /* convert from normalized */;
        if (std::abs(displayValue - lastGainValue) > 0.01f)
        {
            lastGainValue = displayValue;
            sendParameterUpdate("gain", displayValue);
        }
    }
}

// C++ -> JavaScript
void MyPluginEditor::sendParameterUpdate(const juce::String& paramId, float value)
{
    juce::String script = "if (window.onParamChange) window.onParamChange('"
                        + paramId + "', " + juce::String(value) + ");";
    webView.evaluateJavascript(script, nullptr);
}
```

## HTML/JavaScript Structure

```html
<!DOCTYPE html>
<html>
<head>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            background: linear-gradient(135deg, #1a1a2e, #0f0f1a);
            color: white;
            height: 100vh;
            user-select: none;
        }
        /* Your styles... */
    </style>
</head>
<body>
    <h1>My Plugin</h1>
    <input type="range" id="gainSlider" min="-30" max="30" step="0.1" value="0">
    <span id="gainValue">0 dB</span>

    <script>
        // Send parameter to C++
        function setParameter(paramId, value) {
            if (window.__JUCE__ && window.__JUCE__.backend) {
                window.__JUCE__.backend.setParameter(paramId, value);
            }
        }

        // Receive parameter from C++
        window.onParamChange = function(paramId, value) {
            if (paramId === 'gain') {
                document.getElementById('gainSlider').value = value;
                document.getElementById('gainValue').textContent = value.toFixed(1) + ' dB';
            }
        };

        // UI event handlers
        document.getElementById('gainSlider').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            setParameter('gain', value);
            document.getElementById('gainValue').textContent = value.toFixed(1) + ' dB';
        });

        // Request initial values when loaded
        window.addEventListener('load', () => {
            if (window.__JUCE__ && window.__JUCE__.backend) {
                window.__JUCE__.backend.requestInit();
            }
        });
    </script>
</body>
</html>
```

## Native Functions API

Register C++ functions callable from JavaScript:

```cpp
.withNativeFunction("functionName", [this](const juce::var::NativeFunctionArgs& args) {
    // args.numArguments - number of arguments
    // args.arguments[0], args.arguments[1], etc. - juce::var values

    // Return value back to JavaScript
    return juce::var("result");
})
```

Call from JavaScript:
```javascript
const result = window.__JUCE__.backend.functionName(arg1, arg2);
```

## Evaluating JavaScript from C++

```cpp
// Fire and forget
webView.evaluateJavascript("console.log('Hello from C++')", nullptr);

// With callback
webView.evaluateJavascript("document.title", [](juce::WebBrowserComponent::EvaluationResult result) {
    if (result.getResult())
        DBG("Title: " + result.getResult()->toString());
});
```

## Serving Multiple Files

```cpp
std::optional<juce::WebBrowserComponent::Resource> MyPluginEditor::getResource(const juce::String& url)
{
    // Main HTML
    if (url == "/" || url.isEmpty())
        return makeResource(BinaryData::ui_html, BinaryData::ui_htmlSize, "text/html");

    // CSS
    if (url == "/styles.css")
        return makeResource(BinaryData::styles_css, BinaryData::styles_cssSize, "text/css");

    // JavaScript
    if (url == "/app.js")
        return makeResource(BinaryData::app_js, BinaryData::app_jsSize, "application/javascript");

    // Images
    if (url == "/logo.png")
        return makeResource(BinaryData::logo_png, BinaryData::logo_pngSize, "image/png");

    return std::nullopt;
}

juce::WebBrowserComponent::Resource makeResource(const char* data, int size, const char* mimeType)
{
    return { juce::String(data, size), mimeType };
}
```

## Best Practices

1. **Parameter sync frequency**: 30Hz is usually sufficient; higher rates waste CPU
2. **Debounce UI updates**: Don't send every mouse move - batch or throttle
3. **Handle load timing**: UI might request init before webview is fully ready
4. **Escape strings**: When building JavaScript, escape user-provided strings
5. **Error handling**: Check `window.__JUCE__` exists before calling backend
6. **Test on all platforms**: WebView2 (Windows) and WKWebView (macOS) may differ slightly

## Debugging

```cpp
// Enable developer tools
juce::WebBrowserComponent::Options{}
    .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
    .withNativeIntegrationEnabled()
    // Right-click -> Inspect works when this is enabled
```

On macOS, use Safari's Develop menu to inspect WKWebView content.
