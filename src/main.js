const {app, BrowserWindow, Menu, ipcMain, dialog}  = require('electron');
const path = require("path");
const {exec} = require("child_process");
const util = require('util');
const execPromise = util.promisify(exec);
const {getInstalledApps}  = require("get-installed-apps");
const fs = require("fs");
const fsp = require("fs").promises;
const sudoPrompt = require("sudo-prompt");
const _ = require("lodash");
const AutoLaunch = require('auto-launch');

let mainWindow = null;
let activeTimers = new Map();
let overlayWindow = null;
let dnsConfirmationModal = null;
let delayAccountDialog = null;
let flag = false;
let overlayQueue = [];

const gotTheLock = app.requestSingleInstanceLock();
const basePath = !app.isPackaged ? path.join(__dirname, 'data') : path.join(app.getPath('userData'), 'data');

const HOSTS_PATH = 'C:\\Windows\\System32\\drivers\\etc\\hosts';

function getAssetPath(fileName) {
    return path.join(__dirname, fileName);
}

function getHtmlPath(fileName) {
    return path.join(__dirname, fileName);
}

function getDataPath(fileName) {
    if (!fs.existsSync(basePath)) {
        fs.mkdirSync(basePath, { recursive: true });
    }
    return path.join(basePath, fileName);
}

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

    mainWindow.loadFile(getHtmlPath('mainConfig.html')).then(() => {
        const customMenu = Menu.buildFromTemplate(getMenuTemplate());
        Menu.setApplicationMenu(customMenu);
    });

    if(flag){
        makeWindowNotClosable(mainWindow);
    }
}

async function checkSavedPreferences(id){
    const filename = 'savedPreferences.json';
    const data = await readData(filename);
    return data && data[id];
}

