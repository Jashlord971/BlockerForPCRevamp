const {app, BrowserWindow, Menu, ipcMain, dialog}  = require('electron');
const path = require("path");
const {exec} = require("child_process");
const util = require('util');
const execPromise = util.promisify(exec);
const {getInstalledApps}  = require("get-installed-apps");
const fs = require('fs');
const fsp = require("fs").promises;
const sudoPrompt = require("sudo-prompt");
const _ = require("lodash");
const { Worker } = require('worker_threads');
const AutoLaunch = require('auto-launch');

let cachedApps = null;
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000;

let mainWindow = null;
let blockData = {};
let preferences = {};

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

function ensureDataDirectory() {
    return fsp.access(basePath)
        .catch(() => fsp.mkdir(basePath, { recursive: true }));
}

function checkSavedPreferences(id) {
    const filename = 'savedPreferences.json';
    return readData(filename)
        .then(data => data && data[id])
        .catch(error => {
            console.error("Encountered given error while trying to retrieve saved preferences: " , error);
            return false;
        });
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
                    click: () => windowManager.openWindow('blockWebsites', 'blockTableForWebsites.html')
                },
                {
                    label: 'Block Apps',
                    click: () => windowManager.openWindow('blockApps', 'blockTableForApps.html')
                }
            ]
        },
        {
            label: 'Settings',
            click: () => {
                windowManager.openWindow('settings', 'delaySettingModal.html')
            }
        }
    ];
}

const windowManager = {
    windows: new Map(),

    openWindow(windowId, htmlFileName, options = {}) {
        const existingWindow = this.windows.get(windowId);
        if (existingWindow && !existingWindow.isDestroyed()) {
            existingWindow.focus();
            return existingWindow;
        }

        const defaultOptions = {
            width: 600,
            height: 800,
            modal: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        };

        const newWindow = new BrowserWindow({ ...defaultOptions, ...options });

        newWindow.loadFile(getHtmlPath(htmlFileName))
            .then(() => console.log(`Successfully loaded the ${htmlFileName} window`))
            .catch(error => {
                console.log(`Encountered error while loading the ${htmlFileName} window`);
                console.log(error);
            });

        newWindow.on('closed', () => {
            this.windows.delete(windowId);
        });

        if (options.maximize !== false) {
            newWindow.maximize();
        }

        this.windows.set(windowId, newWindow);
        return newWindow;
    }
};

function openMainConfig() {
    if (mainWindow) {
        mainWindow.focus();
        return Promise.resolve(false);
    }

    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false
        },
        backgroundColor: '#0047ab'
    });

    if (flag) {
        makeWindowNotClosable(mainWindow);
    }

    let mainConfigRetries = 0;
    const MAX_RETRIES = 3;
    mainWindow.maximize();

    const tryLoad = () => {
        return mainWindow.loadFile(getHtmlPath('mainConfig.html'))
            .then(() => {
                const customMenu = Menu.buildFromTemplate(getMenuTemplate());
                Menu.setApplicationMenu(customMenu);
            })
            .then(() => {
                mainWindow.webContents.once('did-finish-load', () => {
                    getDelayChangeStatus()
                        .then(delayStatus => mainWindow.webContents.send('delayTimeout', delayStatus))
                        .catch(error => {
                            console.log("Encountered error while getting the delayStatus value, returning default status");
                            console.error(error);
                            mainWindow.webContents.send('delayTimeout', {});
                        });
                });
                mainWindow.webContents.openDevTools();
            })
            .catch(error => {
                console.error(`Failed to load mainConfig.html (attempt ${mainConfigRetries + 1}/${MAX_RETRIES})`, error);

                if (++mainConfigRetries < MAX_RETRIES) {
                    console.log("Retrying...");
                    return tryLoad();
                } else {
                    console.error("Max retries reached. Could not load mainConfig.html");
                    throw error;
                }
            });
    };

    return tryLoad();
}

