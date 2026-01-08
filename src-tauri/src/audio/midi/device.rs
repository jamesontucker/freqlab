//! MIDI device input handling
//!
//! Provides enumeration and connection to MIDI input devices (hardware and virtual).
//! Received MIDI messages are forwarded to the plugin's MIDI event queue.

use std::sync::Arc;
use parking_lot::Mutex;
use midir::{MidiInput, MidiInputConnection};

use super::events::{MidiEvent, MidiEventQueue};

/// Information about a MIDI input device
#[derive(Debug, Clone, serde::Serialize)]
pub struct MidiDeviceInfo {
    /// Device index (for connection)
    pub index: usize,
    /// Device name
    pub name: String,
}

/// Active MIDI input connection
struct ActiveConnection {
    /// The midir connection (must be kept alive)
    #[allow(dead_code)]
    connection: MidiInputConnection<()>,
    /// Name of connected device
    device_name: String,
    /// Last received note (shared with callback)
    last_note: Arc<Mutex<Option<u8>>>,
}

/// Global MIDI input manager
pub struct MidiInputManager {
    /// Active connection (if any)
    connection: Mutex<Option<ActiveConnection>>,
    /// MIDI event queue to forward events to (shared with callback)
    queue: Arc<Mutex<Option<Arc<MidiEventQueue>>>>,
}

impl MidiInputManager {
    /// Create a new MIDI input manager
    pub fn new() -> Self {
        Self {
            connection: Mutex::new(None),
            queue: Arc::new(Mutex::new(None)),
        }
    }

    /// Set the MIDI event queue (called when plugin is loaded/reloaded)
    /// This updates the shared reference that the callback reads from
    pub fn set_queue(&self, queue: Option<Arc<MidiEventQueue>>) {
        *self.queue.lock() = queue;
    }

    /// List available MIDI input devices
    pub fn list_devices(&self) -> Result<Vec<MidiDeviceInfo>, String> {
        let midi_in = MidiInput::new("freqlab-enumerate")
            .map_err(|e| format!("Failed to create MIDI input: {}", e))?;

        let ports = midi_in.ports();
        let mut devices = Vec::with_capacity(ports.len());

        for (index, port) in ports.iter().enumerate() {
            let name = midi_in
                .port_name(port)
                .unwrap_or_else(|_| format!("Unknown Device {}", index));
            devices.push(MidiDeviceInfo { index, name });
        }

        Ok(devices)
    }

    /// Connect to a MIDI input device by index
    pub fn connect(&self, device_index: usize, queue: Arc<MidiEventQueue>) -> Result<String, String> {
        // Disconnect any existing connection first
        self.disconnect();

        // Store the queue reference in the shared Arc
        *self.queue.lock() = Some(queue);

        // Create a new MIDI input for connection
        let midi_in = MidiInput::new("freqlab-input")
            .map_err(|e| format!("Failed to create MIDI input: {}", e))?;

        let ports = midi_in.ports();
        let port = ports
            .get(device_index)
            .ok_or_else(|| format!("Device index {} not found", device_index))?;

        let device_name = midi_in
            .port_name(port)
            .unwrap_or_else(|_| format!("Device {}", device_index));

        log::info!("Connecting to MIDI device: {}", device_name);

        // Create callback that reads from the shared queue reference
        // This allows the queue to be updated via set_queue() without reconnecting
        let shared_queue = self.queue.clone();
        let last_note = Arc::new(Mutex::new(None::<u8>));
        let last_note_clone = last_note.clone();

        let connection = midi_in
            .connect(
                port,
                "freqlab-midi-in",
                move |_timestamp, message, _| {
                    Self::handle_midi_message_shared(message, &shared_queue, &last_note_clone);
                },
                (),
            )
            .map_err(|e| format!("Failed to connect to MIDI device: {}", e))?;

        // Store the connection with the last_note Arc for activity tracking
        *self.connection.lock() = Some(ActiveConnection {
            connection,
            device_name: device_name.clone(),
            last_note,
        });

        log::info!("Successfully connected to MIDI device: {}", device_name);
        Ok(device_name)
    }

    /// Disconnect from the current MIDI device
    pub fn disconnect(&self) {
        let mut conn = self.connection.lock();
        if let Some(active) = conn.take() {
            log::info!("Disconnecting from MIDI device: {}", active.device_name);
            // Connection is dropped here, which closes the port

            // Send all notes off when disconnecting
            if let Some(queue) = self.queue.lock().as_ref() {
                queue.all_notes_off();
            }
        }
    }

