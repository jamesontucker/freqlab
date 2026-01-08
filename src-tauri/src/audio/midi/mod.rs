//! MIDI handling for instrument plugins
//!
//! Provides MIDI event types, queuing, and playback for instrument plugins.

mod events;

pub use events::{MidiEvent, MidiEventQueue};
