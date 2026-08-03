import { app, BrowserWindow, shell, dialog, ipcMain } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Built output lives one level up from dist-electron.
process.env.APP_ROOT = path.join(__dirname, '..');

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0f1216',
    title: 'Trizen Commission Portal',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win?.show());

  // External links open in the user's real browser, never inside the app shell.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const protocol = new URL(url).protocol;
    if (protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:') {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // The renderer should never leave the packaged application. Without this,
  // a clicked or injected link could replace the app window with a web page.
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  if (VITE_DEV_SERVER_URL) {
    void win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }
}

/**
 * Renderer hands us the bytes of a generated report; we own the save dialog and
 * the disk write so the renderer never touches the filesystem directly.
 */
ipcMain.handle(
  'save-file',
  async (_event, { defaultName, data, filters }: SaveFileRequest): Promise<SaveFileResult> => {
    if (!win) return { saved: false };

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      defaultPath: defaultName,
      filters,
    });
    if (canceled || !filePath) return { saved: false };

    await fs.writeFile(filePath, Buffer.from(data));
    return { saved: true, filePath };
  },
);

ipcMain.handle('show-item-in-folder', (_event, filePath: unknown) => {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error('Invalid file path.');
  }
  shell.showItemInFolder(filePath);
});

interface SaveFileRequest {
  defaultName: string;
  data: Uint8Array;
  filters: { name: string; extensions: string[] }[];
}

interface SaveFileResult {
  saved: boolean;
  filePath?: string;
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
  win = null;
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
