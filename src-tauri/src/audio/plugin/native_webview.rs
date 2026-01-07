//! Native WKWebView implementation for macOS
//!
//! This replaces `wry` to avoid Objective-C class name conflicts with Tauri.
//! Uses Apple's WKWebView directly via objc/cocoa crates.

use cocoa::base::{id, nil, NO, YES};
use cocoa::foundation::{NSRect, NSPoint, NSSize, NSString};
use objc::declare::ClassDecl;
use objc::runtime::{Class, Object, Sel};
use objc::{class, msg_send, sel, sel_impl};
use std::sync::Once;

/// A native WKWebView wrapper that doesn't conflict with Tauri's Wry
pub struct NativeWebView {
    webview: id,
    #[allow(dead_code)]
    message_handler: id,
}

// Message handler callback type
type MessageCallback = Box<dyn Fn(String) + Send + Sync>;
static mut MESSAGE_CALLBACK: Option<MessageCallback> = None;
static REGISTER_CLASS: Once = Once::new();

impl NativeWebView {
    /// Create a new WKWebView as a child of the given parent view
    pub fn new<F>(parent_view: id, frame: NSRect, on_message: F) -> Result<Self, String>
    where
        F: Fn(String) + Send + Sync + 'static,
    {
        unsafe {
            // Store callback globally (we'll improve this later with proper instance handling)
            MESSAGE_CALLBACK = Some(Box::new(on_message));

            // Register our custom message handler class (once)
            REGISTER_CLASS.call_once(|| {
                register_message_handler_class();
            });

            // Create WKWebViewConfiguration
            let config: id = msg_send![class!(WKWebViewConfiguration), new];

            // Create user content controller for JS->Rust IPC
            let user_content_controller: id = msg_send![config, userContentController];

            // Create our message handler instance
            let handler_class = Class::get("FreqlabMessageHandler").unwrap();
            let message_handler: id = msg_send![handler_class, new];

            // Register handler for "ipc" messages
            let handler_name = NSString::alloc(nil).init_str("ipc");
            let _: () = msg_send![user_content_controller, addScriptMessageHandler:message_handler name:handler_name];

            // Add initialization script for JS bridge
            let init_script = r#"
                window.ipc = {
                    postMessage: function(msg) {
                        window.webkit.messageHandlers.ipc.postMessage(msg);
                    }
                };
                window.sendToPlugin = function(msg) {
                    window.ipc.postMessage(JSON.stringify(msg));
                };
                window.onPluginMessage = function() {};
                window.onPluginMessageInternal = function(msg) {
                    const json = JSON.parse(msg);
                    window.onPluginMessage && window.onPluginMessage(json);
                };
            "#;

            let script_class = class!(WKUserScript);
            let script_str = NSString::alloc(nil).init_str(init_script);
            let script: id = msg_send![script_class, alloc];
            let script: id = msg_send![script,
                initWithSource:script_str
                injectionTime:0i64  // WKUserScriptInjectionTimeAtDocumentStart
                forMainFrameOnly:YES
            ];
            let _: () = msg_send![user_content_controller, addUserScript:script];

            // Create WKWebView with configuration
            let webview_class = class!(WKWebView);
            let webview: id = msg_send![webview_class, alloc];
            let webview: id = msg_send![webview, initWithFrame:frame configuration:config];

            if webview == nil {
                return Err("Failed to create WKWebView".to_string());
            }

            // Make webview layer-backed for proper rendering
            let _: () = msg_send![webview, setWantsLayer:YES];

            // Add to parent view
            let _: () = msg_send![parent_view, addSubview:webview];

            // Set autoresizing mask to fill parent
            let autoresizing_mask: u64 = 1 | 2 | 4 | 8 | 16 | 32; // NSViewWidthSizable | NSViewHeightSizable | all margins
            let _: () = msg_send![webview, setAutoresizingMask:autoresizing_mask];

            Ok(NativeWebView {
                webview,
                message_handler,
            })
        }
    }

