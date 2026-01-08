//! MIDI pattern player with BPM-based scheduling

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use parking_lot::Mutex;

use super::events::MidiEventQueue;
use super::patterns::get_pattern;

/// Active notes tracker for sending note-offs
struct ActiveNote {
    note: u8,
    end_beat: f32,
}

/// Shared state between player thread and main thread
struct PlayerSharedState {
    /// Current playback state
    is_playing: AtomicBool,
    /// BPM (stored as u32 for atomic access)
    bpm: AtomicU32,
    /// Octave shift (-24 to +24 semitones, stored as i8 in u32)
    octave_shift: AtomicU32,
    /// Whether to loop
    is_looping: AtomicBool,
    /// Signal to stop the thread
    should_stop: AtomicBool,
    /// Current pattern ID (protected by mutex for string access)
    current_pattern: Mutex<Option<String>>,
    /// MIDI event queue to send notes to (shared with plugin)
    midi_queue: Mutex<Option<Arc<MidiEventQueue>>>,
}

/// MIDI pattern player
pub struct MidiPlayer {
    shared: Arc<PlayerSharedState>,
    thread_handle: Option<thread::JoinHandle<()>>,
}

impl MidiPlayer {
    /// Create a new MIDI player
    pub fn new() -> Self {
        let shared = Arc::new(PlayerSharedState {
            is_playing: AtomicBool::new(false),
            bpm: AtomicU32::new(120),
            octave_shift: AtomicU32::new(0), // 0 = no shift
            is_looping: AtomicBool::new(true),
            should_stop: AtomicBool::new(false),
            current_pattern: Mutex::new(None),
            midi_queue: Mutex::new(None),
        });

        let shared_clone = Arc::clone(&shared);
        let thread_handle = thread::spawn(move || {
            player_thread(shared_clone);
        });

        Self {
            shared,
            thread_handle: Some(thread_handle),
        }
    }

    /// Set the MIDI queue (called when plugin is loaded)
    pub fn set_midi_queue(&self, queue: Option<Arc<MidiEventQueue>>) {
        *self.shared.midi_queue.lock() = queue;
    }

    /// Start playing a pattern
    pub fn play(&self, pattern_id: &str, bpm: u32, octave_shift: i8, looping: bool) -> Result<(), String> {
        log::info!("MidiPlayer::play: pattern={}, bpm={}", pattern_id, bpm);

        // Verify pattern exists
        if get_pattern(pattern_id).is_none() {
            return Err(format!("Pattern not found: {}", pattern_id));
        }

        // Check if we have a MIDI queue
        let has_queue = self.shared.midi_queue.lock().is_some();
        if !has_queue {
            log::warn!("MidiPlayer::play: no MIDI queue set, playback may not work");
        }

        // Stop current playback first
        self.stop();

        // Set parameters
        self.shared.bpm.store(bpm, Ordering::SeqCst);
        self.shared.octave_shift.store(octave_shift as i8 as u8 as u32, Ordering::SeqCst);
        self.shared.is_looping.store(looping, Ordering::SeqCst);
        *self.shared.current_pattern.lock() = Some(pattern_id.to_string());

        // Start playback
        self.shared.is_playing.store(true, Ordering::SeqCst);
        log::info!("MidiPlayer::play: playback started");

        Ok(())
    }

    /// Stop playback
    pub fn stop(&self) {
        self.shared.is_playing.store(false, Ordering::SeqCst);
        // Send all notes off
        if let Some(queue) = self.shared.midi_queue.lock().as_ref() {
            queue.all_notes_off();
        }
    }

    /// Set BPM (takes effect immediately)
    pub fn set_bpm(&self, bpm: u32) {
        self.shared.bpm.store(bpm.clamp(20, 400), Ordering::SeqCst);
    }

    /// Set octave shift (takes effect on next loop)
    pub fn set_octave_shift(&self, shift: i8) {
        self.shared.octave_shift.store(shift as i8 as u8 as u32, Ordering::SeqCst);
    }

    /// Set looping
    pub fn set_looping(&self, looping: bool) {
        self.shared.is_looping.store(looping, Ordering::SeqCst);
    }

    /// Check if playing
    pub fn is_playing(&self) -> bool {
        self.shared.is_playing.load(Ordering::SeqCst)
    }

    /// Get current BPM
    pub fn get_bpm(&self) -> u32 {
        self.shared.bpm.load(Ordering::SeqCst)
    }
}

