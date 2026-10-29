/** The OS GameBridge runs on, for hints and defaults that differ between Windows and Linux. */
export const PLATFORM = window.gamebridge.platform

export const IS_WINDOWS = PLATFORM === 'win32'
