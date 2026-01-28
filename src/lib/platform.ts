import { platform } from '@tauri-apps/plugin-os';
import type { DawPaths } from '../types';

// Platform detection - synchronous, safe to call at module level
export const PLATFORM = platform(); // 'macos' | 'windows' | 'linux'
export const IS_MAC = PLATFORM === 'macos';
export const IS_WINDOWS = PLATFORM === 'windows';
export const IS_LINUX = PLATFORM === 'linux';

const macDawPaths: DawPaths = {
  reaper: { vst3: '~/Library/Audio/Plug-Ins/VST3', clap: '~/Library/Audio/Plug-Ins/CLAP', au: '~/Library/Audio/Plug-Ins/Components', auv3: '', aax: '/Library/Application Support/Avid/Audio/Plug-Ins', lv2: '~/Library/Audio/Plug-Ins/LV2', standalone: '/Applications' },
  ableton: { vst3: '~/Library/Audio/Plug-Ins/VST3', clap: '~/Library/Audio/Plug-Ins/CLAP', au: '~/Library/Audio/Plug-Ins/Components', auv3: '', aax: '/Library/Application Support/Avid/Audio/Plug-Ins', lv2: '~/Library/Audio/Plug-Ins/LV2', standalone: '/Applications' },
  flStudio: { vst3: '~/Library/Audio/Plug-Ins/VST3', clap: '~/Library/Audio/Plug-Ins/CLAP', au: '~/Library/Audio/Plug-Ins/Components', auv3: '', aax: '/Library/Application Support/Avid/Audio/Plug-Ins', lv2: '~/Library/Audio/Plug-Ins/LV2', standalone: '/Applications' },
  logic: { vst3: '~/Library/Audio/Plug-Ins/VST3', clap: '~/Library/Audio/Plug-Ins/CLAP', au: '~/Library/Audio/Plug-Ins/Components', auv3: '', aax: '/Library/Application Support/Avid/Audio/Plug-Ins', lv2: '~/Library/Audio/Plug-Ins/LV2', standalone: '/Applications' },
  other: { vst3: '', clap: '', au: '', auv3: '', aax: '', lv2: '', standalone: '' },
};

const windowsDawPaths: DawPaths = {
  reaper: { vst3: 'C:\\Program Files\\Common Files\\VST3', clap: 'C:\\Program Files\\Common Files\\CLAP', au: '', auv3: '', aax: 'C:\\Program Files\\Common Files\\Avid\\Audio\\Plug-Ins', lv2: 'C:\\Program Files\\Common Files\\LV2', standalone: 'C:\\Program Files' },
  ableton: { vst3: 'C:\\Program Files\\Common Files\\VST3', clap: 'C:\\Program Files\\Common Files\\CLAP', au: '', auv3: '', aax: 'C:\\Program Files\\Common Files\\Avid\\Audio\\Plug-Ins', lv2: 'C:\\Program Files\\Common Files\\LV2', standalone: 'C:\\Program Files' },
  flStudio: { vst3: 'C:\\Program Files\\Common Files\\VST3', clap: 'C:\\Program Files\\Common Files\\CLAP', au: '', auv3: '', aax: 'C:\\Program Files\\Common Files\\Avid\\Audio\\Plug-Ins', lv2: 'C:\\Program Files\\Common Files\\LV2', standalone: 'C:\\Program Files' },
  logic: { vst3: '', clap: '', au: '', auv3: '', aax: '', lv2: '', standalone: '' }, // Logic is macOS-only
  other: { vst3: '', clap: '', au: '', auv3: '', aax: '', lv2: '', standalone: '' },
};

const linuxDawPaths: DawPaths = {
  reaper: { vst3: '~/.vst3', clap: '~/.clap', au: '', auv3: '', aax: '', lv2: '~/.lv2', standalone: '/usr/local/bin' },
  ableton: { vst3: '~/.vst3', clap: '~/.clap', au: '', auv3: '', aax: '', lv2: '~/.lv2', standalone: '/usr/local/bin' },
  flStudio: { vst3: '~/.vst3', clap: '~/.clap', au: '', auv3: '', aax: '', lv2: '~/.lv2', standalone: '/usr/local/bin' },
  logic: { vst3: '', clap: '', au: '', auv3: '', aax: '', lv2: '', standalone: '' },
  other: { vst3: '', clap: '', au: '', auv3: '', aax: '', lv2: '', standalone: '' },
};

export interface PlatformDefaults {
  dawPaths: DawPaths;
  workspacePath: string;
  buildToolsName: string;
  buildToolsInstallHint: string;
  pluginFolderDescription: string;
  cmakeInstallHint: string;
}

export function getPlatformDefaults(): PlatformDefaults {
  if (IS_WINDOWS) {
    return {
      dawPaths: windowsDawPaths,
      workspacePath: '~/Freqlab',
      buildToolsName: 'Visual Studio Build Tools',
      buildToolsInstallHint: 'Install Visual Studio Build Tools with the C++ workload',
      pluginFolderDescription: 'Most DAWs on Windows use the system plugin folders in Program Files',
      cmakeInstallHint: 'Download CMake from cmake.org or install via winget',
    };
  }
  if (IS_LINUX) {
    return {
      dawPaths: linuxDawPaths,
      workspacePath: '~/Freqlab',
      buildToolsName: 'GCC/Clang Build Tools',
      buildToolsInstallHint: 'Install build-essential or equivalent for your distribution',
      pluginFolderDescription: 'Most DAWs on Linux use ~/.vst3 and ~/.clap for user plugins',
      cmakeInstallHint: 'Install CMake via your package manager',
    };
  }
  // macOS default
  return {
    dawPaths: macDawPaths,
    workspacePath: '~/Freqlab',
    buildToolsName: 'Xcode Command Line Tools',
    buildToolsInstallHint: 'Install Xcode Command Line Tools via the App Store or xcode-select --install',
    pluginFolderDescription: 'Most DAWs on macOS use the system plugin folders in ~/Library/Audio/Plug-Ins',
    cmakeInstallHint: 'Install CMake via Homebrew: brew install cmake',
  };
}
