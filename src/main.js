const {app, BrowserWindow, Menu, ipcMain, dialog}  = require('electron');
const {getPreference}  = require("./store.js");
const path = require("path");
const {exec} = require("child_process");
const {getInstalledAppInfo} = require("./installedApps");
const {enforceSafeSearch, isSafeSearchEnforced} = require("./safeSearchEnforcer");
const {startCountdownTimer, timerEvents, reactivateTimers} = require("./timeHandler");
const {getInstalledApps} = require("get-installed-apps");
const {closeApp, appBlockProtection, settingsProtectionOn, blockProtectionEmitter} = require("./blockProtection");
const {configureSafeDNS, getActiveInterfaceName, isSafeDNS, dnsSuccessfullySetEvent} = require("./dnsProtection");
const {addWebsiteToHostsFile} = require("./blockDomain");
const os = require("os");
const {savePreference, checkSavedPreferences} = require("./store");

let mainWindow = null;
const activeTimers = new Map();

let overlayWindow = null;
const isSettingsProtectionOn = true;

let dnsConfirmationModal = null;
let delayAccountDialog = null;
let flag = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
        }
    });

    mainWindow.webContents.openDevTools();

    mainWindow.loadFile('src/mainConfig.html').then(() => {
        const customMenu = Menu.buildFromTemplate(getMenuTemplate());
        Menu.setApplicationMenu(customMenu);
    });

    if(flag){
        makeWindowNotClosable(mainWindow);
    }
}

function makeWindowNotClosable(window){
    if(window){
        window.on('close', (e) => {
            const hasAppProtection = checkSavedPreferences("appUninstallationProtection");

            if (!hasAppProtection) {
                return;
            }

            e.preventDefault();

            dialog.showMessageBoxSync(window, {
                type: 'warning',
                buttons: ['OK'],
                defaultId: 0,
                title: 'Protected Window',
                message: 'Protection is Enabled',
                detail: 'You cannot close this window while app protection is active.'
            });
        });
    }
}

function getMenuTemplate(){
    return [
        {
            label: 'Home',
            click: () => openMainConfig()
        },
        {
            label: 'Block-Lists',
            submenu: [
                {
                    label: 'Block Websites',
                    click: () => openBlockWindowForWebsites()
                },
                {
                    label: 'Block Apps',
                    click: () => openBlockWindowForApps()
                }
            ]
        },
        {
            label: 'Settings',
            click: () => openDelaySettingDialogBox()
        }
    ];
}

function openBlockWindowForWebsites(){
    mainWindow.webPreferences = {
        ...mainWindow.webPreferences,
        nodeIntegration: false,
        preload: 'src/preload.js'
    }

    mainWindow.webContents.openDevTools();
    void mainWindow.loadFile('src/blockTableForWebsites.html');
}

async function openDelaySettingDialogBox() {
    mainWindow.backgroundColor = '#0047ab';
    mainWindow.webPreferences = {
        ...mainWindow.webPreferences,
        nodeIntegration: false,
        preload: 'src/preload.js'
    };

    mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.openDevTools();
        const delayStatus = getDelayChangeStatus();
        mainWindow.webContents.send('delayTimeout', delayStatus);
    });

    await mainWindow.loadFile('src/delaySettingModal.html');
}

async function openBlockWindowForApps(){
    mainWindow.webPreferences = {
        ...mainWindow.webPreferences,
        nodeIntegration: false,
        preload: 'src/preload.js'
    }

    await mainWindow.loadFile('src/blockTableForApps.html');
}

async function openMainConfig(){
    mainWindow.backgroundColor = '#0047ab';
    mainWindow.webPreferences = {
        ...mainWindow.webPreferences,
        nodeIntegration: true,
        contextIsolation: false,
        preload: 'src/preload.js'
    };

    mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.openDevTools();
        const delayStatus = getDelayChangeStatus();
        mainWindow.webContents.send('delayTimeout', delayStatus);
    });

    await mainWindow.loadFile('src/mainConfig.html').then(() => {
        const customMenu = Menu.buildFromTemplate(getMenuTemplate());
        Menu.setApplicationMenu(customMenu);
    });
}

const getDelayTimeOut = () => {
    const preferencesPath = 'data/savedPreferences.json';
    const value = getPreference("delayTimeout", preferencesPath);
    if(value === null){
        return 3*60*1000;
    }
    return value;
}

