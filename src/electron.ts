import { app, BrowserWindow } from 'electron';
import path from 'path';
import url from 'url';

// Your Electron app code using import/exports
export function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    void win.loadFile('public/mainConfig.html');
    console.log("Kaptain to the planet");
}

app.whenReady().then(createWindow);