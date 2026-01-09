//! Modular knowledge base for per-project CLAUDE.md generation
//!
//! Contains DSP best practices, anti-hallucination guardrails,
//! and plugin-specific patterns compiled into the binary.

pub mod dsp_fundamentals;
pub mod effect_patterns;
pub mod instrument_patterns;
pub mod mastering_patterns;
pub mod nih_plug_basics;
pub mod rust_audio_libs;
pub mod safety_rails;
pub mod sampler_patterns;

// Re-export content functions for easy access
pub use dsp_fundamentals::get_dsp_fundamentals;
pub use effect_patterns::get_effect_patterns;
pub use instrument_patterns::get_instrument_patterns;
pub use mastering_patterns::get_mastering_patterns;
pub use nih_plug_basics::get_nih_plug_basics;
pub use rust_audio_libs::get_rust_audio_libs;
pub use safety_rails::get_safety_rails;
pub use sampler_patterns::get_sampler_patterns;
