const {contextBridge, ipcRenderer} = require("electron");

contextBridge.exposeInMainWorld('electronAPI', {
    closeBoth: () => ipcRenderer.send('close-both'),
    onAppInfo: (callback) => ipcRenderer.on('app-info', (event, data) => callback(data)),
    requestCloseApp: (info) => ipcRenderer.send('close-app-and-overlay', info),
    turnOffSetting: (settingId) => ipcRenderer.send("turnOffSetting", { settingId }),
    ipcRenderer: {
        send: (channel, data) => ipcRenderer.send(channel, data),
        on: (channel, func) => ipcRenderer.on(channel, (event, ...args) => func(...args)),
    },
    closeOverlay: () => ipcRenderer.send('closeOverlay'),
    closeTaskManager:() => ipcRenderer.send('closeTaskManager')
});