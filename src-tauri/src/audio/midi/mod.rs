//! MIDI handling for instrument plugins
//!
//! Provides MIDI event types, queuing, pattern playback, and MIDI file support.

mod events;
pub mod patterns;
mod player;

pub use events::{MidiEvent, MidiEventQueue};
pub use patterns::{PatternCategory, PatternInfo, list_patterns, get_pattern};
pub use player::MidiPlayer;
