import { invoke } from '@tauri-apps/api/core';
import type { PrerequisiteStatus, DiskSpaceInfo, PermissionStatus } from '../types';

export async function checkPrerequisites(): Promise<PrerequisiteStatus> {
  return invoke<PrerequisiteStatus>('check_prerequisites');
}

export async function checkDiskSpace(): Promise<DiskSpaceInfo> {
  return invoke<DiskSpaceInfo>('check_disk_space');
}

// Permission commands
export async function checkPermissions(): Promise<PermissionStatus> {
  return invoke<PermissionStatus>('check_permissions');
}

export async function requestAccessibilityPermission(): Promise<boolean> {
  return invoke<boolean>('request_accessibility_permission');
}

export async function primeAdminPrivileges(): Promise<boolean> {
  return invoke<boolean>('prime_admin_privileges');
}

// Installation commands
export async function installXcode(): Promise<boolean> {
  return invoke<boolean>('install_xcode');
}

export async function installRust(): Promise<boolean> {
  return invoke<boolean>('install_rust');
}

export async function installClaudeCli(): Promise<boolean> {
  return invoke<boolean>('install_claude_cli');
}

export async function startClaudeAuth(): Promise<boolean> {
  return invoke<boolean>('start_claude_auth');
}