const getDelayTimeOut = () => {
    const filename = 'savedPreferences.json';
    const defaultTimeout = 3 * 60 * 1000;
    return readData(filename)
        .then(preferences => preferences['delayTimeout'] ?? defaultTimeout)
        .catch(error => {
            console.log("Encountered error while getting the delay timeout value. Returning default value");
            console.log(error);
            return defaultTimeout;
        });
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

function isDnsMadeSafe(){
    return getActiveInterfaceName()
        .then(interfaceName => isSafeDNS(interfaceName))
        .catch(error => {
            console.log("Encountered error while getting to know if dns is made safe");
            console.log(error);
            return false;
        });
}

ipcMain.handle('check-dns-safety', async () => isDnsMadeSafe());

ipcMain.handle('activateSettingsProtection', async () => settingsProtectionOn());

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
                .then(() => console.log("successfully updated preferences for: ", id + " with value:", value))
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

function isTaskManagerOpen() {
    return execPromise('tasklist /FI "IMAGENAME eq Taskmgr.exe"')
        .then(({ stdout }) => stdout && stdout.toLowerCase().includes("taskmgr.exe"))
        .catch(error => {
            console.error('Error checking Task Manager:', error);
            return false;
        });
}

function getDataPath(filename){
    return path.join(basePath, filename);
}

app.whenReady().then(async() => {
    if(!gotTheLock){
        app.quit();
        return false;
    }

    fs.readFile(getDataPath('blockData.json'), 'utf8', (err, data) => {
        if (err) {
            console.error('Error:', err);
            blockData = {};
        } else {
            blockData = JSON.parse(data);
        }
    });

    fs.readFile(getDataPath('savedPreferences.json'), 'utf8', (err, data) => {
        if (err) {
            console.error('Error:', err);
            preferences = {};
        } else {
            preferences = JSON.parse(data);
        }
    });

    return ensureDataDirectory()
        .then(() => {
            openMainConfig()
                .then(() => executeOpeningActions())
                .catch(error => console.error("Encountered error while opening app: ", error));
        })
        .catch(error => console.log("Encountered error while ensuring data directory was set: ", error));
});

function executeOpeningActions(){
    isSafeSearchEnforced()
        .then(isSafeSearchEnforcedLocally => {
            if(!isSafeSearchEnforcedLocally){
                void savePreference("enforceSafeSearch", false);
            }
        })
        .catch(error => {
            console.log("Encountered error while checking if we have enforced safe search locally");
            console.log(error);
        });

    isDnsMadeSafe()
        .then(value => {
            if(!value){
                savePreference("enableProtectiveDNS", false)
                    .then(() => refreshMainConfig())
                    .catch(error => console.log(error));
            }
        });

    settingsProtectionOn();
    appBlockProtection();

    autoLaunchApp();

    void createEagleTaskScheduleSimple();
    void reactivateTimers(activeTimers);
    void getInstalledAppInfo(true);
    isSettingsOpenedToAppsFeatures()
        .then(result => console.log("result:", result))
        .catch(error => {
            console.log("Encountered error while checking if settings is opened");
            console.log(error);
        });
}

function isSettingsOpenedToAppsFeatures() {
    const ps = `
            Get-CimInstance Win32_Process |
            Where-Object { $_.Name -eq "SystemSettings.exe" }
        `;

    return execPromise(`powershell -Command "${ps}"`)
        .then(({err, stdout}) => !err && stdout && stdout.trim().length > 0)
        .catch(error => {
            console.log("Encountered an error while checking if the settings and app features has been opened: ", error);
            return false;
        });
}

function createEagleTaskScheduleSimple() {
    const taskName = "Eagle Task Schedule";
    const appPath = "C:\\Program Files\\Eagle Blocker\\Eagle Blocker.exe";
    const command = `schtasks /create /f /sc minute /mo 1 /tn "${taskName}" /tr "\\"${appPath}\\""`;

    return execPromise(command)
        .then(({error, stdout, stderr})=> {
            if (error) {
                console.error("Error creating scheduled task:", stderr || error.message);
                return false;
            }
            else{
                console.log("Eagle Task Schedule created successfully:", stdout);
                return true;
            }
        });
}

const closeDNSConfirmationWindow = () => {
    if (dnsConfirmationModal && !dnsConfirmationModal.isDestroyed()) {
        dnsConfirmationModal.close();
        dnsConfirmationModal = null;
    }
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
    return readData("savedPreferences.json")
        .then(blockData => {
            blockData = blockData ?? {};
            const timerInfo = blockData.timerInfo || {};
            const lastManualOverrideTimestamp = _.get(timerInfo, 'lastManualChangeTimestamp', undefined);
            if(!lastManualOverrideTimestamp){
                return true;
            }
            return Date.now() - lastManualOverrideTimestamp >= 30000;
        })
        .catch(error => {
            console.log("Encountered error while reading data to determine if we can flag a given instance: ", error);
            return true;
        });
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

function flagAppWithOverlay(displayName, processName) {
    return canAllowManualClosure()
        .then(isManualOverrideAllowed => {
            const appInfo = { displayName, processName, isManualOverrideAllowed };
            if (overlayWindow) {
                overlayQueue.push(appInfo);
            } else {
                canFlagNow()
                    .then(result => {
                        if(result){
                            console.log(appInfo);
                            createOverlayAndPassInfo(appInfo);
                        }
                        else{
                            setTimeout(() => createOverlayAndPassInfo(appInfo), 30000);
                        }
                    })
                    .catch(error => {
                        console.error("Encountered this error while trying to flag event with processName: ", processName);
                        console.log(error);
                    });
            }
        });
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
    return readData("savedPreferences.json")
        .then(blockData => {
            const timerInfo = blockData?.timerInfo || {};
            const lastManualChange = _.get(timerInfo, "lastManualChangeTimestamp", undefined);

            if (!lastManualChange) {
                return true;
            }

            const eightHours = 8 * 60 * 60 * 1000;
            return (Date.now() - lastManualChange) >= eightHours;
        })
        .catch(error => console.log("Encountered the given error while checking if we can allow manual closure: ", error));
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
            if(!nextAppInfo || !nextAppInfo.displayName || !nextAppInfo.processName){
                return;
            }
            void flagAppWithOverlay(nextAppInfo.displayName, nextAppInfo.processName);
        }
    }
}

