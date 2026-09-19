/**
 * Audio output device selection.
 *
 * WebAudio can route to a chosen output (`AudioContext.setSinkId`), which is
 * the difference between monitoring on headphones and on speakers without
 * changing the operating system's default. It is Chromium-only for now, so the
 * capability is probed rather than assumed and the UI hides itself when it is
 * missing.
 *
 * The listing logic is pure so the naming rules can be tested.
 */

export interface OutputDevice {
  id: string;
  label: string;
}

/** True when this context can be routed to a chosen output. */
export function canPickOutput(ctx: AudioContext | null): boolean {
  return Boolean(ctx && typeof (ctx as AudioContext & { setSinkId?: unknown }).setSinkId === 'function');
}

/**
 * Name a device. Browsers hide labels until microphone permission has been
 * granted, so unnamed devices get a stable numbered name rather than showing
 * "undefined" or an empty row.
 */
export function outputLabel(device: MediaDeviceInfo, index: number, fallback: string): string {
  const label = device.label?.trim();
  return label && label.length > 0 ? label : `${fallback} ${index + 1}`;
}

/** The output list, in the order the browser reports, with labels filled in. */
export function outputDevices(devices: MediaDeviceInfo[], fallback: string): OutputDevice[] {
  return devices
    .filter((device) => device.kind === 'audiooutput')
    .map((device, index) => ({ id: device.deviceId, label: outputLabel(device, index, fallback) }));
}

/** Which entry a select should show as current. */
export function currentOutputId(devices: OutputDevice[], active: string | null): string {
  if (active && devices.some((device) => device.id === active)) return active;
  return devices[0]?.id ?? '';
}
