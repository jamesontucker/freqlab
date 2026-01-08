//! MIDI event types and queue for passing events to plugins

use ringbuf::{traits::*, HeapRb};
use std::sync::Arc;
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
    /// All notes off - send note off for all active notes
    AllNotesOff,
}

impl MidiEvent {
    /// Create a note on event on channel 0
    pub fn note_on(note: u8, velocity: u8) -> Self {
        Self::NoteOn {
            note,
            velocity,
            channel: 0,
        }
    }

    /// Create a note off event on channel 0
    pub fn note_off(note: u8) -> Self {
        Self::NoteOff {
            note,
            velocity: 0,
            channel: 0,
        }
    }
}

/// Thread-safe MIDI event queue using lock-free ring buffer
///
/// Producer side pushes events (from commands, patterns, devices)
/// Consumer side is read by the audio thread
pub struct MidiEventQueue {
    /// Producer side - wrapped in mutex for multi-producer access
    producer: Mutex<ringbuf::HeapProd<MidiEvent>>,
    /// Consumer side - only accessed by audio thread
    consumer: Mutex<ringbuf::HeapCons<MidiEvent>>,
}

impl MidiEventQueue {
    /// Create a new MIDI event queue
    pub fn new(capacity: usize) -> Self {
        let rb = HeapRb::new(capacity);
        let (producer, consumer) = rb.split();
        Self {
            producer: Mutex::new(producer),
            consumer: Mutex::new(consumer),
        }
    }

    /// Push an event to the queue (called from command handlers)
    pub fn push(&self, event: MidiEvent) -> bool {
        self.producer.lock().try_push(event).is_ok()
    }

    /// Push a note on event
    pub fn note_on(&self, note: u8, velocity: u8) -> bool {
        self.push(MidiEvent::note_on(note, velocity))
    }

    /// Push a note off event
    pub fn note_off(&self, note: u8) -> bool {
        self.push(MidiEvent::note_off(note))
    }

    /// Send all notes off
    pub fn all_notes_off(&self) -> bool {
        self.push(MidiEvent::AllNotesOff)
    }

    /// Pop an event from the queue (called from audio thread)
    pub fn pop(&self) -> Option<MidiEvent> {
        self.consumer.lock().try_pop()
    }

    /// Drain all events into a vector (called from audio thread)
    pub fn drain(&self) -> Vec<MidiEvent> {
        let mut events = Vec::new();
        let mut consumer = self.consumer.lock();
        while let Some(event) = consumer.try_pop() {
            events.push(event);
        }
        events
    }

    /// Check if the queue is empty
    pub fn is_empty(&self) -> bool {
        self.consumer.lock().is_empty()
    }

    /// Get number of events in queue
    pub fn len(&self) -> usize {
        self.consumer.lock().occupied_len()
    }
}

// Safe to share across threads
unsafe impl Send for MidiEventQueue {}
unsafe impl Sync for MidiEventQueue {}

/// Create a shared MIDI event queue
pub fn create_midi_queue() -> Arc<MidiEventQueue> {
    Arc::new(MidiEventQueue::new(256)) // 256 events should be plenty
}

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

        // Drain and check
        let events = queue.drain();
        assert_eq!(events.len(), 3);

        match events[0] {
            MidiEvent::NoteOn { note, velocity, .. } => {
                assert_eq!(note, 60);
                assert_eq!(velocity, 100);
            }
            _ => panic!("Expected NoteOn"),
        }
    }
}
