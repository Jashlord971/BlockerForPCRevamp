const {app, BrowserWindow, Menu, ipcMain, dialog}  = require('electron');
const path = require("path");
const {exec} = require("child_process");
const {Service} = require("node-windows");

function getAssetPath(fileName) {
    return path.join(__dirname, fileName);
}

function getHtmlPath(fileName) {
    console.log(__dirname);
    return path.join(__dirname, fileName);
}

function getDataPath() {
    const dataPath = path.join(app.getPath('userData'), 'data');
    if (!fs.existsSync(dataPath)) {
        fs.mkdirSync(dataPath, { recursive: true });
    }
    return dataPath;
}

const {getPreference} = require(getAssetPath("store.js"));
const {getInstalledAppInfo} = require(getAssetPath("installedApps.js"));
const {enforceSafeSearch, isSafeSearchEnforced} = require(getAssetPath("safeSearchEnforcer.js"));
const {startCountdownTimer, timerEvents, reactivateTimers} = require(getAssetPath("timeHandler.js"));
const {getInstalledApps} = require("get-installed-apps");
const {closeApp, appBlockProtection, settingsProtectionOn, blockProtectionEmitter} = require(getAssetPath("blockProtection.js"));
const {configureSafeDNS, getActiveInterfaceName, isSafeDNS, dnsSuccessfullySetEvent} = require(getAssetPath("dnsProtection.js"));
const {addWebsiteToHostsFile} = require(getAssetPath("blockDomain.js"));
const {savePreference, checkSavedPreferences} = require(getAssetPath("store.js"));
const fs = require("fs");

let mainWindow = null;
const activeTimers = new Map();
let overlayWindow = null;
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

    mainWindow.loadFile(getHtmlPath('mainConfig.html')).then(() => {
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
    void mainWindow.loadFile(getHtmlPath('blockTableForWebsites.html'));
}

async function openDelaySettingDialogBox() {
    mainWindow.backgroundColor = '#0047ab';
    mainWindow.webPreferences = {
        ...mainWindow.webPreferences,
        nodeIntegration: false,
        preload: getAssetPath('preload.js')
    };

    mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.openDevTools();
        const delayStatus = getDelayChangeStatus();
        mainWindow.webContents.send('delayTimeout', delayStatus);
    });

    await mainWindow.loadFile(getHtmlPath('delaySettingModal.html'));
    mainWindow.webContents.openDevTools();
}

async function openBlockWindowForApps(){
    mainWindow.webPreferences = {
        ...mainWindow.webPreferences,
        nodeIntegration: false,
        preload: 'src/preload.js'
    }

    await mainWindow.loadFile(getHtmlPath('blockTableForApps.html'));
}

async function openMainConfig(){
    mainWindow.backgroundColor = '#0047ab';
    mainWindow.webPreferences = {
        ...mainWindow.webPreferences,
        nodeIntegration: true,
        contextIsolation: false,
        preload: getAssetPath('preload.js')
    };

    mainWindow.webContents.once('did-finish-load', () => {
        mainWindow.webContents.openDevTools();
        const delayStatus = getDelayChangeStatus();
        mainWindow.webContents.send('delayTimeout', delayStatus);
    });

    await mainWindow.loadFile(getHtmlPath('mainConfig.html')).then(() => {
        const customMenu = Menu.buildFromTemplate(getMenuTemplate());
        Menu.setApplicationMenu(customMenu);
    });
}

const getDelayTimeOut = () => {
    const preferencesPath = path.join(getDataPath(), 'savedPreferences.json');
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

ipcMain.handle('check-dns-safety', async () => {
    const value = await isDnsMadeSafe();
    console.log("dnsSafety:", value);
    return value;
});

function refreshMainConfig(){
    if(mainWindow && mainWindow.webContents){
        mainWindow.webContents.send('refreshMainConfig');
    }
}

function installMyService() {
    const electronAppPath = process.execPath;
    const electronAppName = path.basename(electronAppPath, '.exe');

    const svc = new Service({
        name: 'ElectronAppMonitor',
        description: 'Monitors the availability of your Electron application.',
        script: path.join(__dirname, 'monitor-service.js'), // Point to this script itself
        nodeOptions: [
            '--harmony',
            '--max_old_space_size=4096'
        ]
    });

    svc.on('install', function() {
        svc.start();
        console.log('Service installed and started.');
    });

    svc.on('uninstall', function() {
        console.log('Service uninstalled.');
    });

    svc.on('start', function() {
        console.log('ElectronAppMonitor service started.');
        setInterval(() => {
            exec(`tasklist /FI "IMAGENAME eq ${electronAppName}"`, (error, stdout, stderr) => {
                if (stdout.includes(electronAppName)) {
                    console.log(`${electronAppName} is running.`);
                } else {
                    console.warn(`${electronAppName} is not running. Attempting to restart.`);
                    exec(`start "" "${path.join(electronAppPath, electronAppName)}"`, (err) => {
                        if (err) {
                            console.error(`Failed to restart ${electronAppName}: ${err.message}`);
                        } else {
                            console.log(`${electronAppName} restarted.`);
                        }
                    });
                }
            });
        }, 5000);
    });

    svc.install();
}


app.whenReady().then(async () => {
    console.log("dirName:", __dirname);
    settingsProtectionOn();
    appBlockProtection();

    if(!isSafeSearchEnforced()){
        savePreference("enforceSafeSearch", false);
    }

    createWindow();

    setTimeout(async () => {
        const value = await isDnsMadeSafe();
        console.log("dnsSafety1 after delay:", value);
        if(!value){
            savePreference("enableProtectiveDNS", false);
            refreshMainConfig();
        }
        reactivateTimers();
    }, 4000);

    //installMyService();
});

const closeDNSConfirmationWindow = () => {
    if (dnsConfirmationModal && !dnsConfirmationModal.isDestroyed()) {
        dnsConfirmationModal.close();
        dnsConfirmationModal = null;
    }
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

    void dnsConfirmationModal.loadFile(getHtmlPath('dnsConfirmationModal.html'));
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

    void overlayWindow.loadFile(getHtmlPath('overlayWindow.html'));

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

ipcMain.on('prime-block-for-deletion', (event, id) => {
    startCountdownTimer(activeTimers, id, getDelayTimeOut(), null);
});

ipcMain.on('renderTableCall', (event) => {
    event.sender.send('listeningForRenderTableCall');
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
        void delayAccountDialog.loadFile(getHtmlPath('confirmModal.html'));
    }
    else{
        void delayAccountDialog.loadFile(getHtmlPath('progressBarForDelayChanges.html'));
    }

    delayAccountDialog.once('ready-to-show', () => {
        delayAccountDialog.show();
        delayAccountDialog.webContents.send('init-delay-modal', {
            id: settingId,
            durationSeconds: remainingTime
        });
    });

    delayAccountDialog.setMenu(null);

    delayAccountDialog.webContents.openDevTools();
}

timerEvents.on('expired', (settingId) => turnOffSetting(settingId));

timerEvents.on('renderTableCall', (event) => {
    event.sender.send('listeningForRenderTableCall');
});

dnsSuccessfullySetEvent.on('dnsSuccessfullySet', () => refreshMainConfig());

blockProtectionEmitter.on('flagAppWithOverlay', ({displayName, processName}) => {
    flagAppWithOverlay(displayName, processName);
});

ipcMain.handle('get-user-data-path', () => {
    return path.join(app.getPath('userData'), 'data');
});