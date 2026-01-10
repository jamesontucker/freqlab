import { useState, useEffect, useCallback, useRef } from 'react';
import {
  type MidiDeviceInfo,
  midiDeviceList,
  midiDeviceConnect,
  midiDeviceDisconnect,
  midiDeviceGetConnected,
  midiDeviceGetLastNote,
  midiAllNotesOff,
} from '../../api/preview';
import { Tooltip } from '../Common/Tooltip';

interface MidiLiveControlsProps {
  pluginLoaded: boolean;
}

// Convert MIDI note number to note name
function noteToName(note: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(note / 12) - 1;
  const noteName = names[note % 12];
  return `${noteName}${octave}`;
}

export function MidiLiveControls({ pluginLoaded }: MidiLiveControlsProps) {
  const [devices, setDevices] = useState<MidiDeviceInfo[]>([]);
  const [selectedDeviceIndex, setSelectedDeviceIndex] = useState<number | null>(null);
  const [connectedDeviceName, setConnectedDeviceName] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastNote, setLastNote] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // Guard refs to prevent state updates after unmount and overlapping calls
  const isMountedRef = useRef(true);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPollInFlightRef = useRef(false);
  const isLoadingDevicesRef = useRef(false);

  // Load available devices (with guards against concurrent calls and unmount)
  const loadDevices = useCallback(async (forceRefresh = false) => {
    // Guard against concurrent calls
    if (isLoadingDevicesRef.current) return;
    isLoadingDevicesRef.current = true;

    try {
      if (!isMountedRef.current) return;
      setLoading(true);
      setError(null);

      // Only enumerate devices on first load or explicit refresh
      // This avoids slow device enumeration on every tab switch
      let deviceList = devices;
      if (devices.length === 0 || forceRefresh) {
        deviceList = await midiDeviceList();
        if (!isMountedRef.current) return;
        setDevices(deviceList);
      }

      // Always sync connection state from backend
      const connected = await midiDeviceGetConnected();
      if (!isMountedRef.current) return;

      if (connected) {
        setConnectedDeviceName(connected);
        // Find the device index
        const idx = deviceList.findIndex(d => d.name === connected);
        if (idx >= 0) {
          setSelectedDeviceIndex(idx);
        }
      } else {
        setConnectedDeviceName(null);
      }
    } catch (err) {
      console.error('Failed to load MIDI devices:', err);
      if (isMountedRef.current) {
        setError('Failed to load MIDI devices');
      }
    } finally {
      isLoadingDevicesRef.current = false;
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [devices]);

  // Set mounted ref and load devices on mount, cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    loadDevices();

    return () => {
      isMountedRef.current = false;
    };
  }, []); // Empty deps - only run on mount/unmount

  // Poll for activity when connected (with guards against overlapping calls)
  useEffect(() => {
    // Cleanup any existing interval first
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    if (!connectedDeviceName) {
      return;
    }

    // Poll for last note at 5Hz (200ms) for activity indicator
    // Slower than before to reduce IPC overhead
    pollIntervalRef.current = setInterval(async () => {
      // Skip if previous poll is still in flight or component unmounted
      if (isPollInFlightRef.current || !isMountedRef.current) return;

      isPollInFlightRef.current = true;
      try {
        const note = await midiDeviceGetLastNote();
        if (isMountedRef.current) {
          setLastNote(note);
        }
      } catch {
        // Ignore polling errors
      } finally {
        isPollInFlightRef.current = false;
      }
    }, 200);

    // Always return cleanup
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [connectedDeviceName]);

  // Note: We intentionally do NOT disconnect on unmount
  // This allows the MIDI connection to persist when switching tabs
  // The connection will be disconnected when the plugin is unloaded (see effect below)

  // Disconnect if plugin is unloaded
  useEffect(() => {
    if (!pluginLoaded && connectedDeviceName) {
      midiDeviceDisconnect().catch(err => {
        console.error('Failed to disconnect MIDI device when plugin unloaded:', err);
      });
      setConnectedDeviceName(null);
      setLastNote(null);
    }
  }, [pluginLoaded, connectedDeviceName]);

  const handleConnect = useCallback(async () => {
    if (selectedDeviceIndex === null) return;

    setIsConnecting(true);
    setError(null);

    try {
      const deviceName = await midiDeviceConnect(selectedDeviceIndex);
      if (isMountedRef.current) {
        setConnectedDeviceName(deviceName);
        setLastNote(null);
      }
    } catch (err) {
      console.error('Failed to connect to MIDI device:', err);
      if (isMountedRef.current) {
        setError(String(err));
      }
    } finally {
      if (isMountedRef.current) {
        setIsConnecting(false);
      }
    }
  }, [selectedDeviceIndex]);

  const handleDisconnect = useCallback(async () => {
    try {
      await midiDeviceDisconnect();
      if (isMountedRef.current) {
        setConnectedDeviceName(null);
        setLastNote(null);
      }
    } catch (err) {
      console.error('Failed to disconnect MIDI device:', err);
    }
  }, []);

  const handlePanic = useCallback(async () => {
    try {
      await midiAllNotesOff();
    } catch (err) {
      console.error('Failed to send all notes off:', err);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    loadDevices(true); // Force refresh to re-enumerate devices
  }, [loadDevices]);

  const isConnected = !!connectedDeviceName;

  return (
    <div className="space-y-4">
      {/* Device Selection */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">MIDI Input Device</span>
          <button
            onClick={handleRefresh}
            disabled={loading || isConnecting}
            className="p-1 text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
            title="Refresh device list"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {loading ? (
          <div className="px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-muted">
            Loading devices...
          </div>
        ) : devices.length === 0 ? (
          <div className="px-3 py-2 bg-bg-tertiary rounded-lg text-sm text-text-muted">
            No MIDI devices found
          </div>
        ) : (
          <select
            value={selectedDeviceIndex ?? ''}
            onChange={(e) => setSelectedDeviceIndex(e.target.value ? Number(e.target.value) : null)}
            disabled={isConnected || isConnecting || !pluginLoaded}
            className="w-full px-3 py-2 bg-bg-tertiary text-text-primary rounded-lg text-sm border border-border focus:border-accent focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <option value="">Select a device...</option>
            {devices.map((device) => (
              <option key={device.index} value={device.index}>
                {device.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Connection Status & Controls */}
      <div className="flex items-center gap-2">
        {isConnected ? (
          <>
            <div className="flex-1 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm text-text-primary truncate" title={connectedDeviceName}>
                {connectedDeviceName}
              </span>
            </div>
            <button
              onClick={handleDisconnect}
              className="px-3 py-1.5 text-xs font-medium bg-bg-tertiary text-text-secondary hover:text-error hover:bg-error/10 rounded transition-colors"
            >
              Disconnect
            </button>
          </>
        ) : (
          <Tooltip
            content={
              !pluginLoaded
                ? 'Launch your plugin to connect MIDI devices'
                : selectedDeviceIndex === null
                  ? 'Select a MIDI device first'
                  : 'Connect to selected device'
            }
          >
            <button
              onClick={handleConnect}
              disabled={selectedDeviceIndex === null || isConnecting || !pluginLoaded}
              className={`
                flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors
                ${selectedDeviceIndex === null || !pluginLoaded
                  ? 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                  : isConnecting
                    ? 'bg-accent/50 text-white cursor-wait'
                    : 'bg-accent text-white hover:bg-accent-hover'
                }
              `}
            >
              {isConnecting ? 'Connecting...' : 'Connect'}
            </button>
          </Tooltip>
        )}
      </div>

      {error && (
        <p className="text-xs text-error">{error}</p>
      )}

      {/* Activity Indicator */}
      {isConnected && (
        <div className="flex items-center justify-between px-3 py-2 bg-bg-tertiary/50 rounded-lg">
          <span className="text-xs text-text-muted">Last Note</span>
          <span className="text-sm font-mono text-text-primary">
            {lastNote !== null ? noteToName(lastNote) : '—'}
          </span>
        </div>
      )}

      {/* Panic Button */}
      {isConnected && (
        <button
          onClick={handlePanic}
          className="w-full px-3 py-2 text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg transition-colors"
        >
          Panic (All Notes Off)
        </button>
      )}

      {/* Help Text */}
      {pluginLoaded && !isConnected && devices.length > 0 && (
        <p className="text-xs text-text-muted text-center">
          Connect a MIDI keyboard or controller to play the instrument
        </p>
      )}

      {pluginLoaded && isConnected && (
        <p className="text-xs text-text-muted text-center italic">
          Play your MIDI device to trigger notes
        </p>
      )}
    </div>
  );
}
