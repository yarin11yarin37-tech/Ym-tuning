/**
 * USB / YM VCI discovery.
 *
 * Lists serial-class USB devices so the user can see what is plugged in. A listed device is
 * NEVER presented as able to talk to a vehicle: capabilities stay 'not-supported' until a
 * device-specific driver identifies it and is tested. YM VCI hardware is not released; its
 * USB identifiers are not defined yet, so it can never be "detected" in this version.
 */
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import type { HardwareDevice, UsbScan } from '../../shared/workshop';
import { NONE } from './hal';

/** USB vendor/product ids for YM VCI — intentionally empty until hardware exists. */
export const YM_VCI_USB_IDS: { vid: number; pid: number }[] = [];

const UNIX_PATTERNS: Record<string, RegExp> = {
  darwin: /^cu\.(usbserial|usbmodem|SLAB_USBtoUART|wchusbserial)/,
  linux: /^(ttyUSB|ttyACM)\d+$/,
};

export function parseWindowsSerial(stdout: string): { path: string; name: string }[] {
  // Output of: Get-CimInstance Win32_SerialPort | ForEach-Object { "$($_.DeviceID)|$($_.Name)" }
  return stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^COM\d+\|/.test(l))
    .map((l) => {
      const [p, ...rest] = l.split('|');
      return { path: p, name: rest.join('|').trim() || p };
    });
}

function device(path: string, name: string): HardwareDevice {
  return { id: `usb:${path}`, transport: 'usb-serial', name, path, identified: false, capabilities: NONE };
}

export async function scanUsb(platform: NodeJS.Platform = process.platform): Promise<UsbScan> {
  if (platform === 'darwin' || platform === 'linux') {
    try {
      const re = UNIX_PATTERNS[platform];
      const names = fs.readdirSync('/dev').filter((n) => re.test(n)).sort();
      return { supported: true, devices: names.map((n) => device(`/dev/${n}`, n)) };
    } catch {
      return { supported: false, devices: [], reasonKey: 'usb.reason.readFailed' };
    }
  }
  if (platform === 'win32') {
    const out = await new Promise<string | null>((resolve) =>
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_SerialPort | ForEach-Object { "$($_.DeviceID)|$($_.Name)" }'],
        { timeout: 5000, windowsHide: true },
        (err, stdout) => resolve(err ? null : stdout),
      ),
    );
    if (out === null) return { supported: false, devices: [], reasonKey: 'usb.reason.readFailed' };
    return { supported: true, devices: parseWindowsSerial(out).map((d) => device(d.path, d.name)) };
  }
  return { supported: false, devices: [], reasonKey: 'usb.reason.platform' };
}
