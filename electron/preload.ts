import { contextBridge, ipcRenderer } from 'electron';

const api = {
  saveFile: (request: {
    defaultName: string;
    data: Uint8Array;
    filters: { name: string; extensions: string[] }[];
  }): Promise<{ saved: boolean; filePath?: string }> => ipcRenderer.invoke('save-file', request),

  showItemInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('show-item-in-folder', filePath),
};

contextBridge.exposeInMainWorld('trizen', api);

export type TrizenApi = typeof api;
