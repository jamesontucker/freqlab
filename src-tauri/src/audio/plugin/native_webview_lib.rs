//! WebView editor for nih-plug using native WKWebView
//!
//! This is a modified version that uses native macOS WKWebView instead of wry,
//! avoiding Objective-C class name conflicts with Tauri's Wry.
//!
//! **macOS only** - Windows/Linux support coming soon.

#[cfg(target_os = "macos")]
mod native_webview;

#[cfg(target_os = "macos")]
use native_webview::NativeWebView;

use baseview::{Event, Size, Window, WindowHandle, WindowOpenOptions, WindowScalePolicy};
use nih_plug::prelude::{Editor, GuiContext, ParamSetter};
use serde_json::Value;
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
};
use crossbeam::channel::{unbounded, Receiver, Sender};
use parking_lot::Mutex;

#[cfg(target_os = "macos")]
use cocoa::foundation::{NSRect, NSPoint, NSSize};
#[cfg(target_os = "macos")]
use raw_window_handle::HasRawWindowHandle;

pub use baseview::{DropData, DropEffect, EventStatus, MouseEvent};
pub use keyboard_types::*;

type EventLoopHandler = dyn Fn(&WindowHandler, ParamSetter, &mut Window) + Send + Sync;
type KeyboardHandler = dyn Fn(KeyboardEvent) -> bool + Send + Sync;
type MouseHandler = dyn Fn(MouseEvent) -> EventStatus + Send + Sync;

pub struct WebViewEditor {
    source: Arc<HTMLSource>,
    width: Arc<AtomicU32>,
    height: Arc<AtomicU32>,
    event_loop_handler: Arc<EventLoopHandler>,
    keyboard_handler: Arc<KeyboardHandler>,
    mouse_handler: Arc<MouseHandler>,
    developer_mode: bool,
    background_color: (u8, u8, u8, u8),
}

