/**
 * Feature: backup & history (works on every plan — no plan gate). Public API
 * only — other features and AdminPanel import from here, never deep.
 */
export { default as BackupPanel } from './components/BackupPanel';
export { useBackupHistory } from './hooks/useBackupHistory';
export type { Change, VersionEntry, TrashEntry, ActivityEntry } from './components/BackupPanel';
