import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import type { CustomThemeColors } from '../../types';
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification';
import { IS_MAC } from '../../lib/platform';

// Helper to lighten/darken hex colors for hover states
function adjustColor(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.min(255, Math.max(0, (num >> 16) + amt));
  const G = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amt));
  const B = Math.min(255, Math.max(0, (num & 0x0000ff) + amt));
  return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
}

// Helper to create rgba from hex
function hexToRgba(hex: string, alpha: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const R = (num >> 16) & 255;
  const G = (num >> 8) & 255;
  const B = num & 255;
  return `rgba(${R}, ${G}, ${B}, ${alpha})`;
}

// Helper to determine if a color is light or dark
function isLightColor(hex: string): boolean {
  const num = parseInt(hex.replace('#', ''), 16);
  const R = (num >> 16) & 255;
  const G = (num >> 8) & 255;
  const B = num & 255;
  const luminance = (0.299 * R + 0.587 * G + 0.114 * B) / 255;
  return luminance > 0.5;
}

// Apply theme to document
export function applyTheme(theme: 'dark' | 'light' | 'custom', customColors?: CustomThemeColors) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);

  if (theme === 'custom' && customColors) {
    const isLight = isLightColor(customColors.bgPrimary);
    root.style.setProperty('--theme-bg-primary', customColors.bgPrimary);
    root.style.setProperty('--theme-bg-secondary', customColors.bgSecondary);
    root.style.setProperty('--theme-bg-tertiary', customColors.bgTertiary);
    root.style.setProperty('--theme-bg-elevated', isLight ? '#ffffff' : adjustColor(customColors.bgTertiary, 10));
    root.style.setProperty('--theme-text-primary', customColors.textPrimary);
    root.style.setProperty('--theme-text-secondary', customColors.textSecondary);
    root.style.setProperty('--theme-text-muted', adjustColor(customColors.textSecondary, isLight ? -20 : -30));
    root.style.setProperty('--theme-accent', customColors.accent);
    root.style.setProperty('--theme-accent-hover', adjustColor(customColors.accent, isLight ? -15 : 15));
    root.style.setProperty('--theme-accent-subtle', hexToRgba(customColors.accent, 0.15));
    root.style.setProperty('--theme-border', isLight ? '#e5e5e5' : adjustColor(customColors.bgTertiary, 10));
    root.style.setProperty('--theme-border-subtle', isLight ? '#f0f0f0' : customColors.bgTertiary);
    root.style.setProperty('--theme-chat-user', customColors.chatUser);
    root.style.setProperty('--theme-chat-user-hover', adjustColor(customColors.chatUser, isLight ? -15 : -15));
    root.style.setProperty('--theme-chat-inset', adjustColor(customColors.bgSecondary, isLight ? -3 : -5));
  } else {
    // Clear custom properties for non-custom themes
    const props = [
      '--theme-bg-primary', '--theme-bg-secondary', '--theme-bg-tertiary', '--theme-bg-elevated',
      '--theme-text-primary', '--theme-text-secondary', '--theme-text-muted',
      '--theme-accent', '--theme-accent-hover', '--theme-accent-subtle',
      '--theme-border', '--theme-border-subtle',
      '--theme-chat-user', '--theme-chat-user-hover', '--theme-chat-inset',
    ];
    props.forEach((prop) => root.style.removeProperty(prop));
  }
}

interface ColorInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

function ColorInput({ label, value, onChange }: ColorInputProps) {
  // Track local input state to allow typing incomplete values
  const [localValue, setLocalValue] = useState(value);

  // Sync local value when prop changes (e.g., from color picker)
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  return (
    <div className="flex items-center justify-between">
      <label className="text-sm text-text-secondary">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-8 h-8 rounded cursor-pointer border border-border"
        />
        <input
          type="text"
          value={localValue}
          onChange={(e) => {
            const val = e.target.value;
            // Allow typing partial values
            if (/^#?[0-9A-Fa-f]{0,6}$/.test(val)) {
              setLocalValue(val.startsWith('#') ? val : `#${val}`);
            }
          }}
          onBlur={() => {
            // On blur, validate and apply if complete, otherwise revert
            const cleanVal = localValue.startsWith('#') ? localValue : `#${localValue}`;
            if (/^#[0-9A-Fa-f]{6}$/.test(cleanVal)) {
              onChange(cleanVal);
            } else {
              setLocalValue(value); // Revert to last valid value
            }
          }}
          className="w-20 px-2 py-1 text-xs font-mono bg-bg-primary border border-border rounded text-text-primary"
          placeholder="#000000"
        />
      </div>
    </div>
  );
}

