// Gera build/icon.png (1024×1024) a partir de build/icon.svg usando o próprio Electron.
// Uso: npx electron scripts/render-icon.cjs  (o PNG resultante é versionado; o electron-builder
// converte para .ico/.icns no build).
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const svg = readFileSync(join(root, 'build', 'icon.svg'), 'utf8');
const html = `<!doctype html><html><body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="1024" height="1024" ')}</body></html>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, javascript: false } });
  win.webContents.setZoomFactor(1);
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const png = image.resize({ width: 1024, height: 1024 }).toPNG();
  writeFileSync(join(root, 'build', 'icon.png'), png);
  console.log(`build/icon.png: ${png.length} bytes`);
  app.quit();
});
