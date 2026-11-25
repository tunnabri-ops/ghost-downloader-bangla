const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ghostAPI', {
  downloadFile: (payload) => ipcRenderer.send('download-file', payload),
  pauseDownload: (id) => ipcRenderer.send('download-pause', id),
  resumeDownload: (id) => ipcRenderer.send('download-resume', id),
  cancelDownload: (id) => ipcRenderer.send('download-cancel', id),
  downloadM3U8: (payload) => ipcRenderer.send('download-m3u8', payload),
  ytDlpDownload: (payload) => ipcRenderer.send('yt-dlp-download', payload),
  openDownloadsFolder: () => ipcRenderer.send('open-downloads-folder'),
  getDownloadsDir: () => ipcRenderer.invoke('get-downloads-dir'),
  // v1.1.0: clipboard monitor
  setClipboardMonitor: (enabled) => ipcRenderer.send('clipboard-monitor-set', enabled),
  onClipboardLink: (cb) => ipcRenderer.on('clipboard-link-found', (_e, data) => cb(data)),
  // v1.1.0: scheduled downloads
  scheduleDownload: (payload) => ipcRenderer.send('schedule-download', payload),
  cancelSchedule: (id) => ipcRenderer.send('schedule-cancel', id),
  getSchedules: () => ipcRenderer.invoke('get-schedules'),
  onScheduleUpdated: (cb) => ipcRenderer.on('schedule-updated', (_e, data) => cb(data)),
  onScheduleDue: (cb) => ipcRenderer.on('schedule-due', (_e, data) => cb(data)),
  // v1.1.0: today's totals
  getTodayTotals: () => ipcRenderer.invoke('get-today-totals'),
  onTodayTotals: (cb) => ipcRenderer.on('today-totals', (_e, data) => cb(data)),
  checkForUpdate: () => ipcRenderer.send('check-for-update'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_e, data) => cb(data)),
  onUpdateCheckDone: (cb) => ipcRenderer.on('update-check-done', (_e, data) => cb(data)),
  onProgress: (cb) => ipcRenderer.on('download-progress', (_e, data) => cb(data)),
  onDone: (cb) => ipcRenderer.on('download-done', (_e, data) => cb(data)),
  onError: (cb) => ipcRenderer.on('download-error', (_e, data) => cb(data)),
  onPaused: (cb) => ipcRenderer.on('download-paused', (_e, data) => cb(data)),
  onCancelled: (cb) => ipcRenderer.on('download-cancelled', (_e, data) => cb(data))
});