    /// Check if connected to a device
    pub fn is_connected(&self) -> bool {
        self.connection.lock().is_some()
    }

    /// Get the name of the connected device (if any)
    pub fn connected_device_name(&self) -> Option<String> {
        self.connection
            .lock()
            .as_ref()
            .map(|c| c.device_name.clone())
    }

    /// Get the last received note (for activity indicator)
    pub fn get_last_note(&self) -> Option<u8> {
        self.connection
            .lock()
            .as_ref()
            .and_then(|c| *c.last_note.lock())
    }

    /// Handle incoming MIDI message using shared queue reference
    /// This allows the queue to be swapped out (e.g., on plugin reload) without reconnecting
    fn handle_midi_message_shared(
        message: &[u8],
        shared_queue: &Arc<Mutex<Option<Arc<MidiEventQueue>>>>,
        last_note: &Arc<Mutex<Option<u8>>>,
    ) {
        if message.is_empty() {
            return;
        }

        // Try to get the current queue - if None, plugin was unloaded, skip processing
        let queue = match shared_queue.try_lock() {
            Some(guard) => match guard.as_ref() {
                Some(q) => q.clone(),
                None => return, // No queue (plugin unloaded), silently drop message
            },
            None => return, // Couldn't lock, skip this message
        };

        let status = message[0];
        let message_type = status & 0xF0;
        let channel = status & 0x0F;

        match message_type {
            // Note Off
            0x80 => {
                if message.len() >= 3 {
                    let note = message[1] & 0x7F;
                    let velocity = message[2] & 0x7F;
                    queue.push(MidiEvent::NoteOff {
                        note,
                        velocity,
                        channel,
                    });
                    log::trace!("MIDI Note Off: note={}, vel={}, ch={}", note, velocity, channel);
                }
            }
            // Note On
            0x90 => {
                if message.len() >= 3 {
                    let note = message[1] & 0x7F;
                    let velocity = message[2] & 0x7F;

                    // Note On with velocity 0 is actually Note Off
                    if velocity == 0 {
                        queue.push(MidiEvent::NoteOff {
                            note,
                            velocity: 0,
                            channel,
                        });
                    } else {
                        queue.push(MidiEvent::NoteOn {
                            note,
                            velocity,
                            channel,
                        });
                        // Update last note for activity indicator
                        *last_note.lock() = Some(note);
                    }
                    log::trace!("MIDI Note On: note={}, vel={}, ch={}", note, velocity, channel);
                }
            }
            // Control Change (CC)
            0xB0 => {
                if message.len() >= 3 {
                    let cc = message[1] & 0x7F;
                    let value = message[2] & 0x7F;

                    // Handle All Notes Off CC (123)
                    if cc == 123 {
                        queue.push(MidiEvent::AllNotesOff);
                        log::debug!("MIDI All Notes Off CC received");
                    }
                    // TODO: Forward other CC messages (sustain, mod wheel, etc.)
                    // For now, just log them
                    log::trace!("MIDI CC: cc={}, value={}, ch={}", cc, value, channel);
                }
            }
            // Pitch Bend
            0xE0 => {
                if message.len() >= 3 {
                    let lsb = message[1] & 0x7F;
                    let msb = message[2] & 0x7F;
                    let _value = ((msb as u16) << 7) | (lsb as u16);
                    // TODO: Forward pitch bend to plugin
                    log::trace!("MIDI Pitch Bend: value={}, ch={}", _value, channel);
                }
            }
            // Other messages (aftertouch, program change, etc.) - log but ignore for now
            _ => {
                log::trace!("MIDI message: status=0x{:02X}, len={}", status, message.len());
            }
        }
    }
}

impl Default for MidiInputManager {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for MidiInputManager {
    fn drop(&mut self) {
        self.disconnect();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_manager_creation() {
        let manager = MidiInputManager::new();
        assert!(!manager.is_connected());
        assert!(manager.connected_device_name().is_none());
    }

    #[test]
    fn test_list_devices() {
        let manager = MidiInputManager::new();
        // This should not fail even if no devices are connected
        let result = manager.list_devices();
        assert!(result.is_ok());
    }
}