function getDelayChangeStatus() {
    const delayTimeoutId = "delayTimeout";
    const currentTimeout = getDelayTimeOut();

    const timerInfo = activeTimers.get(delayTimeoutId);
    if (timerInfo) {
        const now = Date.now();
        const timeRemaining = Math.max(timerInfo.endTime - now, 0);

        return {
            currentTimeout,
            isChanging: true,
            timeRemaining,
            newValue: timerInfo.newDelayValue
        };
    }

    return {
        currentTimeout,
        isChanging: false
    };
}

async function isDnsMadeSafe(){
    const interfaceName = await getActiveInterfaceName();
    return isSafeDNS(interfaceName);
}

ipcMain.handle('check-dns-safety', async () => await isDnsMadeSafe());

async function setDnsState(){
    const isDNSSafe = await isDnsMadeSafe();
    const id = "enableProtectiveDNS";
    if(!isDNSSafe){
        savePreference(id, false);
    }
}

function refreshMainConfig(){
    if(mainWindow && mainWindow.webContents){
        mainWindow.webContents.send('refreshMainConfig');
    }
}

async function handleDnsToggle(){
    const id = 'enableProtectiveDNS';
    const value = checkSavedPreferences(id);
    if(value){
        const isDnsSafe = await isDnsMadeSafe();
        if(!isDnsSafe){
            savePreference(id, false);
        }
    }
}

app.whenReady().then(async () => {
    settingsProtectionOn();
    appBlockProtection();
    reactivateTimers();

    createWindow();

    setDnsState().then(async () => {
        await handleDnsToggle();
        if(!isSafeSearchEnforced()){
            savePreference("enforceSafeSearch", false);
        }
        refreshMainConfig();
    });
});

const closeDNSConfirmationWindow = () => {
    if (dnsConfirmationModal && !dnsConfirmationModal.isDestroyed()) {
        dnsConfirmationModal.close();
        dnsConfirmationModal = null;
    }
}

function isSettingsOpen(callback) {
    exec('tasklist', (err, stdout) => {
        if (err) {
            console.error('Error executing tasklist:', err);
            callback(false);
            return;
        }

        const isOpen = stdout.toLowerCase().includes('control.exe');
        callback(isOpen);
    });
}

function monitorControlPanel() {
    if (isSettingsProtectionOn && overlayWindow === null){
        setInterval(() => {
            isSettingsOpen((open) => {
                if (open) {
                    console.log("Detected Control Panel is open!");
                    createOverlayWindow();
                }
            });
        }, 2000);
    }
}

function killSettingsApp() {
    exec('taskkill /IM SystemSettings.exe /F', (err) => {
        if (err) {
            console.error("Failed to kill Settings:", err);
        } else {
            console.log("Settings app terminated.");
        }
    });
}

function killControlPanel() {
    const proc =  'control.exe';
    exec(`taskkill /IM ${proc} /F`, (err) => {
        if (err) {
            console.error(`Failed to kill ${proc}:`, err);
        } else {
            console.log(`${proc} terminated.`);
        }
    });
}

function removeTimer(id){
    const intervalObject = activeTimers.get(id);
    const interval = intervalObject.intervalId;
    clearInterval(interval);
    activeTimers.delete(id);
}

function turnOffSetting(settingId){
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('turnOffSetting', settingId);
    }
}

function flagAppWithOverlay(displayName, processName) {
    if (!overlayWindow) {
        createOverlayWindow();

        overlayWindow.webContents.once('did-finish-load', () => {
            overlayWindow.webContents.send('app-info', { displayName, processName });
        });
    }
    else {
        overlayWindow.webContents.send('app-info', { displayName, processName });
    }
}

