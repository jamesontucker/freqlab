//! Lock-free ring buffer wrappers for audio thread communication

use ringbuf::{traits::*, HeapRb};

/// Stereo audio sample
#[derive(Clone, Copy, Default)]
pub struct StereoSample {
    pub left: f32,
    pub right: f32,
}

impl StereoSample {
    pub fn new(left: f32, right: f32) -> Self {
        Self { left, right }
    }

    pub fn mono(value: f32) -> Self {
        Self { left: value, right: value }
    }

    pub fn silence() -> Self {
        Self::default()
    }
}

/// Ring buffer for streaming audio samples to the output
pub struct AudioRingBuffer {
    producer: ringbuf::HeapProd<StereoSample>,
    consumer: ringbuf::HeapCons<StereoSample>,
}

impl AudioRingBuffer {
    /// Create a new ring buffer with the given capacity (in samples)
    pub fn new(capacity: usize) -> Self {
        let rb = HeapRb::new(capacity);
        let (producer, consumer) = rb.split();
        Self { producer, consumer }
    }

    /// Split into producer/consumer pair for separate threads
    pub fn split(self) -> (AudioProducer, AudioConsumer) {
        (
            AudioProducer { inner: self.producer },
            AudioConsumer { inner: self.consumer },
        )
    }
}

/// Producer side - used by the sample/signal generator thread
pub struct AudioProducer {
    inner: ringbuf::HeapProd<StereoSample>,
}

impl AudioProducer {
    /// Push a sample, returns true if successful
    pub fn push(&mut self, sample: StereoSample) -> bool {
        self.inner.try_push(sample).is_ok()
    }

    /// Push multiple samples, returns number pushed
    pub fn push_slice(&mut self, samples: &[StereoSample]) -> usize {
        self.inner.push_slice(samples)
    }

    /// Available space in the buffer
    pub fn available(&self) -> usize {
        self.inner.vacant_len()
    }

    /// Check if buffer is full
    pub fn is_full(&self) -> bool {
        self.inner.is_full()
    }
}

/// Consumer side - used by the audio callback thread
pub struct AudioConsumer {
    inner: ringbuf::HeapCons<StereoSample>,
}

impl AudioConsumer {
    /// Pop a sample, returns None if empty
    pub fn pop(&mut self) -> Option<StereoSample> {
        self.inner.try_pop()
    }

    /// Pop multiple samples into a slice, returns number popped
    pub fn pop_slice(&mut self, output: &mut [StereoSample]) -> usize {
        self.inner.pop_slice(output)
    }

    /// Number of samples available to read
    pub fn available(&self) -> usize {
        self.inner.occupied_len()
    }

    /// Check if buffer is empty
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }
}

/// Command buffer for sending commands to the audio thread
pub type CommandBuffer<T> = (ringbuf::HeapProd<T>, ringbuf::HeapCons<T>);

pub fn create_command_buffer<T>(capacity: usize) -> CommandBuffer<T> {
    let rb = HeapRb::new(capacity);
    rb.split()
}
