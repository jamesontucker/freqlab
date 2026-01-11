/**
 * Preview API - Tauri commands for audio preview system
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface AudioDeviceInfo {
  name: string;
  isDefault: boolean;
}

export interface DemoSample {
  id: string;
  name: string;
  path: string;
}

export type EngineState = 'stopped' | 'playing' | 'paused';

export interface PreviewState {
  state: EngineState;
  output_left: number;
  output_right: number;
}

/**
 * Initialize the audio engine with optional custom settings
 */
export async function initAudioEngine(
  deviceName?: string | null,
  sampleRate?: number,
  bufferSize?: number
): Promise<void> {
  await invoke('init_audio_engine', {
    deviceName: deviceName || null,
    sampleRate,
    bufferSize,
  });
}

/**
 * Shutdown the audio engine
 */
export async function shutdownAudioEngine(): Promise<void> {
  await invoke('shutdown_audio_engine');
}

/**
 * Get list of available audio output devices
 */
export async function getAudioDevices(): Promise<AudioDeviceInfo[]> {
  return await invoke('get_audio_devices');
}

/**
 * Start audio playback
 */
export async function previewPlay(): Promise<void> {
  await invoke('preview_play');
}

/**
 * Stop audio playback
 */
export async function previewStop(): Promise<void> {
  await invoke('preview_stop');
}

/**
 * Pause audio playback
 */
export async function previewPause(): Promise<void> {
  await invoke('preview_pause');
}

export type GatePattern = 'continuous' | 'pulse' | 'quarter' | 'eighth' | 'sixteenth';

/**
 * Set the input source to a test signal
 */
export async function previewSetSignal(
  signalType: string,
  frequency?: number,
  amplitude?: number,
  gatePattern?: GatePattern,
  gateRate?: number,
  gateDuty?: number
): Promise<void> {
  await invoke('preview_set_signal', { signalType, frequency, amplitude, gatePattern, gateRate, gateDuty });
}

/**
 * Set the gate pattern for the current signal
 */
export async function previewSetGate(
  pattern: GatePattern,
  rate?: number,
  duty?: number
): Promise<void> {
  await invoke('preview_set_gate', { pattern, rate, duty });
}

/**
 * Set the signal frequency
 */
export async function previewSetFrequency(frequency: number): Promise<void> {
  await invoke('preview_set_frequency', { frequency });
}

/**
 * Set the signal amplitude (0.0 - 1.0)
 */
export async function previewSetAmplitude(amplitude: number): Promise<void> {
  await invoke('preview_set_amplitude', { amplitude });
}

/**
 * Load a sample file as the input source
 */
export async function previewLoadSample(path: string): Promise<void> {
  await invoke('preview_load_sample', { path });
}

/**
 * Set looping mode
 */
export async function previewSetLooping(looping: boolean): Promise<void> {
  await invoke('preview_set_looping', { looping });
}

/**
 * Get current preview state
 */
export async function previewGetState(): Promise<PreviewState> {
  return await invoke('preview_get_state');
}

/**
 * Get output levels (for metering)
 */
export async function previewGetLevels(): Promise<[number, number]> {
  return await invoke('preview_get_levels');
}

/**
 * Get list of available demo samples
 */
export async function getDemoSamples(): Promise<DemoSample[]> {
  return await invoke('get_demo_samples');
}

/**
 * Start the level meter polling (emits events to frontend)
 */
export async function startLevelMeter(): Promise<void> {
  await invoke('start_level_meter');
}

/**
 * Stop the level meter polling thread
 */
export async function stopLevelMeter(): Promise<void> {
  await invoke('stop_level_meter');
}

/**
 * Subscribe to level meter updates (legacy)
 */
export function onLevelUpdate(
  callback: (left: number, right: number) => void
): Promise<UnlistenFn> {
  return listen<[number, number]>('preview-levels', (event) => {
    callback(event.payload[0], event.payload[1]);
  });
}

/**
 * Metering data with levels, dB, spectrum, and waveform
 */