function showDNSConfirmationWindow() {
    if(dnsConfirmationModal != null){
        return;
    }
    dnsConfirmationModal = new BrowserWindow({
        width: 420,
        height: 450,
        modal: true,
        parent: BrowserWindow.getFocusedWindow(),
        show: false,
        resizable: true,
        minimizable: false,
        maximizable: true,
        frame: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    void dnsConfirmationModal.loadFile(path.join(__dirname, 'dnsConfirmationModal.html'));
    dnsConfirmationModal.once('ready-to-show', () => dnsConfirmationModal.show());
    dnsConfirmationModal.setMenu(null);
    dnsConfirmationModal.webContents.openDevTools();
}

function createOverlayWindow() {
    if (overlayWindow !== null){
        return;
    }

    overlayWindow = new BrowserWindow({
        frame: false,
        alwaysOnTop: true,
        transparent: false,
        fullscreen: true,
        backgroundColor: '#0047AB',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        }
    });

    void overlayWindow.loadFile('src/overlayWindow.html');

    overlayWindow.on('closed', () => {
        overlayWindow = null;
    });

    overlayWindow.webContents.openDevTools();
}

ipcMain.on('getAllInstalledApps', async (event) => {
    const apps = await getInstalledAppInfo();
    event.sender.send('installedAppsResult', JSON.parse(JSON.stringify(apps)));
});

ipcMain.on('addWebsiteToHostsFile', (event, { domain }) => void addWebsiteToHostsFile(event, domain));

ipcMain.on('close-app-and-overlay', (event, { displayName, processName }) => {
    closeApp(processName, displayName).then(() => {
        if (overlayWindow) {
            overlayWindow.close();
            overlayWindow = null;
        }
    });
});

ipcMain.on('close-delay-accountability-modal', () => closeDelayAccountabilityDialog());

ipcMain.on('confirm-delay-accountability', (event, settingId) => startCountdownTimer(activeTimers, settingId, null, null));

ipcMain.on('set-dns', () => {
    closeDNSConfirmationWindow();
    configureSafeDNS().then(() => savePreference("enableProtectiveDNS", true));
});

ipcMain.on('show-dns-dialog', () => showDNSConfirmationWindow());

ipcMain.on('enforce-safe-search', (event) => {
    enforceSafeSearch().then(() => {
        savePreference("enforceSafeSearch", true);
        event.sender.send('refreshMainConfig');
    });
});

ipcMain.on('set-delay-timeout', (event, delayValue) => savePreference("delayTimeout", delayValue));

ipcMain.on('start-delay-timeout-change', (event, newDelayValue) => {
    startCountdownTimer(activeTimers, "delayTimeout", getDelayTimeOut(), newDelayValue);
    event.sender.send('sendTimeRemaining');
});

ipcMain.handle('fetch-apps', async () => {
    const apps = await getInstalledApps();
    return apps.map(a => ({
        name: a.appName,
        id: a.appIdentifier,
        icon: a.icon || null
    }));
});

ipcMain.on('close-both', () => {
    killControlPanel();
    if (overlayWindow) {
        overlayWindow.close();
        overlayWindow = null;
    }
});

ipcMain.on('close-timer', (event, id) => removeTimer(id));

ipcMain.on('cancel-delay-change', (event, {settingId}) => {
    if(!activeTimers || !activeTimers.keys().find(key => key === settingId)){
        return;
    }
    const value = activeTimers.get(settingId);
    if(!value || !value.intervalId){
        return;
    }
    clearInterval(value.intervalId);
    activeTimers.delete(settingId);
});

ipcMain.on('show-delay-accountability-dialog', (event, id) => void showDelayAccountabilityDialogOrProgressDialog(id));

ipcMain.on('flagWithOverlay', (event, { displayName, processName }) => flagAppWithOverlay(displayName, processName));

function closeDelayAccountabilityDialog(){
    if (delayAccountDialog && !delayAccountDialog.isDestroyed()) {
        delayAccountDialog.close();
        delayAccountDialog = null;
    }
}

const getDurationValue = (id) => {
    const timer = activeTimers.get(id);
    if (!timer) {
        return null;
    }
    const remaining = timer.endTime - Date.now();
    return remaining > 0 ? remaining : 0;
};

async function showDelayAccountabilityDialogOrProgressDialog(settingId) {
    delayAccountDialog = new BrowserWindow({
        width: 420,
        height: 300,
        modal: true,
        parent: BrowserWindow.getFocusedWindow(),
        show: false,
        resizable: true,
        minimizable: false,
        maximizable: true,
        frame: true,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    const remainingTime = getDurationValue(settingId);
    if(remainingTime === null){
        void delayAccountDialog.loadFile(path.join(__dirname, 'confirmModal.html'));
    }
    else{
        void delayAccountDialog.loadFile(path.join(__dirname, 'progressBarForDelayChanges.html'));
    }

    delayAccountDialog.once('ready-to-show', () => {
        delayAccountDialog.show();

        console.log("remainingTime:", remainingTime);
        delayAccountDialog.webContents.send('init-delay-modal', {
            id: settingId,
            durationSeconds: remainingTime
        });
    });

    delayAccountDialog.setMenu(null);

    delayAccountDialog.webContents.openDevTools();
}

timerEvents.on('expired', (settingId) => turnOffSetting(settingId));

dnsSuccessfullySetEvent.on('dnsSuccessfullySet', () => refreshMainConfig());

blockProtectionEmitter.on('flagAppWithOverlay', ({displayName, processName}) => {
    flagAppWithOverlay(displayName, processName);
});
