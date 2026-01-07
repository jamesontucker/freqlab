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
 * Initialize the audio engine
 */
export async function initAudioEngine(deviceName?: string): Promise<void> {
  await invoke('init_audio_engine', { deviceName });
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
 * Subscribe to level meter updates
 */
export function onLevelUpdate(
  callback: (left: number, right: number) => void
): Promise<UnlistenFn> {
  return listen<[number, number]>('preview-levels', (event) => {
    callback(event.payload[0], event.payload[1]);
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