pub enum HTMLSource {
    String(&'static str),
    URL(&'static str),
}

impl WebViewEditor {
    pub fn new(source: HTMLSource, size: (u32, u32)) -> Self {
        let width = Arc::new(AtomicU32::new(size.0));
        let height = Arc::new(AtomicU32::new(size.1));
        Self {
            source: Arc::new(source),
            width,
            height,
            developer_mode: false,
            background_color: (255, 255, 255, 255),
            event_loop_handler: Arc::new(|_, _, _| {}),
            keyboard_handler: Arc::new(|_| false),
            mouse_handler: Arc::new(|_| EventStatus::Ignored),
        }
    }

    pub fn with_background_color(mut self, background_color: (u8, u8, u8, u8)) -> Self {
        self.background_color = background_color;
        self
    }

    pub fn with_event_loop<F>(mut self, handler: F) -> Self
    where
        F: Fn(&WindowHandler, ParamSetter, &mut baseview::Window) + 'static + Send + Sync,
    {
        self.event_loop_handler = Arc::new(handler);
        self
    }

    pub fn with_developer_mode(mut self, mode: bool) -> Self {
        self.developer_mode = mode;
        self
    }

    pub fn with_keyboard_handler<F>(mut self, handler: F) -> Self
    where
        F: Fn(KeyboardEvent) -> bool + Send + Sync + 'static,
    {
        self.keyboard_handler = Arc::new(handler);
        self
    }

    pub fn with_mouse_handler<F>(mut self, handler: F) -> Self
    where
        F: Fn(MouseEvent) -> EventStatus + Send + Sync + 'static,
    {
        self.mouse_handler = Arc::new(handler);
        self
    }
}

#[cfg(target_os = "macos")]
pub struct WindowHandler {
    context: Arc<dyn GuiContext>,
    event_loop_handler: Arc<EventLoopHandler>,
    keyboard_handler: Arc<KeyboardHandler>,
    mouse_handler: Arc<MouseHandler>,
    webview: Arc<Mutex<NativeWebView>>,
    events_receiver: Receiver<Value>,
    pub width: Arc<AtomicU32>,
    pub height: Arc<AtomicU32>,
}

#[cfg(not(target_os = "macos"))]
pub struct WindowHandler {
    context: Arc<dyn GuiContext>,
    event_loop_handler: Arc<EventLoopHandler>,
    keyboard_handler: Arc<KeyboardHandler>,
    mouse_handler: Arc<MouseHandler>,
    events_receiver: Receiver<Value>,
    pub width: Arc<AtomicU32>,
    pub height: Arc<AtomicU32>,
}

impl WindowHandler {
    #[cfg(target_os = "macos")]
    pub fn resize(&self, window: &mut baseview::Window, width: u32, height: u32) {
        self.webview.lock().set_bounds(0, 0, width, height);
        self.width.store(width, Ordering::Relaxed);
        self.height.store(height, Ordering::Relaxed);
        self.context.request_resize();
        window.resize(Size {
            width: width as f64,
            height: height as f64,
        });
    }

    #[cfg(not(target_os = "macos"))]
    pub fn resize(&self, window: &mut baseview::Window, width: u32, height: u32) {
        self.width.store(width, Ordering::Relaxed);
        self.height.store(height, Ordering::Relaxed);
        self.context.request_resize();
        window.resize(Size {
            width: width as f64,
            height: height as f64,
        });
    }

    #[cfg(target_os = "macos")]
    pub fn send_json(&self, json: Value) {
        let json_str = json.to_string();
        self.webview.lock().send_json(&json_str);
    }

    #[cfg(not(target_os = "macos"))]
    pub fn send_json(&self, _json: Value) {
        // Not implemented for non-macOS platforms yet
    }

    pub fn next_event(&self) -> Result<Value, crossbeam::channel::TryRecvError> {
        self.events_receiver.try_recv()
    }
}

impl baseview::WindowHandler for WindowHandler {
    fn on_frame(&mut self, window: &mut baseview::Window) {
        let setter = ParamSetter::new(&*self.context);
        (self.event_loop_handler)(&self, setter, window);
    }

    fn on_event(&mut self, _window: &mut baseview::Window, event: Event) -> EventStatus {
        match event {
            Event::Keyboard(event) => {
                if (self.keyboard_handler)(event) {
                    EventStatus::Captured
                } else {
                    EventStatus::Ignored
                }
            }
            Event::Mouse(mouse_event) => (self.mouse_handler)(mouse_event),
            _ => EventStatus::Ignored,
        }
    }
}

struct Instance {
    window_handle: WindowHandle,
}

impl Drop for Instance {
    fn drop(&mut self) {
        self.window_handle.close();
    }
}

unsafe impl Send for Instance {}

impl Editor for WebViewEditor {
    fn spawn(
        &self,
        parent: nih_plug::prelude::ParentWindowHandle,
        context: Arc<dyn GuiContext>,
    ) -> Box<dyn std::any::Any + Send> {
        let options = WindowOpenOptions {
            scale: WindowScalePolicy::SystemScaleFactor,
            size: Size {
                width: self.width.load(Ordering::Relaxed) as f64,
                height: self.height.load(Ordering::Relaxed) as f64,
            },
            title: "Plug-in".to_owned(),
        };

        let width = self.width.clone();
        let height = self.height.clone();
        let developer_mode = self.developer_mode;
        let source = self.source.clone();
        let event_loop_handler = self.event_loop_handler.clone();
        let keyboard_handler = self.keyboard_handler.clone();
        let mouse_handler = self.mouse_handler.clone();

        #[cfg(target_os = "macos")]
        let window_handle = baseview::Window::open_parented(&parent, options, move |window| {
            let (events_sender, events_receiver): (Sender<Value>, Receiver<Value>) = unbounded();

            // Get the window's NSView
            let raw_handle = window.raw_window_handle();
            let parent_view = match raw_handle {
                raw_window_handle::RawWindowHandle::AppKit(handle) => {
                    handle.ns_view as cocoa::base::id
                }
                _ => panic!("Unsupported window handle type"),
            };

            let frame = NSRect::new(
                NSPoint::new(0.0, 0.0),
                NSSize::new(
                    width.load(Ordering::Relaxed) as f64,
                    height.load(Ordering::Relaxed) as f64,
                ),
            );

            // Create webview with message handler
            let sender = events_sender.clone();
            let webview = NativeWebView::new(parent_view, frame, move |msg: String| {
                if let Ok(json_value) = serde_json::from_str(&msg) {
                    let _ = sender.send(json_value);
                } else {
                    eprintln!("Invalid JSON from web view: {}.", msg);
                }
            })
            .expect("Failed to create native webview");

            // Enable dev tools if requested
            if developer_mode {
                webview.set_developer_mode(true);
            }

            // Load content
            match source.as_ref() {
                HTMLSource::String(html_str) => webview.load_html(html_str),
                HTMLSource::URL(url) => webview.load_url(url),
            }

            WindowHandler {
                context,
                event_loop_handler,
                webview: Arc::new(Mutex::new(webview)),
                events_receiver,
                keyboard_handler,
                mouse_handler,
                width,
                height,
            }
        });

        #[cfg(not(target_os = "macos"))]
        let window_handle = baseview::Window::open_parented(&parent, options, move |_window| {
            let (_events_sender, events_receiver): (Sender<Value>, Receiver<Value>) = unbounded();

            // Non-macOS: WebView not implemented yet
            eprintln!("WebView not implemented for this platform");

            WindowHandler {
                context,
                event_loop_handler,
                events_receiver,
                keyboard_handler,
                mouse_handler,
                width,
                height,
            }
        });

        Box::new(Instance { window_handle })
    }

    fn size(&self) -> (u32, u32) {
        (
            self.width.load(Ordering::Relaxed),
            self.height.load(Ordering::Relaxed),
        )
    }

    fn set_scale_factor(&self, _factor: f32) -> bool {
        false
    }

    fn param_values_changed(&self) {}

    fn param_value_changed(&self, _id: &str, _normalized_value: f32) {}

    fn param_modulation_changed(&self, _id: &str, _modulation_offset: f32) {}
}