export interface MeteringData {
  /** Left channel output level (0.0 - 1.0) */
  left: number;
  /** Right channel output level (0.0 - 1.0) */
  right: number;
  /** Left channel output level in dB (-60 to 0) */
  left_db: number;
  /** Right channel output level in dB (-60 to 0) */
  right_db: number;
  /** Left channel input level (0.0 - 1.0) - for live input metering */
  input_left: number;
  /** Right channel input level (0.0 - 1.0) - for live input metering */
  input_right: number;
  /** Left channel input level in dB (-60 to 0) */
  input_left_db: number;
  /** Right channel input level in dB (-60 to 0) */
  input_right_db: number;
  /** Spectrum analyzer band magnitudes (0.0 - 1.0), 32 bands - post-FX output */
  spectrum: number[];
  /** Input spectrum analyzer band magnitudes (0.0 - 1.0), 32 bands - pre-FX input */
  spectrum_input: number[];
  /** Left channel waveform display buffer (time-domain samples, -1.0 to 1.0) - post-FX output */
  waveform_left: number[];
  /** Right channel waveform display buffer (time-domain samples, -1.0 to 1.0) - post-FX output */
  waveform_right: number[];
  /** Left channel peak hold value (0.0 - 1.0, cleared after read) - post-FX output */
  waveform_peak_left: number;
  /** Right channel peak hold value (0.0 - 1.0, cleared after read) - post-FX output */
  waveform_peak_right: number;
  /** Left channel INPUT waveform display buffer (time-domain samples, -1.0 to 1.0) - pre-FX */
  waveform_input_left: number[];
  /** Right channel INPUT waveform display buffer (time-domain samples, -1.0 to 1.0) - pre-FX */
  waveform_input_right: number[];
  /** Left channel INPUT peak hold value (0.0 - 1.0) - pre-FX */
  waveform_input_peak_left: number;
  /** Right channel INPUT peak hold value (0.0 - 1.0) - pre-FX */
  waveform_input_peak_right: number;
  /** Left channel clipping indicator */
  clipping_left: boolean;
  /** Right channel clipping indicator */
  clipping_right: boolean;
  /** Stereo imaging positions: [angle, radius] pairs for particle display - post-FX output */
  stereo_positions: [number, number][];
  /** Stereo correlation coefficient (-1.0 to +1.0) - post-FX output */
  stereo_correlation: number;
  /** INPUT stereo imaging positions: [angle, radius] pairs for particle display - pre-FX */
  stereo_positions_input: [number, number][];
  /** INPUT stereo correlation coefficient (-1.0 to +1.0) - pre-FX */
  stereo_correlation_input: number;
}

/**
 * Subscribe to metering updates (levels + spectrum + dB)
 */
export function onMeteringUpdate(
  callback: (data: MeteringData) => void
): Promise<UnlistenFn> {
  return listen<MeteringData>('preview-metering', (event) => {
    callback(event.payload);
  });
}

// =============================================================================
// Plugin API
// =============================================================================

export type PluginStateStatus = 'unloaded' | 'loading' | 'active' | 'error' | 'reloading';

export interface PluginStateUnloaded {
  status: 'unloaded';
}

export interface PluginStateLoading {
  status: 'loading';
  path: string;
}

export interface PluginStateActive {
  status: 'active';
  name: string;
  path: string;
  has_editor: boolean;
}

export interface PluginStateError {
  status: 'error';
  message: string;
}

export interface PluginStateReloading {
  status: 'reloading';
  path: string;
}

export type PluginState =
  | PluginStateUnloaded
  | PluginStateLoading
  | PluginStateActive
  | PluginStateError
  | PluginStateReloading;

export interface PluginInfo {
  name: string;
  path: string;
}

/**
 * Load a CLAP plugin from a .clap bundle path
 */
export async function pluginLoad(path: string): Promise<void> {
  await invoke('plugin_load', { path });
}

/**
 * Unload the current plugin
 */
export async function pluginUnload(): Promise<void> {
  await invoke('plugin_unload');
}

/**
 * Get the current plugin state
 */
export async function pluginGetState(): Promise<PluginState> {
  return await invoke('plugin_get_state');
}

/**
 * Check if a plugin is loaded
 */
export async function pluginHasPlugin(): Promise<boolean> {
  return await invoke('plugin_has_plugin');
}

/**
 * Check if the loaded plugin has an editor GUI
 */
export async function pluginHasEditor(): Promise<boolean> {
  return await invoke('plugin_has_editor');
}

