import { invoke } from '@tauri-apps/api/core';
import type { PrerequisiteStatus } from '../types';

export async function checkPrerequisites(): Promise<PrerequisiteStatus> {
  return invoke<PrerequisiteStatus>('check_prerequisites');
}
