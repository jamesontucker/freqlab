import { memo, useCallback } from 'react';
import { usePreviewStore, type SignalType, type GatePattern } from '../../stores/previewStore';
import * as previewApi from '../../api/preview';
import { FrequencySelector } from './FrequencySelector';

const SIGNAL_OPTIONS: { value: SignalType; label: string }[] = [
  { value: 'sine', label: 'Sine Wave' },
  { value: 'white_noise', label: 'White Noise' },
  { value: 'pink_noise', label: 'Pink Noise' },
  { value: 'impulse', label: 'Impulse' },
  { value: 'sweep', label: 'Frequency Sweep' },
  { value: 'square', label: 'Square Wave' },
];

const GATE_OPTIONS: { value: GatePattern; label: string; rateLabel: string }[] = [
  { value: 'continuous', label: 'Continuous', rateLabel: '' },
  { value: 'pulse', label: 'Pulse', rateLabel: 'Rate (Hz)' },
  { value: 'quarter', label: '1/4 Notes', rateLabel: 'Tempo (BPM)' },
  { value: 'eighth', label: '1/8 Notes', rateLabel: 'Tempo (BPM)' },
  { value: 'sixteenth', label: '1/16 Notes', rateLabel: 'Tempo (BPM)' },
];

export const SignalInputControls = memo(function SignalInputControls() {
  const inputSource = usePreviewStore((s) => s.inputSource);

  // Get setters via getState to avoid re-renders
  const setInputSource = usePreviewStore.getState().setInputSource;
  const setSignalFrequency = usePreviewStore.getState().setSignalFrequency;

  // Update signal when frequency changes (while playing)
  const handleFrequencyChange = useCallback(async (freq: number) => {
    setSignalFrequency(freq);
    const state = usePreviewStore.getState();
    if (state.engineInitialized && state.isPlaying && state.inputSource.type === 'signal') {
      try {
        await previewApi.previewSetFrequency(freq);
      } catch (err) {
        console.error('Failed to set frequency:', err);
      }
    }
  }, [setSignalFrequency]);

  // Change signal type - updates immediately if playing
  const handleSignalTypeChange = useCallback(async (signalType: SignalType) => {
    const currentInputSource = usePreviewStore.getState().inputSource;
    setInputSource({ ...currentInputSource, signalType });

    // If playing, update the signal immediately
    const state = usePreviewStore.getState();
    if (state.isPlaying && state.engineInitialized) {
      try {
        await previewApi.previewSetSignal(
          signalType,
          currentInputSource.signalFrequency || 440,
          0.5,
          currentInputSource.gatePattern || 'continuous',
          currentInputSource.gateRate || 2.0,
          currentInputSource.gateDuty || 0.5
        );
      } catch (err) {
        console.error('Failed to change signal type:', err);
      }
    }
  }, [setInputSource]);

  // Change gate pattern - updates immediately if playing
  const handleGateChange = useCallback(async (
    pattern: GatePattern,
    rate?: number,
    duty?: number
  ) => {
    const currentInputSource = usePreviewStore.getState().inputSource;
    // Use appropriate default rate based on pattern type
    const defaultRate = pattern === 'pulse' ? 2.0 : 120; // Hz for pulse, BPM for musical
    const newRate = rate ?? (pattern !== currentInputSource.gatePattern ? defaultRate : currentInputSource.gateRate);

    setInputSource({
      ...currentInputSource,
      gatePattern: pattern,
      gateRate: newRate,
      gateDuty: duty ?? currentInputSource.gateDuty,
    });

    // If playing, update the gate immediately
    const state = usePreviewStore.getState();
    if (state.isPlaying && state.engineInitialized && currentInputSource.type === 'signal') {
      try {
        await previewApi.previewSetGate(pattern, newRate, duty ?? currentInputSource.gateDuty);
      } catch (err) {
        console.error('Failed to change gate pattern:', err);
      }
    }
  }, [setInputSource]);

  return (
    <div className="space-y-4">
      <select
        value={inputSource.signalType || 'sine'}
        onChange={(e) => handleSignalTypeChange(e.target.value as SignalType)}
        className="w-full px-3 py-2 bg-bg-tertiary border border-border rounded-lg text-text-primary text-sm focus:outline-none focus:border-accent"
      >
        {SIGNAL_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {(inputSource.signalType === 'sine' || inputSource.signalType === 'square' || inputSource.signalType === 'impulse') && (
        <FrequencySelector
          frequency={inputSource.signalFrequency || 440}
          onChange={handleFrequencyChange}
        />
      )}

      {/* Gate/Pulse Pattern Controls */}
      <div className="space-y-3 pt-2 border-t border-border">
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">Gate Pattern</span>
        </div>

        {/* Gate Pattern Selector */}
        <div className="flex flex-wrap gap-1">
          {GATE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleGateChange(opt.value)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                (inputSource.gatePattern || 'continuous') === opt.value
                  ? 'bg-accent text-white'
                  : 'bg-bg-primary text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Rate and Duty Controls (only for non-continuous patterns) */}
        {inputSource.gatePattern && inputSource.gatePattern !== 'continuous' && (
          <div className="space-y-3">
            {/* Rate Control */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">
                  {GATE_OPTIONS.find(o => o.value === inputSource.gatePattern)?.rateLabel || 'Rate'}
                </span>
                <span className="text-xs font-medium text-accent">
                  {inputSource.gatePattern === 'pulse'
                    ? `${(inputSource.gateRate || 2).toFixed(1)} Hz`
                    : `${Math.round(inputSource.gateRate || 120)} BPM`}
                </span>
              </div>
              <input
                type="range"
                min={inputSource.gatePattern === 'pulse' ? 0.1 : 40}
                max={inputSource.gatePattern === 'pulse' ? 20 : 240}
                step={inputSource.gatePattern === 'pulse' ? 0.1 : 1}
                value={inputSource.gateRate || (inputSource.gatePattern === 'pulse' ? 2 : 120)}
                onChange={(e) => handleGateChange(
                  inputSource.gatePattern!,
                  Number(e.target.value),
                  inputSource.gateDuty
                )}
                className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent"
              />
            </div>

            {/* Duty Cycle Control */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-text-muted">Duty Cycle</span>
                <span className="text-xs font-medium text-accent">
                  {Math.round((inputSource.gateDuty || 0.5) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0.05}
                max={0.95}
                step={0.05}
                value={inputSource.gateDuty || 0.5}
                onChange={(e) => handleGateChange(
                  inputSource.gatePattern!,
                  inputSource.gateRate,
                  Number(e.target.value)
                )}
                className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer accent-accent"
              />
            </div>
          </div>
        )}
      </div>

    </div>
  );
});