/**
 * Scan a directory for .clap plugin bundles
 */
export async function pluginScanDirectory(path: string): Promise<PluginInfo[]> {
  return await invoke('plugin_scan_directory', { path });
}

/**
 * Subscribe to plugin loading events
 */
export function onPluginLoading(callback: (path: string) => void): Promise<UnlistenFn> {
  return listen<string>('plugin-loading', (event) => {
    callback(event.payload);
  });
}

/**
 * Subscribe to plugin loaded events
 */
export function onPluginLoaded(callback: (state: PluginState) => void): Promise<UnlistenFn> {
  return listen<PluginState>('plugin-loaded', (event) => {
    callback(event.payload);
  });
}

/**
 * Subscribe to plugin error events
 */
export function onPluginError(callback: (error: string) => void): Promise<UnlistenFn> {
  return listen<string>('plugin-error', (event) => {
    callback(event.payload);
  });
}

/**
 * Subscribe to plugin unloaded events
 */
export function onPluginUnloaded(callback: () => void): Promise<UnlistenFn> {
  return listen('plugin-unloaded', () => {
    callback();
  });
}

/**
 * Get the .clap plugin path for a project (based on current version)
 */
export async function getProjectPluginPath(projectName: string, version: number): Promise<string | null> {
  return await invoke('get_project_plugin_path', { projectName, version });
}

/**
 * Load the plugin for the current project (auto-detect from output folder)
 */
export async function pluginLoadForProject(projectName: string, version: number): Promise<void> {
  await invoke('plugin_load_for_project', { projectName, version });
}

/**
 * Open the plugin's editor window
 * Uses stored position if available, otherwise centers the window.
 */
export async function pluginOpenEditor(): Promise<void> {
  await invoke('plugin_open_editor');
}

/**
 * Close the plugin's editor window
 */
export async function pluginCloseEditor(): Promise<void> {
  await invoke('plugin_close_editor');
}

/**
 * Check if the plugin editor is open
 */
export async function pluginIsEditorOpen(): Promise<boolean> {
  return await invoke('plugin_is_editor_open');
}

/**
 * Process plugin idle tasks (flush params, handle callbacks)
 * Should be called periodically (~60fps) when the editor is open
 */
export async function pluginIdle(): Promise<void> {
  await invoke('plugin_idle');
}

/**
 * Reload the current plugin (for hot reload)
 * If projectName and version are provided, reload from that project's output folder
 */
export async function pluginReload(projectName?: string, version?: number): Promise<void> {
  await invoke('plugin_reload', { projectName, version });
}

/**
 * Subscribe to plugin reloading events
 */
export function onPluginReloading(callback: (path: string) => void): Promise<UnlistenFn> {
  return listen<string>('plugin-reloading', (event) => {
    callback(event.payload);
  });
}

// =============================================================================
// Live Input API
// =============================================================================

export interface InputDeviceInfo {
  name: string;
  is_default: boolean;
}

/**
 * Get list of available audio input devices
 */
export async function getInputDevices(): Promise<InputDeviceInfo[]> {
  return await invoke('get_input_devices');
}

/**
 * Set the input source to live audio input
 * @param deviceName - Name of the input device, or null for system default
 * @param chunkSize - Resampler chunk size (default: 256). Smaller = lower latency, larger = less CPU
 */
export async function previewSetLiveInput(deviceName?: string | null, chunkSize?: number): Promise<void> {
  await invoke('preview_set_live_input', { deviceName: deviceName || null, chunkSize });
}

/**
 * Set the live input paused state
 */
export async function previewSetLivePaused(paused: boolean): Promise<void> {
  await invoke('preview_set_live_paused', { paused });
}

/**
 * Get live input paused state
 */
export async function previewIsLivePaused(): Promise<boolean> {
  return await invoke('preview_is_live_paused');
}

/**
 * Get input levels (for live input metering)
 */
export async function previewGetInputLevels(): Promise<[number, number]> {
  return await invoke('preview_get_input_levels');
}

/**
 * Set master volume (0.0 - 1.0)
 */
export async function previewSetMasterVolume(volume: number): Promise<void> {
  await invoke('preview_set_master_volume', { volume });
}

