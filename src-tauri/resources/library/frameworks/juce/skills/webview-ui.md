---
name: juce-webview-ui
description: WebBrowserComponent integration (JUCE 8+), JavaScript bindings, resource serving, and bidirectional communication. Invoke when building web-based plugin UIs.
internal: true
---

# JUCE WebView UI

This guide covers building web-based UIs using JUCE 8's WebBrowserComponent.

## Requirements

- JUCE 8.0.12+ (macOS 15 compatibility)
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

## Editor Structure (JUCE 8 API)

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
    void sendAllParameters();

    MyPluginProcessor& processor;

    // JUCE 8 WebView with native functions
    // NOTE: Native function signature uses Array<var> and NativeFunctionCompletion callback
    juce::WebBrowserComponent webView{
        juce::WebBrowserComponent::Options{}
            .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
            .withNativeIntegrationEnabled()
            .withResourceProvider([this](const auto& url) { return getResource(url); })
            // JavaScript -> C++ (JUCE 8 callback-based API)
            .withNativeFunction("setParameter", [this](const juce::Array<juce::var>& args,
                                                       juce::WebBrowserComponent::NativeFunctionCompletion completion) {
                if (args.size() >= 2) {
                    juce::String paramId = args[0].toString();
                    float value = static_cast<float>(args[1]);
                    if (auto* param = processor.apvts.getParameter(paramId)) {
                        auto range = param->getNormalisableRange();
                        param->setValueNotifyingHost(range.convertTo0to1(value));
                    }
                }
                completion(juce::var());  // Must call completion!
            })
            .withNativeFunction("requestInit", [this](const juce::Array<juce::var>&,
                                                      juce::WebBrowserComponent::NativeFunctionCompletion completion) {
                sendAllParameters();
                completion(juce::var());  // Must call completion!
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
// IMPORTANT: JUCE 8 requires std::vector<std::byte>, NOT juce::String
std::optional<juce::WebBrowserComponent::Resource> MyPluginEditor::getResource(const juce::String& url)
{
    if (url == "/" || url == "/index.html" || url.isEmpty())
    {
        auto* data = reinterpret_cast<const std::byte*>(BinaryData::ui_html);
        return juce::WebBrowserComponent::Resource{
            std::vector<std::byte>(data, data + BinaryData::ui_htmlSize),
            "text/html"
        };
    }

    return std::nullopt;
}

// Sync parameters from host/automation to UI
void MyPluginEditor::timerCallback()
{
    if (auto* param = processor.apvts.getParameter("gain"))
    {
        // Use parameter's range for proper conversion
        auto range = param->getNormalisableRange();
        float displayValue = range.convertFrom0to1(param->getValue());

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

void MyPluginEditor::sendAllParameters()
{
    if (auto* param = processor.apvts.getParameter("gain"))
    {
        auto range = param->getNormalisableRange();
        float displayValue = range.convertFrom0to1(param->getValue());
        sendParameterUpdate("gain", displayValue);
        lastGainValue = displayValue;
    }
}
```

## HTML/JavaScript Structure (JUCE 8 Low-Level API)

JUCE 8 uses a low-level event-based API. The `window.__JUCE__.backend` object does NOT have methods like `setParameter()` or `requestInit()` directly. Instead, you must use `emitEvent("__juce__invoke", ...)`.

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
    </style>
</head>
<body>
    <h1>My Plugin</h1>
    <input type="range" id="gainSlider" min="-30" max="30" step="0.1" value="0">
    <span id="gainValue">0 dB</span>

    <script>
        // ============================================================
        // JUCE 8 WebView Native Function Bridge
        // Uses the low-level __juce__invoke event API
        // ============================================================
        let promiseId = 0;
        const pendingPromises = new Map();

        // Listen for native function completions
        if (window.__JUCE__ && window.__JUCE__.backend) {
            window.__JUCE__.backend.addEventListener("__juce__complete", (data) => {
                if (pendingPromises.has(data.promiseId)) {
                    pendingPromises.get(data.promiseId).resolve(data.result);
                    pendingPromises.delete(data.promiseId);
                }
            });
        }

        // Call a native function registered with withNativeFunction()
        function callNative(name, ...args) {
            return new Promise((resolve, reject) => {
                if (!window.__JUCE__ || !window.__JUCE__.backend) {
                    reject("No JUCE backend");
                    return;
                }
                const id = promiseId++;
                pendingPromises.set(id, { resolve, reject });
                window.__JUCE__.backend.emitEvent("__juce__invoke", {
                    name: name,
                    params: args,
                    resultId: id
                });
            });
        }

        // ============================================================
        // Receive parameter updates from C++ (via evaluateJavascript)
        // ============================================================
        window.onParamChange = function(paramId, value) {
            if (paramId === 'gain') {
                document.getElementById('gainSlider').value = value;
                document.getElementById('gainValue').textContent = value.toFixed(1) + ' dB';
            }
        };

        // ============================================================
        // UI Event Handlers
        // ============================================================
        document.getElementById('gainSlider').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            callNative('setParameter', 'gain', value);
            document.getElementById('gainValue').textContent = value.toFixed(1) + ' dB';
        });

        // Request initial values when loaded
        window.addEventListener('load', () => {
            callNative('requestInit');
        });
    </script>
</body>
</html>
```

## Native Functions API (JUCE 8)

Register C++ functions callable from JavaScript. **Important**: JUCE 8 uses a callback-based API:

```cpp
// JUCE 8 signature (correct):
.withNativeFunction("functionName", [this](const juce::Array<juce::var>& args,
                                           juce::WebBrowserComponent::NativeFunctionCompletion completion) {
    // args.size() - number of arguments
    // args[0], args[1], etc. - juce::var values

    // MUST call completion to return result to JavaScript
    completion(juce::var("result"));
})

// OLD signature (will NOT compile in JUCE 8):
// .withNativeFunction("functionName", [](const juce::var::NativeFunctionArgs& args) {
//     return juce::var();  // Wrong!
// })
```

Call from JavaScript using the `callNative()` helper:
```javascript
callNative("functionName", arg1, arg2).then(result => {
    console.log("Got result:", result);
});
```

## Serving Resources (JUCE 8)

**Critical**: JUCE 8 requires `std::vector<std::byte>`, not `juce::String`:

```cpp
std::optional<juce::WebBrowserComponent::Resource> MyPluginEditor::getResource(const juce::String& url)
{
    // Main HTML
    if (url == "/" || url.isEmpty())
    {
        auto* data = reinterpret_cast<const std::byte*>(BinaryData::ui_html);
        return juce::WebBrowserComponent::Resource{
            std::vector<std::byte>(data, data + BinaryData::ui_htmlSize),
            "text/html"
        };
    }

    // CSS
    if (url == "/styles.css")
    {
        auto* data = reinterpret_cast<const std::byte*>(BinaryData::styles_css);
        return juce::WebBrowserComponent::Resource{
            std::vector<std::byte>(data, data + BinaryData::styles_cssSize),
            "text/css"
        };
    }

    // JavaScript
    if (url == "/app.js")
    {
        auto* data = reinterpret_cast<const std::byte*>(BinaryData::app_js);
        return juce::WebBrowserComponent::Resource{
            std::vector<std::byte>(data, data + BinaryData::app_jsSize),
            "application/javascript"
        };
    }

    // Images
    if (url == "/logo.png")
    {
        auto* data = reinterpret_cast<const std::byte*>(BinaryData::logo_png);
        return juce::WebBrowserComponent::Resource{
            std::vector<std::byte>(data, data + BinaryData::logo_pngSize),
            "image/png"
        };
    }

    return std::nullopt;
}
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

## Parameter Range Conversions

Always use the parameter's built-in range for conversions:

```cpp
// Getting display value from normalized (0-1) parameter:
auto range = param->getNormalisableRange();
float displayValue = range.convertFrom0to1(param->getValue());

// Setting parameter from display value:
float normalized = range.convertTo0to1(displayValue);
param->setValueNotifyingHost(normalized);

// DON'T do manual conversions like:
// float displayValue = param->getValue() * 60.0f - 30.0f;  // Wrong!
```

## Best Practices

1. **JUCE version**: Use 8.0.12+ for macOS 15 compatibility
2. **Parameter sync frequency**: 30Hz is usually sufficient; higher rates waste CPU
3. **Debounce UI updates**: Don't send every mouse move - batch or throttle
4. **Handle load timing**: UI might request init before webview is fully ready
5. **Escape strings**: When building JavaScript, escape user-provided strings
6. **Error handling**: Check `window.__JUCE__` exists before calling backend
7. **Test on all platforms**: WebView2 (Windows) and WKWebView (macOS) may differ slightly
8. **Always call completion**: Native functions MUST call the completion callback

## Debugging

On macOS, use Safari's Develop menu to inspect WKWebView content:
1. Enable "Show Develop menu" in Safari preferences
2. Run your plugin in a DAW
3. Safari → Develop → [Your DAW name] → [WebView]

## Common Errors

### "no viable conversion from lambda to NativeFunction"
You're using the old callback signature. Use:
```cpp
[this](const juce::Array<juce::var>& args,
       juce::WebBrowserComponent::NativeFunctionCompletion completion) { ... }
```

### "no viable conversion from juce::String to std::vector<std::byte>"
JUCE 8 Resource requires `std::vector<std::byte>`:
```cpp
auto* data = reinterpret_cast<const std::byte*>(BinaryData::ui_html);
std::vector<std::byte>(data, data + BinaryData::ui_htmlSize)
```

### Native function not being called
Make sure your JavaScript uses the low-level API:
```javascript
window.__JUCE__.backend.emitEvent("__juce__invoke", {
    name: "functionName",
    params: [arg1, arg2],
    resultId: someId
});
```
