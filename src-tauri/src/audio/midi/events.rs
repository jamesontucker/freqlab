//! MIDI event types and queue for passing events to plugins
//!
//! Uses a lock-free ring buffer for high-performance MIDI event passing.
//! Producer side has a Mutex for multi-producer access (UI, patterns, devices).
//! Consumer side uses try_lock to avoid blocking the audio thread.

use ringbuf::{traits::*, HeapRb};
use parking_lot::Mutex;

/// MIDI event types that can be sent to plugins
#[derive(Debug, Clone, Copy)]
pub enum MidiEvent {
    /// Note on event
    NoteOn {
        /// MIDI note number (0-127)
        note: u8,
        /// Velocity (0-127)
        velocity: u8,
        /// MIDI channel (0-15)
        channel: u8,
    },
    /// Note off event
    NoteOff {
        /// MIDI note number (0-127)
        note: u8,
        /// Velocity (0-127, often ignored)
        velocity: u8,
        /// MIDI channel (0-15)
        channel: u8,
    },
    /// Control change (CC) event
    ControlChange {
        /// Controller number (0-127)
        controller: u8,
        /// Controller value (0-127)
        value: u8,
        /// MIDI channel (0-15)
        channel: u8,
    },
    /// Pitch bend event
    PitchBend {
        /// 14-bit pitch bend value (0-16383, center at 8192)
        value: u16,
        /// MIDI channel (0-15)
        channel: u8,
    },
    /// All notes off - send note off for all active notes
    AllNotesOff,
}

impl MidiEvent {
    /// Create a note on event on channel 0
    #[inline]
    pub fn note_on(note: u8, velocity: u8) -> Self {
        Self::NoteOn {
            note,
            velocity,
            channel: 0,
        }
    }

    /// Create a note off event on channel 0
    #[inline]
    pub fn note_off(note: u8) -> Self {
        Self::NoteOff {
            note,
            velocity: 0,
            channel: 0,
        }
    }

    /// Create a control change event
    #[inline]
    pub fn control_change(controller: u8, value: u8, channel: u8) -> Self {
        Self::ControlChange {
            controller,
            value,
            channel,
        }
    }

    /// Create a pitch bend event
    #[inline]
    pub fn pitch_bend(value: u16, channel: u8) -> Self {
        Self::PitchBend { value, channel }
    }
}

/// Thread-safe MIDI event queue using lock-free ring buffer
///
/// Producer side pushes events (from commands, patterns, devices)
/// Consumer side is read by the audio thread using try_lock to avoid blocking
pub struct MidiEventQueue {
    /// Producer side - Mutex for multi-producer access
    producer: Mutex<ringbuf::HeapProd<MidiEvent>>,
    /// Consumer side - Mutex but always use try_lock from audio thread
    consumer: Mutex<ringbuf::HeapCons<MidiEvent>>,
    /// Capacity for logging overflow warnings
    capacity: usize,
}

impl MidiEventQueue {
    /// Create a new MIDI event queue
    pub fn new(capacity: usize) -> Self {
        let rb = HeapRb::new(capacity);
        let (producer, consumer) = rb.split();
        Self {
            producer: Mutex::new(producer),
            consumer: Mutex::new(consumer),
            capacity,
        }
    }

    /// Push an event to the queue (called from command handlers)
    /// Returns true if successful, false if queue is full
    #[inline]
    pub fn push(&self, event: MidiEvent) -> bool {
        // Use try_lock to avoid blocking if consumer is draining
        // If we can't get the lock immediately, the event is dropped
        // This is acceptable for real-time audio - better to drop than block
        if let Some(mut producer) = self.producer.try_lock() {
            if producer.try_push(event).is_ok() {
                return true;
            }
            // Queue full - log at debug level to avoid spam
            log::debug!("MIDI queue full (capacity: {}), event dropped", self.capacity);
        }
        false
    }

    /// Push a note on event
    #[inline]
    pub fn note_on(&self, note: u8, velocity: u8) -> bool {
        self.push(MidiEvent::note_on(note, velocity))
    }

    /// Push a note off event
    #[inline]
    pub fn note_off(&self, note: u8) -> bool {
        self.push(MidiEvent::note_off(note))
    }

    /// Send all notes off
    #[inline]
    pub fn all_notes_off(&self) -> bool {
        self.push(MidiEvent::AllNotesOff)
    }

    /// Drain all events into a pre-allocated buffer (called from audio thread)
    ///
    /// This method clears the buffer and fills it with pending events.
    /// Uses try_lock to never block the audio thread - if lock is held,
    /// returns 0 events (they'll be picked up next callback).
    ///
    /// Returns the number of events drained.
    #[inline]
    pub fn drain_into(&self, buffer: &mut Vec<MidiEvent>) -> usize {
        buffer.clear();

        // CRITICAL: Use try_lock to avoid blocking audio thread
        // If producer is currently pushing, we skip this cycle
        // Events will be picked up on next audio callback (~1ms later)
        if let Some(mut consumer) = self.consumer.try_lock() {
            while let Some(event) = consumer.try_pop() {
                buffer.push(event);
            }
        }

        buffer.len()
    }

    /// Pop a single event (for pattern player which processes one at a time)
    #[inline]
    pub fn pop(&self) -> Option<MidiEvent> {
        self.consumer.try_lock()?.try_pop()
    }

    /// Check if the queue is empty (non-blocking)
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.consumer.try_lock().map(|c| c.is_empty()).unwrap_or(true)
    }

    /// Get number of events in queue (non-blocking)
    #[inline]
    pub fn len(&self) -> usize {
        self.consumer.try_lock().map(|c| c.occupied_len()).unwrap_or(0)
    }
}

// Safe to share across threads
unsafe impl Send for MidiEventQueue {}
unsafe impl Sync for MidiEventQueue {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_midi_queue() {
        let queue = MidiEventQueue::new(16);

        // Push some events
        assert!(queue.note_on(60, 100));
        assert!(queue.note_on(64, 80));
        assert!(queue.note_off(60));

        // Drain into pre-allocated buffer
        let mut buffer = Vec::with_capacity(64);
        let count = queue.drain_into(&mut buffer);
        assert_eq!(count, 3);
        assert_eq!(buffer.len(), 3);

        match buffer[0] {
            MidiEvent::NoteOn { note, velocity, .. } => {
                assert_eq!(note, 60);
                assert_eq!(velocity, 100);
            }
            _ => panic!("Expected NoteOn"),
        }
    }

    #[test]
    fn test_queue_overflow() {
        let queue = MidiEventQueue::new(4);

        // Fill the queue
        assert!(queue.note_on(60, 100));
        assert!(queue.note_on(61, 100));
        assert!(queue.note_on(62, 100));
        assert!(queue.note_on(63, 100));

        // This should fail (queue full)
        assert!(!queue.note_on(64, 100));

        // Drain and verify we got 4 events
        let mut buffer = Vec::with_capacity(8);
        let count = queue.drain_into(&mut buffer);
        assert_eq!(count, 4);
    }
}