/**
 * Get master volume (0.0 - 1.0)
 */
export async function previewGetMasterVolume(): Promise<number> {
  return await invoke('preview_get_master_volume');
}

// =============================================================================
// MIDI API (for instrument plugins)
// =============================================================================

// MIDI event batching - collect events and send in batches to reduce IPC overhead
interface MidiEvent {
  type: 'on' | 'off';
  note: number;
  velocity?: number;
}

let midiEventQueue: MidiEvent[] = [];
let midiFlushScheduled = false;
let midiFlushPromise: Promise<void> | null = null;

// Flush queued MIDI events in a single batched invoke call
async function flushMidiEvents(): Promise<void> {
  if (midiEventQueue.length === 0) return;

  const events = midiEventQueue;
  midiEventQueue = [];
  midiFlushScheduled = false;

  try {
    await invoke('midi_batch', { events });
  } catch (err) {
    console.error('Failed to send MIDI batch:', err);
  }
}

// Schedule a flush on the next microtask (batches all events in current call stack)
function scheduleMidiFlush(): void {
  if (midiFlushScheduled) return;
  midiFlushScheduled = true;

  // Use queueMicrotask for fastest possible batching
  queueMicrotask(() => {
    midiFlushPromise = flushMidiEvents();
  });
}

/**
 * Send a MIDI note on event to the loaded plugin
 * Events are batched and sent together to reduce IPC overhead
 * @param note - MIDI note number (0-127, 60 = middle C)
 * @param velocity - Note velocity (0-127)
 */
export function midiNoteOn(note: number, velocity: number): void {
  midiEventQueue.push({ type: 'on', note, velocity });
  scheduleMidiFlush();
}

/**
 * Send a MIDI note off event to the loaded plugin
 * Events are batched and sent together to reduce IPC overhead
 * @param note - MIDI note number (0-127)
 */
export function midiNoteOff(note: number): void {
  midiEventQueue.push({ type: 'off', note });
  scheduleMidiFlush();
}

/**
 * Send all notes off to the loaded plugin (panic button)
 */
export async function midiAllNotesOff(): Promise<void> {
  // Wait for any pending batch to complete first
  if (midiFlushPromise) {
    await midiFlushPromise;
  }
  await invoke('midi_all_notes_off');
}

/**
 * Set whether the loaded plugin is an instrument (vs effect)
 * Instrument plugins are processed even when not "playing" for MIDI input
 */
export async function setPluginIsInstrument(isInstrument: boolean): Promise<void> {
  await invoke('set_plugin_is_instrument', { isInstrument });
}

// =============================================================================
// Pattern Playback API
// =============================================================================

export type PatternCategory = 'Melodic' | 'Bass' | 'Drums';

export interface PatternInfo {
  id: string;
  name: string;
  category: PatternCategory;
  length_beats: number;
}

/**
 * List all available patterns
 */
export async function patternList(): Promise<PatternInfo[]> {
  return await invoke('pattern_list');
}

/**
 * List patterns by category
 */
export async function patternListByCategory(category: PatternCategory): Promise<PatternInfo[]> {
  return await invoke('pattern_list_by_category', { category });
}

/**
 * Start playing a pattern
 * @param patternId - ID of the pattern to play
 * @param bpm - Tempo in beats per minute (20-400)
 * @param octaveShift - Octave shift (-2 to +2)
 * @param looping - Whether to loop the pattern
 */
export async function patternPlay(
  patternId: string,
  bpm: number,
  octaveShift: number,
  looping: boolean
): Promise<void> {
  await invoke('pattern_play', { patternId, bpm, octaveShift, looping });
}

/**
 * Stop pattern playback
 */
export async function patternStop(): Promise<void> {
  await invoke('pattern_stop');
}

/**
 * Set pattern BPM (takes effect immediately)
 */
export async function patternSetBpm(bpm: number): Promise<void> {
  await invoke('pattern_set_bpm', { bpm });
}

/**
 * Set pattern octave shift (takes effect on next loop)
 */
export async function patternSetOctaveShift(shift: number): Promise<void> {
  await invoke('pattern_set_octave_shift', { shift });
}

/**
 * Set pattern looping
 */
export async function patternSetLooping(looping: boolean): Promise<void> {
  await invoke('pattern_set_looping', { looping });
}

