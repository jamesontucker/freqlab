//! MIDI pattern and file player with BPM-based scheduling

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use parking_lot::Mutex;

use super::events::MidiEventQueue;
use super::file::{MidiFileNote, TempoEvent};
use super::patterns::get_pattern;

/// Active notes tracker for sending note-offs
struct ActiveNote {
    note: u8,
    end_beat: f32,
}

/// Playback source type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum PlaybackSource {
    Pattern = 0,
    MidiFile = 1,
}

/// Shared state between player thread and main thread
struct PlayerSharedState {
    /// Current playback state
    is_playing: AtomicBool,
    /// BPM (stored as u32 for atomic access) - used when tempo automation is off
    bpm: AtomicU32,
    /// Octave shift (-24 to +24 semitones, stored as i8 in u32)
    octave_shift: AtomicU32,
    /// Whether to loop
    is_looping: AtomicBool,
    /// Signal to stop the thread
    should_stop: AtomicBool,
    /// Playback source type (0 = Pattern, 1 = MidiFile)
    source_type: AtomicU8,
    /// Whether to use tempo automation for MIDI files
    use_tempo_automation: AtomicBool,
    /// Current playback position in beats (stored as f32 bits in u32)
    playback_position_bits: AtomicU32,
    /// Current duration in beats (stored as f32 bits in u32)
    duration_beats_bits: AtomicU32,
    /// Seek request position in beats (f32::MAX bits = no seek pending)
    seek_request_bits: AtomicU32,
    /// Version counter for MIDI file data (incremented on each track change)
    midi_data_version: AtomicU32,
    /// Version counter for MIDI queue (incremented when queue changes, e.g., hot reload)
    midi_queue_version: AtomicU32,
    /// Current pattern ID (protected by mutex for string access)
    current_pattern: Mutex<Option<String>>,
    /// Loaded MIDI file notes (protected by mutex)
    midi_file_notes: Mutex<Option<MidiFileData>>,
    /// MIDI event queue to send notes to (shared with plugin)
    midi_queue: Mutex<Option<Arc<MidiEventQueue>>>,
}

/// Data for MIDI file playback
#[derive(Clone)]
struct MidiFileData {
    notes: Vec<MidiFileNote>,
    duration_beats: f32,
    tempo_map: Vec<TempoEvent>,
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
            source_type: AtomicU8::new(PlaybackSource::Pattern as u8),
            use_tempo_automation: AtomicBool::new(false),
            playback_position_bits: AtomicU32::new(0.0_f32.to_bits()),
            duration_beats_bits: AtomicU32::new(0.0_f32.to_bits()),
            seek_request_bits: AtomicU32::new(f32::MAX.to_bits()), // No seek pending
            midi_data_version: AtomicU32::new(0),
            midi_queue_version: AtomicU32::new(0),
            current_pattern: Mutex::new(None),
            midi_file_notes: Mutex::new(None),
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