function checkIfAppIsStillOpenAndSetOverlayWindowIfOpen(displayName, processName) {
    const baseName = processName.replace('.exe', '');

    return execPromise(`powershell -Command "Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue"`)
        .then(({ stdout }) => {
            if (stdout && stdout.trim().length > 0) {
                console.log(`⚠️ ${processName} is still open. Re-opening overlay...`);
                if (!overlayWindow) {
                    return flagAppWithOverlay(displayName, processName);
                }
            } else {
                console.log(`✅ ${processName} has been closed manually.`);
                closeOverlayWindow();
            }
        })
        .catch(error => {
            console.error(`Error checking process ${processName}:`, error);
        });
}

ipcMain.on('openMainConfig', () => openMainConfig());

ipcMain.on('openBlockApps', () => windowManager.openWindow('blockApps', 'blockTableForApps.html'));

ipcMain.on('close-app-and-overlay', (event, { displayName, processName }) => {
    closeApp(processName)
        .then((result) => {
            if(result){
                closeOverlayWindow();
                return;
            }

            return canAllowManualClosure()
                .then(canAllowManualCloseNow => {
                    if(canAllowManualCloseNow){
                        setLastManualChangeTimestamp()
                            .then(() => {
                                closeOverlayWindow();
                                setTimeout(() => checkIfAppIsStillOpenAndSetOverlayWindowIfOpen(displayName, processName), 30000);
                            })
                            .catch(error => console.log(error));
                    }
                })
                .catch(error => {
                    console.log("Encountered error while tyring to allow manual closure for app with process name:", processName);
                    console.log(error);
                });
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

async function getInstalledAppInfo(forceRefresh = false) {
    const useCache = !forceRefresh && cachedApps && (Date.now() - lastFetchTime < CACHE_TTL);

    if (useCache) {
        console.log("⚡ Returning cached installed apps (refresh in background)");
        void refreshInstalledApps();
        return cachedApps;
    }

    return refreshInstalledApps();
}

function refreshInstalledApps() {
    const isUserApp = (app) => {
        if (app.hasOwnProperty("InstallLocation") &&
            app.hasOwnProperty("DisplayName") &&
            app.hasOwnProperty("UninstallString")) {
            const location = (app.InstallLocation ?? "").toLowerCase();
            return app.DisplayName && !location.includes("windows") && app.UninstallString;
        }
        return false;
    };

    const findExeInInstallLocation = (installLocation) => {
        if (!installLocation){
            return Promise.resolve(null);
        }

        return fsp.access(installLocation)
            .then(() => fsp.readdir(installLocation))
            .then(files => {
                if (_.isEmpty(files) || !_.isArray(files)) return null;
                return files.find(file => file && file.toLowerCase().endsWith(".exe"));
            })
            .catch(() => null);
    };

    const getMatchFromName = (str = "") => {
        const match = str.match(/\\([^\\]+\.exe)/i);
        return match ? match[1].toLowerCase() : null;
    };

    const tryExeFromIcon = (iconPath) => {
        if (!iconPath || !iconPath.toLowerCase().endsWith(".ico")) {
            return Promise.resolve(null);
        }
        const exePath = iconPath.replace(/\.ico$/i, ".exe");
        return fsp.access(exePath)
            .then(() => path.basename(exePath))
            .catch(() => null);
    };

    const extractProcessName = (displayIcon, uninstallString, installLocation) => {
        const matchFromDisplayIcon = getMatchFromName(displayIcon);
        if (matchFromDisplayIcon) return Promise.resolve(matchFromDisplayIcon);

        const matchFromUninstallString = getMatchFromName(uninstallString);
        if (matchFromUninstallString) return Promise.resolve(matchFromUninstallString);

        return tryExeFromIcon(displayIcon)
            .then(exeFromIconLocation => {
                if (exeFromIconLocation) return exeFromIconLocation;
                return findExeInInstallLocation(installLocation);
            });
    };

    return getInstalledApps()
        .then(apps => {
            const appPromises = apps
                .filter(app => isUserApp(app))
                .map(app =>
                    extractProcessName(
                        app["DisplayIcon"],
                        app["UninstallString"],
                        app["InstallLocation"]
                    ).then(processName => ({
                        displayName: _.get(app, "DisplayName") || app.appName,
                        processName,
                        iconPath: app["DisplayIcon"],
                        installationPath: app["InstallLocation"]
                    }))
                );

            return Promise.all(appPromises);
        })
        .then(appsWithProcesses => {
            cachedApps = appsWithProcesses;
            lastFetchTime = Date.now();
            console.log("♻️ Installed apps refreshed");
            return cachedApps;
        });
}

ipcMain.handle('getAllInstalledApps', async () => {
    const apps = cachedApps;
    void getInstalledApps();
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
    console.log("Here");
    const filename = args.fileName;
    writeData(args.data, filename)
        .then(() => console.log("Successfully saved data to file: " + filename))
        .catch(error => {
            console.log("Failed to save data to file: " + filename);
            console.log(error);
        });
});

ipcMain.on('isSafeSearchEnforced', async () => isSafeSearchEnforced());

function reactivateTimers(activeTimers) {
    const filename = 'savedPreferences.json';
    return readData(filename)
        .then(savedPreferencesData => {
            const data = _.get(savedPreferencesData, 'timerInfo', {});
            Object.entries(data).forEach(([settingId, timer]) => {
                if (!timer || typeof timer !== "object" || !("delayTimeout" in timer)) {
                    console.log(`⏭️ Skipping non-timer entry: ${settingId}`);
                    return;
                }

                const elapsed = Date.now() - timer.startTimeStamp;
                const remaining = timer.delayTimeout - elapsed;

                if (remaining > 0) {
                    console.log(`⏱️ Restarting timer "${settingId}" with ${remaining}ms remaining`);
                    void startCountdownTimer(activeTimers, settingId, remaining, timer.targetTimeout);
                } else {
                    console.log("Handling expirations for setting with id: " + settingId);
                    handleExpiration(settingId, timer.targetTimeout);
                    readData(filename)
                        .then(data => {
                            const timerInfo = _.get(data, 'timerInfo', {});
                            delete timerInfo[settingId];
                            _.set(data, "timerInfo", timerInfo);
                            void writeData(data, filename);
                        })
                        .catch(error => {
                            console.log("Encountered error while reading and writing data for timerInfo");
                            console.log(error);
                        });
                }
            });
        })
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
    return execPromise('netsh interface show interface')
        .then(({ stdout }) => {
            if(stdout){
                const lines = stdout.split('\n');
                const match = Array.from(lines)
                    .filter(line => line)
                    .find(line => line.includes('Connected') && line.includes('Enabled'));
                if(match){
                    const parts = match.trim().split(/\s{2,}/);
                    return parts[parts.length - 1];
                }
            }
            return Promise.reject("No active interface found");
        })
        .catch(error => {
            console.log("Encountered the given error while trying to find active interface names: ", error);
            return Promise.reject("No active interface found");
        });
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

function isSafeDNS(interfaceName) {
    return execPromise(`netsh interface ipv4 show dnsservers name="${interfaceName}"`)
        .then(({ stdout }) => {
            if (!stdout) {
                return false;
            }
            const hasStrictDNS = stdout.includes('185.228.168.168') && stdout.includes('185.228.169.168');
            const hasLenientDNS = stdout.includes('208.67.222.123') && stdout.includes('208.67.220.123');
            return hasStrictDNS || hasLenientDNS;
        })
        .catch(error => {
            console.error('Failed to read DNS settings:', error);
            return false;
        });
}

const processCache = {
    data: new Map(),
    lastUpdate: 0,
    cacheTimeout: 3000
};

const getAllProcessInfo = () => {
    const now = Date.now();

    if (now - processCache.lastUpdate < processCache.cacheTimeout) {
        return Promise.resolve(processCache.data);
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

    const command = `powershell -Command "${psCommand.replace(/\s+/g, ' ')}"`

    return execPromise(command)
        .then(({err, stdout}) => {
            if (err) {
                console.error('Process query error:', err);
                return processCache.data;
            }

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
            return processMap;
        })
        .catch(error => {
            console.error('Encountered the given error when getting all the process info:', error);
            return processCache.data;
        });
};

function appBlockProtection() {
    let monitoringInterval = null;
    const activeOverlays = new Set();

    const getBlockedAppsList = () => {
        return readData('blockData.json')
            .then(blockData => Array.from(_.get(blockData, 'blockedApps', undefined) || []))
            .catch(error => {
                console.log("Encountered error while getting blocked apps from DB: ", error);
                return [];
            });
    };

    const checkBlockedApps = () => {
        return getAllProcessInfo()
            .then(processMap => {
                getBlockedAppsList()
                    .then(blockedApps => {
                        Array.from(blockedApps).forEach(app => {
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
                    }
                    else{
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
                        isTaskManagerOpen()
                            .then(running => {
                                if (running) {
                                    console.log("⚠️ Task Manager is OPEN!");
                                    void flagAppWithOverlay("Task Manager", 'Taskmgr.exe');
                                } else {
                                    console.log("✅ Task Manager is CLOSED.");
                                }
                            })
                            .catch(error => console.log("Encountered issue when checking if the task manager is running:", error));
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
    const isSystemApp = ['control', 'taskmgr', 'taskschd', 'mmc'].includes(baseName);

    let closeCmd;
    if (isSystemApp) {
        closeCmd = `
            $proc = Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue;
            if ($proc) {
                Stop-Process -Name '${baseName}' -Force -ErrorAction SilentlyContinue;
            }
        `;
    } else {
        closeCmd = `
            $proc = Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue;
            if ($proc) {
                $sig = '[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);';
                $type = Add-Type -MemberDefinition $sig -Name NativeMethods -Namespace Win32 -PassThru;
                $proc | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object {
                    $type::PostMessage($_.MainWindowHandle, 0x0010, 0, 0)
                };
                Start-Sleep -Seconds 2;
                $stillRunning = Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue;
                if ($stillRunning) {
                    Stop-Process -Name '${baseName}' -Force -ErrorAction SilentlyContinue;
                }
            }
        `;
    }

    closeCmd = closeCmd.replace(/\s+/g, ' ');

    return execPromise(`powershell -Command "${closeCmd}"`)
        .then(() => {
            console.log(`✅ Close attempt issued for ${processName}`);
            return monitorProcessClosure(baseName);
        })
        .catch(error => {
            console.error(`❌ Failed to issue close for ${processName}:`, error);
            return monitorProcessClosure(baseName);
        });
}

function monitorProcessClosure(baseName) {
    let finished = false;
    const start = Date.now();

    return new Promise(resolve => {
        const checkInterval = setInterval(() => {
            if (finished) return;

            execPromise(`powershell -Command "Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue"`)
                .then(({ stdout }) => {
                    if (finished) return;

                    if (!stdout || stdout.trim().length === 0) {
                        finished = true;
                        clearInterval(checkInterval);
                        console.log(`🎉 ${baseName} successfully closed`);
                        resolve(true);
                    } else if (Date.now() - start >= 60000) {
                        finished = true;
                        clearInterval(checkInterval);
                        console.warn(`⚠️ ${baseName} is still running after 60s`);
                        resolve(false);
                    }
                })
                .catch(() => {
                    if (!finished) {
                        finished = true;
                        clearInterval(checkInterval);
                        console.log(`🎉 ${baseName} successfully closed`);
                        resolve(true);
                    }
                });
        }, 5000);
    });
}


function monitorApp(command) {
    return execPromise(command)
        .then(({ stdout }) => stdout && stdout.trim().length > 0)
        .catch(error => {
            if (error.code === 1) {
                return false;
            }
            console.error('Unexpected error monitoring app:', error);
            return false;
        });
}

function isTaskSchedulerOpen() {
    return execPromise('tasklist /FI "IMAGENAME eq mmc.exe"')
        .then(({err, stdout}) => {
            if (err) {
                console.error("❌ Failed to check Task Scheduler:", err);
                return false;
            }
            return stdout && stdout.toLowerCase().includes("mmc.exe");
        })
        .catch(error => {
            console.log("Encountered error while determining if the task scheduler is open: ", error);
            return false;
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
                return isTaskSchedulerOpen();
            })
            .then(isTaskSchedulerOpen => {
                if(isTaskSchedulerOpen){
                    void flagAppWithOverlay("Task Scheduler", "mmc.exe");
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
    return execPromise('taskkill /IM Taskmgr.exe /F')
        .then(({err}) => {
            if (err) {
                console.error('Failed to close Task Manager:', err);
                return false;
            }
            return true;
        });
}

const fileThreads = {
    activeWorkers: new Map(),
    workerQueue: [],
    maxWorkers: 3,

    execute(task, data) {
        return new Promise((resolve, reject) => {
            const taskId = Date.now() + Math.random();
            this.workerQueue.push({ taskId, task, data, resolve, reject });
            this.processQueue();
        });
    },

    processQueue() {
        if (this.workerQueue.length === 0 || this.activeWorkers.size >= this.maxWorkers) {
            return;
        }

        const { taskId, task, data, resolve, reject } = this.workerQueue.shift();

        const workerCode = `
            const { parentPort, workerData } = require('worker_threads');
            const fs = require('fs').promises;
            const path = require('path');
            
            async function handleTask() {
                try {
                    const result = await (${task.toString()})(workerData);
                    parentPort.postMessage({ success: true, result });
                } catch (error) {
                    parentPort.postMessage({ success: false, error: error.message });
                }
            }
            
            handleTask();
        `;

        const worker = new Worker(workerCode, {
            eval: true,
            workerData: data
        });

        this.activeWorkers.set(taskId, worker);

        worker.on('message', (message) => {
            if (message.success) {
                resolve(message.result);
            } else {
                reject(new Error(message.error));
            }
            this.cleanupWorker(taskId);
            this.processQueue();
        });

        worker.on('error', (error) => {
            reject(error);
            this.cleanupWorker(taskId);
            this.processQueue();
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                reject(new Error(`Worker stopped with exit code ${code}`));
            }
            this.cleanupWorker(taskId);
            this.processQueue();
        });
    },
    cleanupWorker(taskId) {
        const worker = this.activeWorkers.get(taskId);
        if (worker) {
            worker.terminate();
            this.activeWorkers.delete(taskId);
        }
    }
};

async function readFileTask({ filename, basePath }) {
    const dataPath = path.join(basePath, filename);
    const defaultData = {
        blockedApps: [],
        blockedWebsites: [],
        allowedForUnblockWebsites: [],
        allowedForUnblockApps: [],
    };
    const fsp = require('fs').promises;

    try {
        await fsp.access(dataPath);
        const raw = await fsp.readFile(dataPath, "utf8");
        const jsonString = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;

        try {
            return JSON.parse(jsonString);
        } catch (parseError) {
            console.warn("⚠️ Corrupted JSON, attempting cleanup…");
            const cleaned = jsonString
                .trim()
                .replace(/}+\s*$/, "}")
                .replace(/,\s*}/g, "}");
            return JSON.parse(cleaned);
        }
    } catch (error) {
        return defaultData;
    }
}

async function writeFileTask({ filename, data, basePath }) {
    const dataPath = path.join(basePath, filename);
    const fsp = require('fs').promises;

    try {
        await fsp.mkdir(path.dirname(dataPath), { recursive: true });
        const tempPath = dataPath + '.tmp';
        await fsp.writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
        await fsp.rename(tempPath, dataPath);
        return { success: true, path: dataPath };
    } catch (error) {
        console.error("Write error:", error);
        return { success: false, error: error.message };
    }
}

function readData(filename = "savedPreferences.json") {
    return fileThreads.execute(readFileTask, {
        filename,
        basePath
    });
}

function writeData(data, filename) {
    return fileThreads.execute(writeFileTask, {
        filename,
        basePath
    });
}
