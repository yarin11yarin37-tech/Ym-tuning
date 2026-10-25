import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { Workshop } from './workshop';
import { createWorkshopHandlers, WORKSHOP_CHANNELS, MAX_FILE_BYTES, type Dialogs } from './workshopHandlers';
import type { SecretStore } from './services/assistant';
import { ObdService } from './obd/obdService';
import { ProfileStore } from './profileStore';
import { createHandlers, IPC_CHANNELS } from './ipcHandlers';

const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const service = new ObdService();
let win: BrowserWindow | null = null;

function isTrustedSender(url: string): boolean {
  if (DEV_URL && url.startsWith(DEV_URL)) return true;
  return url.startsWith('file://');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0A0B0D',
    title: 'YM TUNING',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win?.show());

  // No new windows, no navigation away from the app.
  win.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e: { preventDefault(): void }) => e.preventDefault());

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  const userData = app.getPath('userData');
  const store = new ProfileStore(userData);
  const handlers: Record<string, (...a: unknown[]) => Promise<unknown>> = { ...createHandlers(service, store) };

  // AI key is encrypted with the OS keychain (safeStorage); never stored in plain text.
  const keyFile = path.join(userData, 'assistant.key');
  const secret: SecretStore = {
    get: () => {
      try {
        if (!safeStorage.isEncryptionAvailable() || !fs.existsSync(keyFile)) return null;
        return safeStorage.decryptString(fs.readFileSync(keyFile));
      } catch {
        return null;
      }
    },
    set: (v) => {
      if (v === null) fs.rmSync(keyFile, { force: true });
      else if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(keyFile, safeStorage.encryptString(v), { mode: 0o600 });
      else throw new Error('secure storage unavailable');
    },
  };
  const dialogs: Dialogs = {
    openFile: async (kind) => {
      const r = await dialog.showOpenDialog(win!, {
        properties: ['openFile'],
        filters: kind === 'definition' ? [{ name: 'YM definition', extensions: ['json'] }] : [{ name: 'Binary', extensions: ['bin', 'ori', 'hex', 'mod', '*'] }],
      });
      if (r.canceled || !r.filePaths[0]) return null;
      const p = r.filePaths[0];
      if (fs.statSync(p).size > MAX_FILE_BYTES) throw new Error('file too large');
      return { name: path.basename(p), data: fs.readFileSync(p) };
    },
    saveFile: async (defaultName, kind) => {
      const r = await dialog.showSaveDialog(win!, {
        defaultPath: defaultName,
        filters: kind === 'report' ? [{ name: 'HTML', extensions: ['html'] }] : [{ name: 'Binary', extensions: ['bin'] }],
      });
      return r.canceled || !r.filePath ? null : r.filePath;
    },
  };
  const workshop = new Workshop(path.join(userData, 'workshop'), secret);
  Object.assign(handlers, createWorkshopHandlers(workshop, dialogs, () => service.lastVin));
  app.on('before-quit', () => workshop.close());

  for (const channel of [...IPC_CHANNELS, ...WORKSHOP_CHANNELS]) {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!event.senderFrame || !isTrustedSender(event.senderFrame.url)) {
        return { ok: false, error: { code: 'COMMAND_REJECTED', detail: 'untrusted sender' } };
      }
      try {
        return await handlers[channel]!(...args);
      } catch (e) {
        // Last line of defence: a handler bug must never crash the main process.
        return { ok: false, error: { code: 'INTERNAL', detail: String((e as Error)?.message ?? e).slice(0, 200) } };
      }
    });
  }

  service.on('status', (s) => win?.webContents.send('obd:status-event', s));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  await service.disconnect().catch(() => undefined);
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (e) => console.error('[main] uncaught', e));
process.on('unhandledRejection', (e) => console.error('[main] unhandled rejection', e));