    /// Set the MIDI queue (called when plugin is loaded/reloaded)
    /// Increments version counter so player thread refreshes its cache
    pub fn set_midi_queue(&self, queue: Option<Arc<MidiEventQueue>>) {
        *self.shared.midi_queue.lock() = queue;
        // Increment version to signal player thread to refresh its cached queue
        self.shared.midi_queue_version.fetch_add(1, Ordering::SeqCst);
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

        // Set source type to pattern
        self.shared.source_type.store(PlaybackSource::Pattern as u8, Ordering::SeqCst);

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

    /// Start playing a MIDI file track
    pub fn play_midi_file(
        &self,
        notes: Vec<MidiFileNote>,
        duration_beats: f32,
        bpm: u32,
        octave_shift: i8,
        looping: bool,
        tempo_map: Vec<TempoEvent>,
        use_tempo_automation: bool,
    ) -> Result<(), String> {
        log::info!("MidiPlayer::play_midi_file: {} notes, duration={} beats, bpm={}, tempo_auto={}",
            notes.len(), duration_beats, bpm, use_tempo_automation);

        if notes.is_empty() {
            return Err("No notes to play".to_string());
        }

        // Check if we have a MIDI queue
        let has_queue = self.shared.midi_queue.lock().is_some();
        if !has_queue {
            log::warn!("MidiPlayer::play_midi_file: no MIDI queue set, playback may not work");
        }

        // Stop current playback first
        self.stop();

        // Set source type to MIDI file
        self.shared.source_type.store(PlaybackSource::MidiFile as u8, Ordering::SeqCst);

        // Set parameters
        self.shared.bpm.store(bpm, Ordering::SeqCst);
        self.shared.octave_shift.store(octave_shift as i8 as u8 as u32, Ordering::SeqCst);
        self.shared.is_looping.store(looping, Ordering::SeqCst);
        self.shared.use_tempo_automation.store(use_tempo_automation, Ordering::SeqCst);

        // Store MIDI file data and bump version to invalidate cache
        *self.shared.midi_file_notes.lock() = Some(MidiFileData {
            notes,
            duration_beats,
            tempo_map,
        });
        self.shared.midi_data_version.fetch_add(1, Ordering::SeqCst);

        // Start playback
        self.shared.is_playing.store(true, Ordering::SeqCst);
        log::info!("MidiPlayer::play_midi_file: playback started");

        Ok(())
    }

    /// Set tempo automation mode (takes effect immediately)
    pub fn set_tempo_automation(&self, enabled: bool) {
        self.shared.use_tempo_automation.store(enabled, Ordering::SeqCst);
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

    /// Get current playback source
    pub fn get_source(&self) -> PlaybackSource {
        match self.shared.source_type.load(Ordering::SeqCst) {
            1 => PlaybackSource::MidiFile,
            _ => PlaybackSource::Pattern,
        }
    }

    /// Get current playback position in beats
    pub fn get_position(&self) -> f32 {
        f32::from_bits(self.shared.playback_position_bits.load(Ordering::SeqCst))
    }

    /// Get current duration in beats
    pub fn get_duration(&self) -> f32 {
        f32::from_bits(self.shared.duration_beats_bits.load(Ordering::SeqCst))
    }

    /// Seek to a position in beats (will be processed on next tick)
    pub fn seek(&self, position_beats: f32) {
        self.shared.seek_request_bits.store(position_beats.to_bits(), Ordering::SeqCst);
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

    // Cached state to avoid locking every tick
    let mut cached_queue: Option<Arc<MidiEventQueue>> = None;
    let mut cached_queue_version: u32 = 0;
    let mut cached_pattern_id: Option<String> = None;
    let mut cached_pattern: Option<&'static super::patterns::Pattern> = None;
    let mut cached_source_type: u8 = PlaybackSource::Pattern as u8;
    let mut cached_midi_file: Option<MidiFileData> = None;
    let mut cached_midi_version: u32 = 0;

    loop {
        // Check if we should exit
        if shared.should_stop.load(Ordering::SeqCst) {
            break;
        }

        // Check if playing
        if !shared.is_playing.load(Ordering::SeqCst) {
            // Reset position and cache when stopped
            playback_position = 0.0;
            shared.playback_position_bits.store(0.0_f32.to_bits(), Ordering::SeqCst);
            active_notes.clear();
            cached_pattern_id = None;
            cached_pattern = None;
            cached_midi_file = None;
            cached_queue = None; // Clear queue cache so it refreshes on next play
            last_tick = Instant::now();
            // Sleep longer when idle to save CPU
            thread::sleep(idle_tick);
            continue;
        }

        // Sleep for active tick interval
        thread::sleep(active_tick);

        // Check if queue version changed (e.g., hot reload) and refresh cache if so
        let current_queue_version = shared.midi_queue_version.load(Ordering::SeqCst);
        if cached_queue.is_none() || cached_queue_version != current_queue_version {
            if let Some(guard) = shared.midi_queue.try_lock() {
                cached_queue = guard.clone();
                cached_queue_version = current_queue_version;
            }
        }

        // Get MIDI queue from cache - if none, stop playback
        let midi_queue = match &cached_queue {
            Some(q) => q.clone(),
            None => {
                shared.is_playing.store(false, Ordering::SeqCst);
                continue;
            }
        };

        // Check for seek request
        let seek_bits = shared.seek_request_bits.load(Ordering::SeqCst);
        let seek_pos = f32::from_bits(seek_bits);
        if seek_pos != f32::MAX {
            // Clear the seek request
            shared.seek_request_bits.store(f32::MAX.to_bits(), Ordering::SeqCst);
            // Apply seek - stop all active notes first
            for active in active_notes.drain(..) {
                midi_queue.note_off(active.note);
            }
            playback_position = seek_pos.max(0.0);
            last_tick = Instant::now(); // Reset timing
            // Update position atomic immediately
            shared.playback_position_bits.store(playback_position.to_bits(), Ordering::SeqCst);
        }

        // Get current parameters (atomics are fast, no lock needed)
        let bpm = shared.bpm.load(Ordering::SeqCst) as f32;
        let octave_shift = shared.octave_shift.load(Ordering::SeqCst) as u8 as i8;
        let is_looping = shared.is_looping.load(Ordering::SeqCst);
        let source_type = shared.source_type.load(Ordering::SeqCst);

        // Check if source type changed
        if source_type != cached_source_type {
            cached_source_type = source_type;
            // Reset position on source change
            playback_position = 0.0;
            // Send note-offs for any active notes
            for active in active_notes.drain(..) {
                midi_queue.note_off(active.note);
            }
            // Clear caches
            cached_pattern_id = None;
            cached_pattern = None;
            cached_midi_file = None;
        }

        // Get notes and duration based on source type
        let (notes_slice, duration_beats): (&[_], f32) = if source_type == PlaybackSource::MidiFile as u8 {
            // MIDI file mode - get notes from cached midi file
            // Check version to detect track switches during playback
            let current_version = shared.midi_data_version.load(Ordering::SeqCst);
            if cached_midi_file.is_none() || cached_midi_version != current_version {
                if let Some(guard) = shared.midi_file_notes.try_lock() {
                    // Track switch detected - clear active notes to avoid stuck notes
                    if cached_midi_version != current_version && cached_midi_file.is_some() {
                        log::info!("MIDI track switched during playback, clearing active notes");
                        for active in active_notes.drain(..) {
                            midi_queue.note_off(active.note);
                        }
                    }
                    cached_midi_file = guard.clone();
                    cached_midi_version = current_version;
                }
            }

            match &cached_midi_file {
                Some(data) => {
                    let duration = data.duration_beats;
                    // Update duration atomic
                    shared.duration_beats_bits.store(duration.to_bits(), Ordering::SeqCst);
                    let use_tempo_auto = shared.use_tempo_automation.load(Ordering::SeqCst);

                    // Calculate time delta
                    let now = Instant::now();
                    let dt = now.duration_since(last_tick).as_secs_f32();
                    last_tick = now;

                    // Get current BPM - either from tempo map or fixed BPM
                    let current_bpm = if use_tempo_auto && !data.tempo_map.is_empty() {
                        // Find the tempo event that applies at current position
                        // (last tempo event with beat <= playback_position)
                        let mut tempo_bpm = data.tempo_map[0].bpm;
                        for event in &data.tempo_map {
                            if event.beat <= playback_position {
                                tempo_bpm = event.bpm;
                            } else {
                                break;
                            }
                        }
                        tempo_bpm
                    } else {
                        bpm
                    };

                    let beats_per_second = current_bpm / 60.0;
                    let beat_delta = dt * beats_per_second;
                    let old_position = playback_position;
                    playback_position += beat_delta;
                    // Update position atomic
                    shared.playback_position_bits.store(playback_position.to_bits(), Ordering::SeqCst);

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
                    for file_note in &data.notes {
                        let note_start = file_note.beat;
                        let note_end = file_note.beat + file_note.duration;

                        if note_start >= old_position && note_start < playback_position {
                            // Apply octave shift
                            let shifted_note = (file_note.note as i16 + (octave_shift as i16 * 12))
                                .clamp(0, 127) as u8;

                            midi_queue.note_on(shifted_note, file_note.velocity);

                            active_notes.push(ActiveNote {
                                note: shifted_note,
                                end_beat: note_end,
                            });
                        }
                    }

                    // Check for loop or end
                    if playback_position >= duration {
                        for active in &active_notes {
                            midi_queue.note_off(active.note);
                        }
                        active_notes.clear();

                        if is_looping {
                            playback_position = playback_position - duration;
                        } else {
                            shared.is_playing.store(false, Ordering::SeqCst);
                            playback_position = 0.0;
                        }
                        // Update position atomic after loop/stop
                        shared.playback_position_bits.store(playback_position.to_bits(), Ordering::SeqCst);
                    }

                    continue; // Skip pattern processing
                }
                None => {
                    shared.is_playing.store(false, Ordering::SeqCst);
                    continue;
                }
            }
        } else {
            // Pattern mode - check if pattern changed (only lock when needed)
            let current_pattern_id = if let Some(guard) = shared.current_pattern.try_lock() {
                guard.clone()
            } else {
                cached_pattern_id.clone()
            };

            // Update cached pattern if ID changed
            if current_pattern_id != cached_pattern_id {
                cached_pattern_id = current_pattern_id.clone();
                cached_pattern = current_pattern_id.as_ref().and_then(|id| get_pattern(id));
                playback_position = 0.0;
                for active in active_notes.drain(..) {
                    midi_queue.note_off(active.note);
                }
            }

            match cached_pattern {
                Some(p) => (p.notes, p.length_beats),
                None => {
                    shared.is_playing.store(false, Ordering::SeqCst);
                    continue;
                }
            }
        };

        // Calculate time delta and advance position
        let now = Instant::now();
        let dt = now.duration_since(last_tick).as_secs_f32();
        last_tick = now;

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

        // Check for note-ons (notes that should start) - Pattern mode only (MIDI file handled above)
        for pattern_note in notes_slice {
            let note_start = pattern_note.beat;
            let note_end = pattern_note.beat + pattern_note.duration;

            if note_start >= old_position && note_start < playback_position {
                let shifted_note = (pattern_note.note as i16 + (octave_shift as i16 * 12))
                    .clamp(0, 127) as u8;

                midi_queue.note_on(shifted_note, pattern_note.velocity);

                active_notes.push(ActiveNote {
                    note: shifted_note,
                    end_beat: note_end,
                });
            }
        }

        // Check for loop or end
        if playback_position >= duration_beats {
            for active in &active_notes {
                midi_queue.note_off(active.note);
            }
            active_notes.clear();

            if is_looping {
                playback_position = playback_position - duration_beats;
            } else {
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
