import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
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
  const store = new ProfileStore(app.getPath('userData'));
  const handlers = createHandlers(service, store);

  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      if (!event.senderFrame || !isTrustedSender(event.senderFrame.url)) {
        return { ok: false, error: { code: 'COMMAND_REJECTED', detail: 'untrusted sender' } };
      }
      try {
        return await handlers[channel](...args);
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