export function ThemePicker() {
  const { theme, setTheme, customColors, updateCustomColor, showNotifications, setShowNotifications } = useSettingsStore();
  const [notificationPermissionDenied, setNotificationPermissionDenied] = useState(false);

  // Apply theme on mount and when it changes
  useEffect(() => {
    applyTheme(theme, customColors);
  }, [theme, customColors]);

  const handleNotificationToggle = async (enabled: boolean) => {
    if (enabled) {
      try {
        let granted = await isPermissionGranted();
        if (!granted) {
          const permission = await requestPermission();
          granted = permission === 'granted';
        }
        if (granted) {
          setShowNotifications(true);
          setNotificationPermissionDenied(false);
        } else {
          // Permission denied - keep setting enabled so user knows to fix in System Settings
          setNotificationPermissionDenied(true);
          setShowNotifications(true);
        }
      } catch (err) {
        console.error('Failed to request notification permission:', err);
        // On error, show permission denied state so user knows there's an issue
        setNotificationPermissionDenied(true);
        setShowNotifications(false);
      }
    } else {
      setShowNotifications(false);
      setNotificationPermissionDenied(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-text-primary mb-1">Appearance</h3>
        <p className="text-sm text-text-muted">Customize how freqlab looks on your device.</p>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-secondary mb-3">Theme</label>
        <div className="grid grid-cols-3 gap-3">
          {/* Dark theme */}
          <button
            onClick={() => setTheme('dark')}
            className={`relative p-3 rounded-xl border-2 transition-all ${
              theme === 'dark'
                ? 'border-accent bg-accent/5'
                : 'border-border hover:border-text-muted'
            }`}
          >
            <div className="w-full aspect-video rounded-lg bg-[#0a0a0f] border border-white/10 mb-2 overflow-hidden">
              <div className="h-1.5 bg-white/10" />
              <div className="flex h-full">
                <div className="w-1/4 bg-white/5" />
                <div className="flex-1 p-1">
                  <div className="h-0.5 w-2/3 bg-[#2DA86E] rounded mb-0.5" />
                  <div className="h-0.5 w-1/2 bg-white/10 rounded" />
                </div>
              </div>
            </div>
            <span className="text-xs font-medium text-text-primary">Dark</span>
            {theme === 'dark' && (
              <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </button>

          {/* Light theme */}
          <button
            onClick={() => setTheme('light')}
            className={`relative p-3 rounded-xl border-2 transition-all ${
              theme === 'light'
                ? 'border-accent bg-accent/5'
                : 'border-border hover:border-text-muted'
            }`}
          >
            <div className="w-full aspect-video rounded-lg bg-[#f5f5f5] border border-black/10 mb-2 overflow-hidden">
              <div className="h-1.5 bg-black/5" />
              <div className="flex h-full">
                <div className="w-1/4 bg-black/5" />
                <div className="flex-1 p-1">
                  <div className="h-0.5 w-2/3 bg-[#229660] rounded mb-0.5" />
                  <div className="h-0.5 w-1/2 bg-black/10 rounded" />
                </div>
              </div>
            </div>
            <span className="text-xs font-medium text-text-primary">Light</span>
            {theme === 'light' && (
              <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </button>

          {/* Custom theme */}
          <button
            onClick={() => setTheme('custom')}
            className={`relative p-3 rounded-xl border-2 transition-all ${
              theme === 'custom'
                ? 'border-accent bg-accent/5'
                : 'border-border hover:border-text-muted'
            }`}
          >
            <div
              className="w-full aspect-video rounded-lg border border-white/10 mb-2 overflow-hidden"
              style={{ backgroundColor: customColors.bgPrimary }}
            >
              <div className="h-1.5" style={{ backgroundColor: customColors.bgSecondary }} />
              <div className="flex h-full">
                <div className="w-1/4" style={{ backgroundColor: customColors.bgSecondary }} />
                <div className="flex-1 p-1">
                  <div className="h-0.5 w-2/3 rounded mb-0.5" style={{ backgroundColor: customColors.accent }} />
                  <div className="h-0.5 w-1/2 rounded" style={{ backgroundColor: customColors.textSecondary, opacity: 0.3 }} />
                </div>
              </div>
            </div>
            <span className="text-xs font-medium text-text-primary">Custom</span>
            {theme === 'custom' && (
              <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
            )}
          </button>
        </div>
      </div>

      {/* Custom color pickers - only show when custom theme is selected */}
      {theme === 'custom' && (
        <div className="space-y-4 pt-2 border-t border-border">
          <h4 className="text-sm font-medium text-text-secondary">Custom Colors</h4>

          <div className="space-y-3">
            <ColorInput
              label="Accent"
              value={customColors.accent}
              onChange={(val) => updateCustomColor('accent', val)}
            />
            <ColorInput
              label="Background"
              value={customColors.bgPrimary}
              onChange={(val) => updateCustomColor('bgPrimary', val)}
            />
            <ColorInput
              label="Secondary BG"
              value={customColors.bgSecondary}
              onChange={(val) => updateCustomColor('bgSecondary', val)}
            />
            <ColorInput
              label="Tertiary BG"
              value={customColors.bgTertiary}
              onChange={(val) => updateCustomColor('bgTertiary', val)}
            />
            <ColorInput
              label="Text Primary"
              value={customColors.textPrimary}
              onChange={(val) => updateCustomColor('textPrimary', val)}
            />
            <ColorInput
              label="Text Secondary"
              value={customColors.textSecondary}
              onChange={(val) => updateCustomColor('textSecondary', val)}
            />
            <ColorInput
              label="Chat Bubbles"
              value={customColors.chatUser}
              onChange={(val) => updateCustomColor('chatUser', val)}
            />
          </div>

          <p className="text-xs text-text-muted">
            Tip: Start with a background color and adjust text colors for contrast.
          </p>
        </div>
      )}

      {/* Notifications */}
      <div className="pt-6 border-t border-border">
        <h3 className="text-lg font-medium text-text-primary mb-1">Notifications</h3>
        <p className="text-sm text-text-muted mb-4">Control when freqlab notifies you.</p>

        <label className="flex items-center justify-between cursor-pointer p-3 rounded-lg bg-bg-tertiary hover:bg-bg-elevated transition-colors">
          <div>
            <span className="text-sm font-medium text-text-primary">Notify when chat finishes</span>
            <p className="text-xs text-text-muted">Show a notification when a chat completes and the app isn&apos;t focused</p>
          </div>
          <div className="relative flex-shrink-0 ml-4">
            <input
              type="checkbox"
              checked={showNotifications}
              onChange={(e) => handleNotificationToggle(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-bg-primary border border-border rounded-full peer-checked:bg-accent peer-checked:border-accent transition-colors" />
            <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-text-muted rounded-full peer-checked:translate-x-4 peer-checked:bg-white transition-all" />
          </div>
        </label>
        {notificationPermissionDenied && (
          <p className="text-xs text-warning mt-2 px-3">
            Permission denied. Enable notifications in System Settings &gt; Notifications &gt; freqlab
          </p>
        )}
      </div>

      {/* macOS Permissions Help */}
      {IS_MAC && (
      <div className="pt-6 border-t border-border">
        <h3 className="text-lg font-medium text-text-primary mb-1">macOS Permissions</h3>
        <p className="text-sm text-text-muted mb-4">Troubleshoot permission issues on macOS.</p>

        <div className="space-y-3">
          <div className="p-3 rounded-lg bg-bg-tertiary">
            <p className="text-sm font-medium text-text-primary mb-1">&quot;Access data from other apps&quot; prompt</p>
            <p className="text-xs text-text-muted">
              If you see this repeatedly when Claude edits files, enable <span className="text-text-secondary">freqlab</span> in{' '}
              <span className="text-text-secondary">System Settings → Privacy & Security → Full Disk Access</span>.
            </p>
          </div>

          <div className="p-3 rounded-lg bg-bg-tertiary">
            <p className="text-sm font-medium text-text-primary mb-1">Notifications not working</p>
            <p className="text-xs text-text-muted">
              Check that freqlab is enabled in{' '}
              <span className="text-text-secondary">System Settings → Notifications → freqlab</span>.
            </p>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