impl Drop for MidiPlayer {
    fn drop(&mut self) {
        // Signal thread to stop
        self.shared.should_stop.store(true, Ordering::SeqCst);
        self.shared.is_playing.store(false, Ordering::SeqCst);

        // Wait for thread to finish
        if let Some(handle) = self.thread_handle.take() {
            let _ = handle.join();
        }
    }
}

/// Player thread function
fn player_thread(shared: Arc<PlayerSharedState>) {
    let mut playback_position: f32 = 0.0;
    let mut last_tick = Instant::now();
    let mut active_notes: Vec<ActiveNote> = Vec::new();

    // Tick intervals
    let active_tick = Duration::from_millis(1);  // 1ms when playing for tight timing
    let idle_tick = Duration::from_millis(50);   // 50ms when idle to save CPU

    loop {
        // Check if we should exit
        if shared.should_stop.load(Ordering::SeqCst) {
            break;
        }

        // Check if playing
        if !shared.is_playing.load(Ordering::SeqCst) {
            // Reset position when stopped
            playback_position = 0.0;
            active_notes.clear();
            last_tick = Instant::now();
            // Sleep longer when idle to save CPU
            thread::sleep(idle_tick);
            continue;
        }

        // Sleep for active tick interval
        thread::sleep(active_tick);

        // Get MIDI queue - if none, stop playback
        let midi_queue = match shared.midi_queue.lock().clone() {
            Some(q) => q,
            None => {
                shared.is_playing.store(false, Ordering::SeqCst);
                continue;
            }
        };

        // Get current parameters
        let bpm = shared.bpm.load(Ordering::SeqCst) as f32;
        let octave_shift = shared.octave_shift.load(Ordering::SeqCst) as u8 as i8;
        let is_looping = shared.is_looping.load(Ordering::SeqCst);

        // Get pattern
        let pattern_id = shared.current_pattern.lock().clone();
        let pattern = match pattern_id.as_ref().and_then(|id| get_pattern(id)) {
            Some(p) => p,
            None => {
                shared.is_playing.store(false, Ordering::SeqCst);
                continue;
            }
        };

        // Calculate time delta and advance position
        let now = Instant::now();
        let dt = now.duration_since(last_tick).as_secs_f32();
        last_tick = now;

        // Convert BPM to beats per second
        let beats_per_second = bpm / 60.0;
        let beat_delta = dt * beats_per_second;
        let old_position = playback_position;
        playback_position += beat_delta;

        // Check for note-offs (notes that have ended)
        active_notes.retain(|active| {
            if playback_position >= active.end_beat {
                midi_queue.note_off(active.note);
                false
            } else {
                true
            }
        });

        // Check for note-ons (notes that should start)
        for pattern_note in pattern.notes {
            let note_start = pattern_note.beat;
            let note_end = pattern_note.beat + pattern_note.duration;

            // Check if this note should trigger in this tick
            if note_start >= old_position && note_start < playback_position {
                // Apply octave shift
                let shifted_note = (pattern_note.note as i16 + (octave_shift as i16 * 12))
                    .clamp(0, 127) as u8;

                // Send note on
                midi_queue.note_on(shifted_note, pattern_note.velocity);

                // Track for note-off
                active_notes.push(ActiveNote {
                    note: shifted_note,
                    end_beat: note_end,
                });
            }
        }

        // Check for loop or end
        if playback_position >= pattern.length_beats {
            // Send note-offs for all active notes
            for active in &active_notes {
                midi_queue.note_off(active.note);
            }
            active_notes.clear();

            if is_looping {
                // Loop back to start
                playback_position = playback_position - pattern.length_beats;
            } else {
                // Stop playback
                shared.is_playing.store(false, Ordering::SeqCst);
                playback_position = 0.0;
            }
        }
    }

    // Clean up - send all notes off
    if let Some(queue) = shared.midi_queue.lock().as_ref() {
        queue.all_notes_off();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_player_creation() {
        let player = MidiPlayer::new();
        assert!(!player.is_playing());
        assert_eq!(player.get_bpm(), 120);
    }

    #[test]
    fn test_bpm_clamp() {
        let player = MidiPlayer::new();

        player.set_bpm(10); // Below min
        assert_eq!(player.get_bpm(), 20);

        player.set_bpm(500); // Above max
        assert_eq!(player.get_bpm(), 400);
    }
}