function makeWindowNotClosable(window){
    if(window){
        window.on('close', (e) => {
            checkSavedPreferences("appUninstallationProtection")
                .then(isAppUninstallationProtectionEnabled => {
                    if(!isAppUninstallationProtectionEnabled){
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
    void mainWindow.loadFile(getHtmlPath('blockTableForWebsites.html'));
}

async function openDelaySettingDialogBox() {
    if(!mainWindow){
        return;
    }
    mainWindow.backgroundColor = '#0047ab';
    mainWindow.webPreferences = {
        ...mainWindow.webPreferences,
        nodeIntegration: false,
        preload: getAssetPath('preload.js')
    };

    await mainWindow.loadFile(getHtmlPath('delaySettingModal.html'));
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
        getDelayChangeStatus()
            .then(delayStatus =>  mainWindow.webContents.send('delayTimeout', delayStatus));
    });

    await mainWindow.loadFile(getHtmlPath('mainConfig.html')).then(() => {
        const customMenu = Menu.buildFromTemplate(getMenuTemplate());
        Menu.setApplicationMenu(customMenu);
    });
}

const getDelayTimeOut = async () => {
    const filename = 'savedPreferences.json';
    const preferences = await readData(filename);
    const value = preferences.delayTimeout;
    if(!value){
        return 3*60*1000;
    }
    return value;
}

function getDelayChangeStatus() {
    const delayTimeoutId = "delayTimeout";
    return getDelayTimeOut()
        .then(currentTimeout => {
            const timerInfo = activeTimers.get(delayTimeoutId);
            if (timerInfo) {
                const now = Date.now();
                const timeRemaining = Math.max(timerInfo.endTime - now, 0);
                const attribute = "newDelayValue";

                return {
                    currentTimeout,
                    isChanging: true,
                    timeRemaining,
                    newValue: timerInfo[attribute]
                };
            }

            return {
                currentTimeout,
                isChanging: false
            };
        })
        .catch(error => {
            console.log("Encountered an error while getting the delayChangeStatus");
            console.log(error);
        });
}


async function isDnsMadeSafe(){
    const interfaceName = await getActiveInterfaceName();
    return isSafeDNS(interfaceName);
}

ipcMain.handle('check-dns-safety', async () => await isDnsMadeSafe());

function refreshMainConfig(){
    if(mainWindow && mainWindow.webContents){
        mainWindow.webContents.send('refreshMainConfig');
    }
}

function savePreference(id, value){
    const filename = 'savedPreferences.json';
    return readData(filename)
        .then(preferences => {
            preferences[id] = value;
            return writeData(preferences, filename)
                .then(() => console.log("successfully updated preferences"))
                .catch(error => console.log(error));
        })
        .catch(error => {
            console.log("Encountered error when saving preferences");
            console.log(error);
        });
}

function autoLaunchApp(){
    const autoLaunch = new AutoLaunch({
        name: 'EagleBlocker',
        path: app.getPath('exe'),
    });

    autoLaunch.isEnabled().then((isEnabled) => {
        if (!isEnabled) autoLaunch.enable();
    });
}

function isTaskManagerOpen(callback) {
    exec('tasklist /FI "IMAGENAME eq Taskmgr.exe"', (err, stdout) => {
        if (err) {
            console.error("❌ Failed to check Task Manager:", err);
            return callback(false);
        }

        console.log(stdout);
        const isRunning = stdout.toLowerCase().includes("taskmgr.exe");
        callback(isRunning);
    });
}

app.whenReady().then(async () => {
    if(!gotTheLock){
        app.quit();
        return false;
    }

    isSafeSearchEnforced()
        .then(isSafeSearchEnforcedLocally => {
            if(!isSafeSearchEnforcedLocally){
                savePreference("enforceSafeSearch", false);
            }
        })
        .catch(error => {
            console.log("Encountered error while checking if we have enforced safe search locally");
            console.log(error);
        });

    createWindow();

    setTimeout(async () => {
        const value = await isDnsMadeSafe();
        if(!value){
            savePreference("enableProtectiveDNS", false)
                .then(() => refreshMainConfig())
                .catch(error => console.log(error));
        }
    }, 4000);

    //installMyService();
    settingsProtectionOn();
    appBlockProtection();

    autoLaunchApp();

    void createEagleTaskScheduleSimple();
    void reactivateTimers(activeTimers);
});

function createEagleTaskScheduleSimple() {
    return new Promise((resolve, reject) => {
        const taskName = "Eagle Task Schedule";
        const appPath = "C:\\Program Files\\Eagle Blocker\\Eagle Blocker.exe";
        const command = `schtasks /create /f /sc minute /mo 5 /tn "${taskName}" /tr "\\"${appPath}\\""`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error("Error creating scheduled task:", stderr || error.message);
                reject(error);
                return;
            }
            console.log("Eagle Task Schedule created successfully:", stdout);
            resolve(stdout);
        });
    });
}

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

async function canFlagNow(){
    const blockData = await readData("savedPreferences.json") || {};
    const timerInfo = blockData.timerInfo || {};
    const lastManualOverrideTimestamp = _.get(timerInfo, 'lastManualChangeTimestamp', undefined);
    if(!lastManualOverrideTimestamp){
        return true;
    }
    return Date.now() - lastManualOverrideTimestamp >= 30000;
}

function createOverlayAndPassInfo(appInfo){
    createOverlayWindow();
    overlayWindow.webContents.once('did-finish-load', () => {
        const serializableAppInfo = {
            displayName: appInfo.displayName || '',
            processName: appInfo.processName || '',
            isManualOverrideAllowed: appInfo.isManualOverrideAllowed || false
        };
        overlayWindow?.webContents?.send('app-info', serializableAppInfo);
    });
}

async function flagAppWithOverlay(displayName, processName) {
    const isManualOverrideAllowed = await canAllowManualClosure();
    const appInfo = { displayName, processName, isManualOverrideAllowed };

    if (overlayWindow) {
        overlayQueue.push(appInfo);
    } else {
        const canWeFlagNow = await canFlagNow();
        if(canWeFlagNow){
            console.log(appInfo);
            createOverlayAndPassInfo(appInfo);
        }
        else{
            setTimeout(() => createOverlayAndPassInfo(appInfo), 30000);
        }
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
}

async function canAllowManualClosure() {
    const blockData = await readData("savedPreferences.json");
    const timerInfo = blockData?.timerInfo || {};
    const lastManualChange = _.get(timerInfo, "lastManualChangeTimestamp", undefined);

    if (!lastManualChange) {
        return true;
    }

    const eightHours = 8 * 60 * 60 * 1000;
    return (Date.now() - lastManualChange) >= eightHours;
}

async function setLastManualChangeTimestamp(){
    const filename = "savedPreferences.json";
    readData(filename)
        .then(blockData => {
            _.set(blockData, "timerInfo.lastManualChangeTimestamp", Date.now());
            writeData(blockData, filename);
        })
        .catch(() => console.log("Encountered error while setting the last manual change timestamp"));
}

function closeOverlayWindow() {
    if (overlayWindow) {
        overlayWindow.close();
        overlayWindow = null;

        if (overlayQueue.length > 0) {
            const nextAppInfo = overlayQueue.shift();
            void flagAppWithOverlay(nextAppInfo.displayName, nextAppInfo.processName);
        }
    }
}

function checkIfAppIsStillOpenAndSetOverlayWindowIfOpen(displayName, processName) {
    const baseName = processName.replace('.exe', '');

    exec(`powershell -Command "Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue"`, (err, stdout) => {
        if (err) {
            console.error(`Error checking process ${processName}:`, err);
            return;
        }

        if (stdout && stdout.trim().length > 0) {
            console.log(`⚠️ ${processName} is still open. Re-opening overlay...`);
            if (!overlayWindow) {
                void flagAppWithOverlay(displayName, processName);
            }
        } else {
            console.log(`✅ ${processName} has been closed manually.`);
            closeOverlayWindow();
        }
    });
}

ipcMain.on('close-app-and-overlay', (event, { displayName, processName }) => {
    closeApp(processName)
        .then(async (result) => {
            if(result){
                closeOverlayWindow();
                return;
            }

            const canAllowManualCloseNow = await canAllowManualClosure();
            if(canAllowManualCloseNow){
                setLastManualChangeTimestamp()
                    .then(() => {
                        closeOverlayWindow();
                        setTimeout(() => checkIfAppIsStillOpenAndSetOverlayWindowIfOpen(displayName, processName), 30000);
                    })
                    .catch(error => console.log(error));
            }
        });
});

ipcMain.on('closeOverlay', () => closeOverlayWindow());

ipcMain.on('close-delay-accountability-modal', () => closeDelayAccountabilityDialog());

ipcMain.on('confirm-delay-accountability', (event, settingId) => startCountdownTimer(activeTimers, settingId, null, null));

ipcMain.on('set-dns', () => {
    closeDNSConfirmationWindow();
    configureSafeDNS().then(() => savePreference("enableProtectiveDNS", true));
});

ipcMain.on('show-dns-dialog', () => showDNSConfirmationWindow());

ipcMain.on('enforce-safe-search', (event) => {
    enforceSafeSearch()
        .then(() => savePreference('enforceSafeSearch', true))
        .then(() => event.sender.send('refreshMainConfig'))
        .catch(error => console.log(error));
});

ipcMain.on('set-delay-timeout', (event, delayValue) => {
    const filename = 'savedPreferences.json';
    readData(filename).then(preferences => {
        preferences.delayTimeout = delayValue;
        void writeData(preferences, filename);
    });
});

ipcMain.on('start-delay-timeout-change', (event, newDelayValue) => {
    startCountdownTimer(activeTimers, "delayTimeout", getDelayTimeOut(), newDelayValue)
        .then(() => event.sender.send('sendTimeRemaining'));
});

ipcMain.on('prime-block-for-deletion', (event, id) => {
    void startCountdownTimer(activeTimers, id, getDelayTimeOut(), null);
});

ipcMain.on('renderTableCall', (event) => {
    event.sender.send('renderLatestTable');
});

ipcMain.handle('getDelayChangeStatus', async () => getDelayChangeStatus());

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

ipcMain.on('flagWithOverlay', async (event, { displayName, processName }) => void flagAppWithOverlay(displayName, processName));

ipcMain.on('turnOnAppProtection', () => appBlockProtection());

ipcMain.on('turnOnSettingsProtection', () => settingsProtectionOn());

ipcMain.on('closeTaskManager', () => {
    closeTaskManager()
        .then(() => closeOverlayWindow())
        .catch(() => console.log("Unable to kill task manager"))
});

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
}

async function readData(filename = "savedPreferences.json") {
    const defaultBlockData = {
        blockedApps: [],
        blockedWebsites: [],
        allowedForUnblockWebsites: [],
        allowedForUnblockApps: [],
    };

    const dataPath = getDataPath(filename);

    try {
        await fsp.access(dataPath);
    } catch {
        return defaultBlockData;
    }

    try {
        const raw = await fsp.readFile(dataPath, "utf8");
        const jsonString = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;
        return JSON.parse(jsonString);
    } catch (err) {
        console.error(`[readData] Failed to read or parse data from ${dataPath}:`, err);
        return defaultBlockData;
    }
}

async function getInstalledAppInfo(){
    const isUserApp = (app) => {
        if(app.hasOwnProperty("InstallLocation") &&app.hasOwnProperty("DisplayName") && app.hasOwnProperty("UninstallString")){
            const location = (app.InstallLocation ?? "").toLowerCase();
            return app.DisplayName && !location.includes('windows') && app.UninstallString;
        }
        return false;
    }

    const findExeInInstallLocation = async (installLocation) => {
        if (!installLocation) {
            return null;
        }
        return fsp.access(installLocation)
            .then(() => fsp.readdir(installLocation))
            .then(files => {
                if(_.isEmpty(files) || !_.isArray(files)){
                    return null;
                }
                return files.find(file => file && file.toLowerCase().endsWith('.exe'));
            })
            .catch(() => null);
    }

    const getMatchFromName = (str = "") => {
        const match = str.match(/\\([^\\]+\.exe)/i);
        return match ? match[1].toLowerCase() : null;
    }

    const tryExeFromIcon = async (iconPath) => {
        if (!iconPath || !iconPath.toLowerCase().endsWith('.ico')) {
            return null;
        }

        const exePath = iconPath.replace(/\.ico$/i, '.exe');
        return fsp.access(exePath)
            .then(() => path.basename(exePath))
            .catch(() => null);
    }

    const extractProcessName = async (displayIcon, uninstallString, installLocation) => {
        const matchFromDisplayIcon = getMatchFromName(displayIcon);
        if(matchFromDisplayIcon){
            return matchFromDisplayIcon;
        }

        const matchFromUnInstallString = getMatchFromName(uninstallString);
        if(matchFromUnInstallString){
            return matchFromUnInstallString;
        }

        return tryExeFromIcon(displayIcon)
            .then(exeFromIconLocation => {
                if(exeFromIconLocation){
                    return exeFromIconLocation;
                }
                return findExeInInstallLocation(installLocation);
            });
    }

    const apps = await getInstalledApps();

    const appPromises = apps
        .filter(app => isUserApp(app))
        .map(async app => {
            const processName = await extractProcessName(app['DisplayIcon'], app['UninstallString'], app['InstallLocation']);
            return {
                displayName: (app.hasOwnProperty("DisplayName") && app.DisplayName) ? app.DisplayName : app.appName,
                processName,
                iconPath: app['DisplayIcon'],
                installationPath: app['InstallLocation']
            }
        });

    return Promise.all(appPromises);
}

ipcMain.handle('getAllInstalledApps', async () => {
    const apps = await getInstalledAppInfo();
    if (!apps || apps.length === 0) {
        return [];
    }

    try {
        return apps.map(app => ({
            displayName: app.displayName,
            processName: app.processName
        }));
    } catch (error) {
        console.log("Error while getting installed apps", error);
        return [];
    }
});

ipcMain.handle('getBlockData', async () => readData('blockData.json'));

ipcMain.handle('getPreferences', async () => readData('savedPreferences.json'));

ipcMain.on('saveData', (event, args) => {
    const filename = args.fileName;
    writeData(args.data, filename)
        .then(() => console.log("Successfully saved data to file: " + filename))
        .catch(error => {
            console.log("Failed to save data to file: " + filename);
            console.log(error);
        });
});

ipcMain.on('isSafeSearchEnforced', async () => isSafeSearchEnforced());

function writeData(data, filename) {
    const dataPath = getDataPath(filename);

    return fsp.lstat(dataPath)
        .then(stat => {
            if (stat.isDirectory()) {
                return fsp.rm(dataPath, { recursive: true, force: true });
            }
        })
        .catch(() => {})
        .then(() => fsp.mkdir(path.dirname(dataPath), { recursive: true }))
        .then(() => fsp.writeFile(dataPath, JSON.stringify(data, null, 2), "utf-8"))
        .then(() => console.log(`[writeData] Saved data to ${dataPath}`))
        .catch(error => console.error(`[writeData] Failed to write:`, error));
}

async function reactivateTimers(activeTimers) {
    const filename = 'savedPreferences.json';
    const savedPreferencesData = await readData(filename);
    const data = savedPreferencesData.timerInfo || {};

    console.log("Here: " + data);

    Object.entries(data).forEach(([settingId, timer]) => {
        if (!timer || typeof timer !== "object" || !("delayTimeout" in timer)) {
            console.log(`⏭️ Skipping non-timer entry: ${settingId}`);
            return;
        }

        const elapsed = Date.now() - timer.startTimeStamp;
        const remaining = timer.delayTimeout - elapsed;

        if (remaining > 0) {
            console.log(`⏱️ Restarting timer "${settingId}" with ${remaining}ms remaining`);
            startCountdownTimer(activeTimers, settingId, remaining, timer.targetTimeout);
        } else {
            console.log("Handling expirations for setting with id: " + settingId);
            handleExpiration(settingId, timer.targetTimeout);
        }
    });
}

function renderTable() {
    if (!mainWindow) return;

    return mainWindow.webContents
        .executeJavaScript(`document.body.innerHTML`)
        .then(html => {
            if (html.includes("blockTableForApps") || html.includes("blockTableForWebsites")) {
                mainWindow.webContents.send('renderLatestTable');
            }
        })
        .catch(err => console.error("Error checking HTML content:", err));
}

function handleExpiration(settingId, targetTimeout){
    const delimiter = '-->';
    if(settingId === "delayTimeout"){
        void savePreference(settingId, targetTimeout);
    }
    else if(settingId.includes(delimiter)){
        const splits = settingId.split(delimiter);
        const key = splits[0];
        const item = splits[1];

        const keyInBlockData = (key === 'site') ? 'allowedForUnblockWebsites' : 'allowedForUnblockApps';
        readData('savedPreferences.json')
            .then(blockData => {
                if(!blockData.hasOwnProperty(keyInBlockData)){
                    blockData[keyInBlockData] = [];
                }

                blockData[keyInBlockData].push(item);
                renderTable();
            });
    }
    else{
        void savePreference(settingId, false);
    }
    turnOffSetting(settingId);
}

function startCountdownTimer(activeTimers, settingId, remainingTime, targetTimeout = null) {
    const filename = 'savedPreferences.json';

    if (!activeTimers) {
        activeTimers = new Map();
    }

    if (activeTimers.has(settingId)) {
        clearInterval(activeTimers.get(settingId).intervalId);
        activeTimers.delete(settingId);
    }

    return checkSavedPreferences("delayTimeout")
        .then((delayTimeout) => {
            const startTimeStamp = Date.now();

            const effectiveDelay = remainingTime || delayTimeout;
            const endTime = startTimeStamp + effectiveDelay;

            return readData(filename).then((mainData) => {
                if (!mainData.timerInfo) mainData.timerInfo = {};

                mainData.timerInfo[settingId] = {
                    delayTimeout: effectiveDelay,
                    startTimeStamp,
                    targetTimeout
                };

                return writeData(mainData, filename).then(() => {
                    const intervalId = setInterval(() => {
                        const now = Date.now();
                        const remaining = Math.max(endTime - now, 0);

                        if (remaining <= 0) {
                            clearInterval(intervalId);
                            activeTimers.delete(settingId);

                            delete mainData.timerInfo[settingId];

                            writeData(mainData, filename)
                                .then(() => {
                                    handleExpiration(settingId, targetTimeout);
                                    console.log(`⏹️ Timer expired for ${settingId}`);
                                });
                        } else {
                            console.log(`🔄 [${settingId}] ${remaining}ms left`);
                        }
                    }, 1000);

                    activeTimers.set(settingId, { intervalId, endTime });
                    console.log(`🟢 Started timer for ${settingId}`);
                });
            });
        })
        .catch((err) => console.error("❌ Failed to start timer:", err));
}

async function getActiveInterfaceName() {
    const { stdout } = await execPromise('netsh interface show interface');

    const lines = stdout.split('\n');
    for (const line of lines) {
        if (line.includes('Connected') && line.includes('Enabled')) {
            const parts = line.trim().split(/\s{2,}/);
            return parts[parts.length - 1];
        }
    }
    throw new Error('No active interface found.');
}

async function configureSafeDNS(isStrict) {
    const safifyDNS = (interfaceName, isStrict) => {
        const getPrimaryAndSecondaryDNS = (isStrict) => {
            if(isStrict){
                return ['185.228.168.168', '185.228.169.168'];
            }
            return ['208.67.222.123', '208.67.220.123']
        }

        const [primaryDNS, secondaryDNS] = getPrimaryAndSecondaryDNS(isStrict);

        const options = {
            name: 'SafeDNS Configurator'
        };

        const command = `netsh interface ipv4 set dns name="${interfaceName}" static ${primaryDNS} primary && netsh interface ipv4 add dns name="${interfaceName}" ${secondaryDNS} index=2`;

        try{
            sudoPrompt.exec(command, options, (error, stdout, stderr) => {
                if (error) {
                    console.error('Failed to set DNS:', error);
                    return;
                }
                if (stderr) {
                    console.error('stderr:', stderr);
                    return;
                }
                console.log('DNS set successfully:', stdout);
                savePreference( "enableProtectiveDNS", true);
                refreshMainConfig();
            });
        } catch (e){
            console.log("user likely didnt grant permission");
        }
    }

    try {
        getActiveInterfaceName()
            .then((interfaceName) => safifyDNS(interfaceName, isStrict))
            .catch((error) => {
                console.log("Error while getting active interface name", error);
            });
    } catch (err) {
        console.error('Failed to configure DNS:', err.message);
    }
}

async function isSafeDNS(interfaceName) {
    try {
        const { stdout } = await exec(`netsh interface ipv4 show dnsservers name="${interfaceName}"`);
        return stdout.some(entry => {
            const stringedEntry = JSON.stringify(entry);
            return (stringedEntry.includes('185.228.168.168') && stringedEntry.includes('185.228.169.168')) ||
                (stringedEntry.includes('208.67.222.123') && stringedEntry.includes('208.67.220.123'))
        });
    } catch (err) {
        console.error('Failed to read DNS settings:', err);
        return [];
    }
}

const processCache = {
    data: new Map(),
    lastUpdate: 0,
    cacheTimeout: 3000
};

const getAllProcessInfo = () => {
    return new Promise((resolve) => {
        const now = Date.now();

        if (now - processCache.lastUpdate < processCache.cacheTimeout) {
            return resolve(processCache.data);
        }

        const psCommand = `
            $processes = Get-Process | Where-Object { 
                $_.ProcessName -or $_.MainWindowTitle 
            } | Select-Object ProcessName, MainWindowTitle, Id;
            
            $result = @{
                processes = $processes;
                controlPanel = ($processes | Where-Object { $_.MainWindowTitle -match 'Control Panel' }).Count -gt 0;
                notepadHosts = ($processes | Where-Object { 
                    $_.ProcessName -eq 'notepad' -and $_.MainWindowTitle -like '*hosts*' 
                }).Count -gt 0
            };
            
            $result | ConvertTo-Json -Depth 3
        `;

        exec(`powershell -Command "${psCommand.replace(/\s+/g, ' ')}"`, (err, stdout) => {
            if (err) {
                console.error('Process query error:', err);
                return resolve(processCache.data);
            }

            try {
                const result = JSON.parse(stdout);
                const processMap = new Map();

                const processes = result['processes'];
                if (processes) {
                    processes.forEach(proc => {
                        const key = proc["ProcessName"]?.toLowerCase();
                        if (key) {
                            processMap.set(key, {
                                processName: proc["ProcessName"],
                                windowTitle: proc['MainWindowTitle'] || '',
                                id: proc['Id']
                            });
                        }
                    });
                }

                processMap.set('_meta', {
                    controlPanelOpen: result['controlPanel'],
                    notepadHostsOpen: result['notepadHosts']
                });

                processCache.data = processMap;
                processCache.lastUpdate = now;
                resolve(processMap);
            } catch (parseErr) {
                console.error('Parse error:', parseErr);
                resolve(processCache.data);
            }
        });
    });
};

function appBlockProtection() {
    let monitoringInterval = null;
    const activeOverlays = new Set();

    const getBlockedAppsList = async () => {
        const blockData = await readData('blockData.json');
        const blockedLists = blockData ? blockData.blockedApps : [];
        return blockedLists || [];
    };

    const checkBlockedApps = async () => {
        return getAllProcessInfo()
            .then(processMap => {
                getBlockedAppsList()
                    .then(blockedApps => {
                        blockedApps.forEach(app => {
                            const processNameBase = app.processName.replace('.exe', '').toLowerCase();
                            const displayName = app.displayName;
                            const processInfo = processMap.get(processNameBase);

                            let isRunning = false;

                            if (processInfo) {
                                isRunning = true;
                            } else {
                                for (const [key, proc] of processMap) {
                                    if (key !== '_meta' && proc.windowTitle &&
                                        proc.windowTitle.toLowerCase().includes(displayName.toLowerCase())) {
                                        isRunning = true;
                                        break;
                                    }
                                }
                            }

                            if (isRunning) {
                                if (!activeOverlays.has(app.processName)) {
                                    console.log(`⚠️ Blocked app ${displayName} is running.`);
                                    flagAppWithOverlay(displayName, app.processName);
                                    activeOverlays.add(app.processName);
                                }
                            } else {
                                activeOverlays.delete(app.processName);
                            }
                        });
                    })
                    .catch(error => {
                        console.log("Error encountered while getting list of blocked apps");
                        console.log(error);
                    });
            });
    };

    const monitorBlockedApps = () => {
        if (monitoringInterval) return;

        monitoringInterval = setInterval( () => {
            checkSavedPreferences("overlayRestrictedContent")
                .then(isAppBlockingEnabled => {
                    if(isAppBlockingEnabled){
                        void checkBlockedApps();
                    } else{
                        clearInterval(monitoringInterval);
                        monitoringInterval = null;
                        activeOverlays.clear();
                    }
                })
                .catch(() => console.log("Error encountered while checking saved preferences"));
        }, 8000);
    };

    const mainCall = () => {
        checkSavedPreferences("overlayRestrictedContent")
            .then(isAppBlockingEnabled => {
                if(!isAppBlockingEnabled){
                    return;
                }

                checkBlockedApps()
                    .then(() => monitorBlockedApps())
                    .then(() => {
                        isTaskManagerOpen((running) => {
                            if (running) {
                                console.log("⚠️ Task Manager is OPEN!");
                                void flagAppWithOverlay("Task Manager", 'Taskmgr.exe');
                            } else {
                                console.log("✅ Task Manager is CLOSED.");
                            }
                        });
                    })
                    .catch(error => {
                        console.log("Encountered error while checking and blocking disallowed apps");
                        console.log(error);
                    });
            });
    };

    void mainCall();
}

function closeApp(processName) {
    const baseName = processName.replace('.exe', '');

    const closeCmd = `
        $proc = Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue;
        if ($proc) {
            $sig = '[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);';
            $type = Add-Type -MemberDefinition $sig -Name NativeMethods -Namespace Win32 -PassThru;
            $proc | ForEach-Object { $type::PostMessage($_.MainWindowHandle, 0x0010, 0, 0) };
            Start-Sleep -Seconds 2;
            $stillRunning = Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue;
            if ($stillRunning) {
                Stop-Process -Name '${baseName}' -Force -ErrorAction SilentlyContinue;
            }
        }
    `.replace(/\s+/g, ' ');

    return new Promise((resolve) => {
        let finished = false;

        exec(`powershell -Command "${closeCmd}"`, (err) => {
            if (err) {
                console.error(`❌ Failed to issue close for ${processName}:`, err);
            } else {
                console.log(`✅ Close attempt issued for ${processName}`);
            }
        });

        const start = Date.now();
        const interval = setInterval(() => {
            exec(`powershell -Command "Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue"`, (checkErr, stdout) => {
                if (finished) return;

                if (!stdout || stdout.trim().length === 0) {
                    finished = true;
                    clearInterval(interval);
                    console.log(`🎉 ${processName} successfully closed`);
                    return resolve(true);
                }

                if (Date.now() - start >= 60000) {
                    finished = true;
                    clearInterval(interval);
                    console.warn(`⚠️ ${processName} is still running after 60s`);
                    return resolve(false);
                }
            });
        }, 5000);
    });
}

function monitorApp(command) {
    return new Promise((resolve) => {
        exec(command, (err, stdout) => {
            if (!err && stdout.trim().length > 0) {
                return resolve(true);
            }
            return resolve(false);
        });
    });
}

function settingsProtectionOn() {
    const monitorSettings = () => {
        const hostMonitoringCommand = `powershell -Command "Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match 'hosts' }"`;
        const controlPanelMonitorCommand =  `powershell -Command "Get-Process | Where-Object { $_.MainWindowTitle -match 'Control Panel' }"`;
        return monitorApp(hostMonitoringCommand)
            .then(isHostsFileFlagged => {
                if(isHostsFileFlagged){
                    void flagAppWithOverlay("Notepad (hosts file)", "notepad.exe");
                    return Promise.reject("break");
                }
                return monitorApp(controlPanelMonitorCommand);
            })
            .then(isControlPanelOpen => {
                if(isControlPanelOpen){
                    void flagAppWithOverlay("Control Panel", "control.exe");
                    return Promise.reject("break");
                }
            })
            .catch(error => {
                if(error === "break"){
                    return;
                }
                console.error("Error monitoring settings:", error);
            });
    }

    checkSavedPreferences("blockSettingsSwitch")
        .then(isSettingsBlockOn => {
            if(!isSettingsBlockOn){
                return;
            }
            const settingsInterval = setInterval(monitorSettings, 12000);

            void monitorSettings();
            appBlockProtection();

            return settingsInterval;
        })
        .catch(error => {
            console.log("Encountered error while enforcing settings protection");
            console.log(error);
        });
}

async function enforceSafeSearch() {
    const entries = [
        '216.239.38.120 www.google.com',
        '216.239.38.120 google.com',
        '204.79.197.220 bing.com',
        '204.79.197.220 www.bing.com',
        '213.180.193.56 yandex.ru',
        '213.180.204.92 www.yandex.com',
        '127.0.0.1 yandex.com/images'
    ];

    const lines = entries.map(e => e.trim());

    const script = `
        const fs = require('fs');
        const os = require('os');
        const path = "${HOSTS_PATH.replace(/\\/g, '\\\\')}";
        const lines = ${JSON.stringify(lines)};
        let content = fs.readFileSync(path, 'utf8');
        lines.forEach(line => {
            if (!content.includes(line)) content += os.EOL + line;
        });
        fs.writeFileSync(path, content, 'utf8');
        console.log("✅ Added lines: " + lines.join(', '));
    `.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n\s+/g, ' ');

    return new Promise((resolve) => {
        sudoPrompt.exec(`node -e "${script}"`, { name: 'Website Blocker' }, (error, stdout, stderr) => {
            if (error) {
                console.error("❌ Failed to write to hosts file:", error.message || stderr);
                resolve(false);
                return;
            }
            console.log(stdout.trim());
            resolve(true);
        });
    });
}

function isSafeSearchEnforced() {
    const requiredEntries = [
        '216.239.38.120 www.google.com',
        '216.239.38.120 google.com',
        '204.79.197.220 bing.com',
        '204.79.197.220 www.bing.com',
        '213.180.193.56 yandex.ru',
        '213.180.204.92 www.yandex.com',
        '127.0.0.1 yandex.com/images'
    ];

    return fsp.readFile(HOSTS_PATH, 'utf8')
        .then(content => requiredEntries.every(entry => content.includes(entry)))
        .catch(error => {
            console.error('❌ Error reading hosts file:', error.message);
            return false;
        });
}

function closeTaskManager() {
    return new Promise((resolve) => {
        exec('taskkill /IM Taskmgr.exe /F', (err) => {
            if (err) {
                console.error('Failed to close Task Manager:', err);
                resolve(false);
            } else {
                console.log('Task Manager closed successfully');
                resolve(true);
            }
        });
    });
}