    /// Load HTML string
    pub fn load_html(&self, html: &str) {
        unsafe {
            let html_str = NSString::alloc(nil).init_str(html);
            let base_url: id = nil;
            let _: () = msg_send![self.webview, loadHTMLString:html_str baseURL:base_url];
        }
    }

    /// Load URL
    pub fn load_url(&self, url: &str) {
        unsafe {
            let url_str = NSString::alloc(nil).init_str(url);
            let nsurl: id = msg_send![class!(NSURL), URLWithString:url_str];
            let request: id = msg_send![class!(NSURLRequest), requestWithURL:nsurl];
            let _: () = msg_send![self.webview, loadRequest:request];
        }
    }

    /// Evaluate JavaScript and send message to web content
    pub fn evaluate_script(&self, script: &str) {
        unsafe {
            let script_str = NSString::alloc(nil).init_str(script);
            let _: () = msg_send![self.webview, evaluateJavaScript:script_str completionHandler:nil];
        }
    }

    /// Send JSON message to web content (calls onPluginMessageInternal)
    pub fn send_json(&self, json: &str) {
        let escaped = json.replace('\\', "\\\\").replace('"', "\\\"");
        let script = format!("onPluginMessageInternal(\"{}\");", escaped);
        self.evaluate_script(&script);
    }

    /// Set the frame/bounds of the webview
    pub fn set_bounds(&self, x: i32, y: i32, width: u32, height: u32) {
        unsafe {
            let frame = NSRect::new(
                NSPoint::new(x as f64, y as f64),
                NSSize::new(width as f64, height as f64),
            );
            let _: () = msg_send![self.webview, setFrame:frame];
        }
    }

    /// Enable developer tools
    pub fn set_developer_mode(&self, enabled: bool) {
        unsafe {
            // Get preferences and enable developer extras
            let preferences: id = msg_send![self.webview, configuration];
            let preferences: id = msg_send![preferences, preferences];
            let key = NSString::alloc(nil).init_str("developerExtrasEnabled");
            let _: () = msg_send![preferences, setValue:(if enabled { YES } else { NO }) forKey:key];
        }
    }

    /// Get the underlying NSView (for parent attachment)
    pub fn view(&self) -> id {
        self.webview
    }
}

impl Drop for NativeWebView {
    fn drop(&mut self) {
        unsafe {
            // Remove from superview
            let _: () = msg_send![self.webview, removeFromSuperview];

            // Clean up message handler
            let config: id = msg_send![self.webview, configuration];
            let controller: id = msg_send![config, userContentController];
            let handler_name = NSString::alloc(nil).init_str("ipc");
            let _: () = msg_send![controller, removeScriptMessageHandlerForName:handler_name];
        }
    }
}

unsafe impl Send for NativeWebView {}
unsafe impl Sync for NativeWebView {}

/// Register the FreqlabMessageHandler Objective-C class
fn register_message_handler_class() {
    let superclass = class!(NSObject);
    let mut decl = ClassDecl::new("FreqlabMessageHandler", superclass).unwrap();

    // Implement WKScriptMessageHandler protocol method
    extern "C" fn did_receive_message(_this: &Object, _sel: Sel, _controller: id, message: id) {
        unsafe {
            // Get message body (should be a string)
            let body: id = msg_send![message, body];

            // Convert to Rust string
            let body_str: *const std::os::raw::c_char = msg_send![body, UTF8String];
            if !body_str.is_null() {
                let rust_str = std::ffi::CStr::from_ptr(body_str)
                    .to_string_lossy()
                    .to_string();

                // Call the callback
                if let Some(ref callback) = MESSAGE_CALLBACK {
                    callback(rust_str);
                }
            }
        }
    }

    unsafe {
        decl.add_method(
            sel!(userContentController:didReceiveScriptMessage:),
            did_receive_message as extern "C" fn(&Object, Sel, id, id),
        );
    }

    decl.register();
}