/**
 * Check if pattern is playing
 */
export async function patternIsPlaying(): Promise<boolean> {
  return await invoke('pattern_is_playing');
}

// =============================================================================
// MIDI File API
// =============================================================================

export interface MidiTrackInfo {
  index: number;
  name: string | null;
  note_count: number;
  channel: number | null;
  duration_beats: number;
}

export interface TempoEvent {
  beat: number;
  bpm: number;
}

export interface MidiFileInfo {
  filename: string;
  bpm: number;
  duration_beats: number;
  tracks: MidiTrackInfo[];
  tempo_map: TempoEvent[];
  has_tempo_automation: boolean;
}

/**
 * Load a MIDI file (.mid) for playback
 * @param path - Path to the MIDI file
 * @returns Information about the loaded file including tracks
 */
export async function midiFileLoad(path: string): Promise<MidiFileInfo> {
  return await invoke('midi_file_load', { path });
}

/**
 * Get info about the currently loaded MIDI file
 * @returns File info or null if no file is loaded
 */
export async function midiFileGetInfo(): Promise<MidiFileInfo | null> {
  return await invoke('midi_file_get_info');
}

/**
 * Unload the current MIDI file
 */
export async function midiFileUnload(): Promise<void> {
  await invoke('midi_file_unload');
}

/**
 * Play a track from the loaded MIDI file
 * @param trackIndex - Index into the tracks array (not original MIDI track number)
 * @param bpm - Tempo override (or null to use file's default BPM)
 * @param octaveShift - Octave shift (-2 to +2)
 * @param looping - Whether to loop the track
 * @param useTempoAutomation - Whether to follow the file's tempo automation
 */
export async function midiFilePlay(
  trackIndex: number,
  bpm: number | null,
  octaveShift: number,
  looping: boolean,
  useTempoAutomation: boolean
): Promise<void> {
  await invoke('midi_file_play', { trackIndex, bpm, octaveShift, looping, useTempoAutomation });
}

/**
 * Stop MIDI file playback
 */
export async function midiFileStop(): Promise<void> {
  await invoke('midi_file_stop');
}

/**
 * Set tempo automation mode for MIDI file playback
 * Takes effect immediately during playback
 */
export async function midiFileSetTempoAutomation(enabled: boolean): Promise<void> {
  await invoke('midi_file_set_tempo_automation', { enabled });
}

/**
 * Playback position info
 */
export interface PlaybackPositionInfo {
  position: number;
  duration: number;
  is_playing: boolean;
}

/**
 * Get current MIDI file playback position
 */
export async function midiFileGetPosition(): Promise<PlaybackPositionInfo> {
  return await invoke('midi_file_get_position');
}

/**
 * Seek to a position in beats
 */
export async function midiFileSeek(positionBeats: number): Promise<void> {
  await invoke('midi_file_seek', { position_beats: positionBeats });
}

// =============================================================================
// Live MIDI Device API
// =============================================================================

export interface MidiDeviceInfo {
  index: number;
  name: string;
}

/**
 * List available MIDI input devices
 */
export async function midiDeviceList(): Promise<MidiDeviceInfo[]> {
  return await invoke('midi_device_list');
}

/**
 * Connect to a MIDI input device by index
 * @param deviceIndex - Index from midiDeviceList()
 * @returns Name of the connected device
 */
export async function midiDeviceConnect(deviceIndex: number): Promise<string> {
  return await invoke('midi_device_connect', { deviceIndex });
}

/**
 * Disconnect from the current MIDI input device
 */
export async function midiDeviceDisconnect(): Promise<void> {
  await invoke('midi_device_disconnect');
}

/**
 * Check if connected to a MIDI input device
 */
export async function midiDeviceIsConnected(): Promise<boolean> {
  return await invoke('midi_device_is_connected');
}

/**
 * Get the name of the connected MIDI device (if any)
 */
export async function midiDeviceGetConnected(): Promise<string | null> {
  return await invoke('midi_device_get_connected');
}

/**
 * Get the last received MIDI note (for activity indicator)
 */
export async function midiDeviceGetLastNote(): Promise<number | null> {
  return await invoke('midi_device_get_last_note');
}
