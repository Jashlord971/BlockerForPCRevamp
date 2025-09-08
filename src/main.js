const {app, BrowserWindow, Menu, ipcMain, dialog}  = require('electron');
const path = require("path");
const {exec} = require("child_process");
const util = require('util');
const execPromise = util.promisify(exec);
const {getInstalledApps}  = require("get-installed-apps");
const fs = require("fs");
const sudoPrompt = require("sudo-prompt");
const _ = require("lodash");

let mainWindow = null;
const activeTimers = new Map();
let overlayWindow = null;
let dnsConfirmationModal = null;
let delayAccountDialog = null;
let flag = false;
let overlayQueue = [];

const HOSTS_PATH = 'C:\\Windows\\System32\\drivers\\etc\\hosts';

function getAssetPath(fileName) {
    return path.join(__dirname, fileName);
}

function getHtmlPath(fileName) {
    console.log(__dirname);
    return path.join(__dirname, fileName);
}

function getDataPath(fileName) {
    const isDev = !app.isPackaged;
    const basePath = isDev ? path.join(__dirname, 'data') : path.join(app.getPath('userData'), 'data');

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

    mainWindow.webContents.openDevTools();

    mainWindow.loadFile(getHtmlPath('mainConfig.html')).then(() => {
        const customMenu = Menu.buildFromTemplate(getMenuTemplate());
        Menu.setApplicationMenu(customMenu);
    });

    if(flag){
        makeWindowNotClosable(mainWindow);
    }
}

function checkSavedPreferences(id){
    const filename = 'savedPreferences.json';
    const data = readData(filename);
    return data && data[id];
}

function makeWindowNotClosable(window){
    if(window){
        window.on('close', (e) => {
            if (!checkSavedPreferences("appUninstallationProtection")) {
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
    const filename = 'savedPreferences.json';
    const preferences = readData(filename);
    const value = preferences.delayTimeout;
    if(!value){
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
    const preferences = readData(filename);
    preferences[id] = value;
    writeData(preferences, filename);
}

app.whenReady().then(async () => {
    if(!isSafeSearchEnforced()){
        savePreference("enforceSafeSearch", false);
    }

    createWindow();

    setTimeout(async () => {
        const value = await isDnsMadeSafe();
        if(!value){
            savePreference("enableProtectiveDNS", false);
            refreshMainConfig();
        }
        reactivateTimers();
    }, 4000);

    //installMyService();
    settingsProtectionOn();
    appBlockProtection();
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

function canFlagNow(){
    const blockData = readData("savedPreferences.json") || {};
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
        overlayWindow?.webContents?.send('app-info', appInfo);
    });
}

function flagAppWithOverlay(displayName, processName) {
    const isManualOverrideAllowed = canAllowManualClosure();
    const appInfo = { displayName, processName, isManualOverrideAllowed };

    if (overlayWindow) {
        overlayQueue.push(appInfo);
    } else {
        if(canFlagNow()){
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

function canAllowManualClosure() {
    const blockData = readData("savedPreferences.json");
    const timerInfo = blockData?.timerInfo || {};
    const lastManualChange = _.get(timerInfo, "lastManualChangeTimestamp", undefined);

    if (!lastManualChange) {
        return true;
    }

    const eightHours = 8 * 60 * 60 * 1000;
    return (Date.now() - lastManualChange) >= eightHours;
}

function setLastManualChangeTimestamp(){
    const filename = "savedPreferences.json";
    const blockData = readData(filename);

    _.set(blockData, "timerInfo.lastManualChangeTimestamp", Date.now());
    writeData(blockData, filename);
}

function closeOverlayWindow() {
    if (overlayWindow) {
        overlayWindow.close();
        overlayWindow = null;

        if (overlayQueue.length > 0) {
            const nextAppInfo = overlayQueue.shift();
            flagAppWithOverlay(nextAppInfo.displayName, nextAppInfo.processName);
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
                flagAppWithOverlay(displayName, processName);
            }
        } else {
            console.log(`✅ ${processName} has been closed manually.`);
            closeOverlayWindow();
        }
    });
}

ipcMain.on('close-app-and-overlay', (event, { displayName, processName }) => {
    closeApp(processName)
        .then((result) => {
            if(result){
                closeOverlayWindow()
            } else if(canAllowManualClosure()){
                setLastManualChangeTimestamp();
                closeOverlayWindow();
                setTimeout(() => checkIfAppIsStillOpenAndSetOverlayWindowIfOpen(displayName, processName), 30000);
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

    enforceSafeSearch().then(() => {
        console.log("blah");
        savePreference("enforceSafeSearch", true);
        event.sender.send('refreshMainConfig');
    });
});

ipcMain.on('set-delay-timeout', (event, delayValue) => {
    const filename = 'savedPreferences.json';
    const preferences = readData(filename);
    preferences.delayTimeout = delayValue;
    writeData(preferences, filename);
});

ipcMain.on('start-delay-timeout-change', (event, newDelayValue) => {
    startCountdownTimer(activeTimers, "delayTimeout", getDelayTimeOut(), newDelayValue);
    event.sender.send('sendTimeRemaining');
});

ipcMain.on('prime-block-for-deletion', (event, id) => {
    startCountdownTimer(activeTimers, id, getDelayTimeOut(), null);
});

ipcMain.on('renderTableCall', (event) => {
    event.sender.send('renderLatestTable');
});

ipcMain.handle('getDelayChangeStatus', () => getDelayChangeStatus());

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

ipcMain.on('turnOnAppProtection', () => appBlockProtection());

ipcMain.on('turnOnSettingsProtection', () => settingsProtectionOn());

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

function readData(filename = 'savedPreferences.json') {
    const dataPath = getDataPath(filename);

    const defaultBlockData =  {
        blockedApps: [],
        blockedWebsites: [],
        allowedForUnblockWebsites: [],
        allowedForUnblockApps: []
    }

    if (!fs.existsSync(dataPath)){
        return defaultBlockData;
    }

    try {
        const raw = fs.readFileSync(dataPath, 'utf-8');
        return JSON.parse(raw);
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

    const findExeInInstallLocation = (installLocation) => {
        if (!installLocation || !fs.existsSync(installLocation)) return null;

        const files = fs.readdirSync(installLocation);
        const exe = files.find(file => file.toLowerCase().endsWith('.exe'));
        return exe || null;
    }

    const getMatchFromName = (str = "") => {
        const match = str.match(/\\([^\\]+\.exe)/i);
        return match ? match[1].toLowerCase() : null;
    }

    const tryExeFromIcon = (iconPath) => {
        if (!iconPath || !iconPath.toLowerCase().endsWith('.ico')) return null;

        const exePath = iconPath.replace(/\.ico$/i, '.exe');
        if (fs.existsSync(exePath)) return path.basename(exePath);
        return null;
    }

    const extractProcessName = (displayIcon, uninstallString, installLocation) => {
        const matchFromDisplayIcon = getMatchFromName(displayIcon);
        if(matchFromDisplayIcon){
            return matchFromDisplayIcon;
        }

        const matchFromUnInstallString = getMatchFromName(uninstallString);
        if(matchFromUnInstallString){
            return matchFromUnInstallString;
        }

        const exeFromIconLocation = tryExeFromIcon(displayIcon);
        if(exeFromIconLocation){
            return exeFromIconLocation;
        }

        return findExeInInstallLocation(installLocation);
    }

    const apps = await getInstalledApps();

    return apps
        .filter(app => isUserApp(app))
        .map(app => {
            return {
                displayName: (app.hasOwnProperty("DisplayName") && app.DisplayName) ? app.DisplayName : app.appName,
                processName: extractProcessName(app['DisplayIcon'] , app['UninstallString'], app['InstallLocation']),
                iconPath: app['DisplayIcon'],
                installationPath: app['InstallLocation']
            }
        });
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
    writeData(args.data, args.fileName);
});

ipcMain.on('isSafeSearchEnforced', async () => isSafeSearchEnforced());

function writeData(data, filename) {
    const dataPath = getDataPath(filename);
    if (fs.existsSync(dataPath)) {
        const stat = fs.lstatSync(dataPath);
        if (stat.isDirectory()) {
            fs.rmdirSync(dataPath, { recursive: true });
        }
    }

    const dir = path.dirname(dataPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

function reactivateTimers(activeTimers) {
    const filename = 'timers.json';
    const data = readData(filename);

    Object.keys(data).forEach(settingId => {
        const timer = data[settingId];
        const elapsed = Date.now() - timer.startTimeStamp;
        const remaining = timer.delayTimeout - elapsed;

        if (remaining > 0) {
            console.log("starting timer for :", settingId + " with a remaining time: ", remaining);
            startCountdownTimer(activeTimers, settingId, remaining);
        } else {
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
        savePreference(settingId, targetTimeout);
    }
    else if(settingId.includes(delimiter)){
        const splits = settingId.split(delimiter);
        const key = splits[0];
        const item = splits[1];

        const keyInBlockData = (key === 'site') ? 'allowedForUnblockWebsites' : 'allowedForUnblockApps';
        let blockData = readData('savedPreferences.json');
        if(!blockData.hasOwnProperty(keyInBlockData)){
            blockData[keyInBlockData] = [];
        }

        blockData[keyInBlockData].push(item);
        renderTable();
    }
    else{
        savePreference(settingId, false);
    }
    turnOffSetting(settingId);
}

function startCountdownTimer(activeTimers, settingId, remainingTime, targetTimeout = null) {
    //const delayTimeout = getPreference("delayTimeout", preferencesPath);
    const filename = 'savedPreferences.json';
    const delayTimeout = 30000;
    const startTimeStamp = Date.now();
    const endTime = startTimeStamp + delayTimeout;
    const mainData = readData(filename);

    const intervalId = setInterval(() => {
        const now = Date.now();
        const remaining = Math.max(endTime - now, 0);

        const data = mainData?.timerInfo ?? {};

        if (remaining <= 0) {
            clearInterval(intervalId);
            activeTimers.delete(settingId);

            void handleExpiration(settingId, targetTimeout);

            if(data.hasOwnProperty(settingId)){
                delete data[settingId];
            }
        } else {
            activeTimers.set(settingId, {
                intervalId,
                endTime
            });

            remainingTime = !remainingTime ? delayTimeout : remaining

            if(!data[settingId]){
                data[settingId] = {
                    delayTimeout,
                    remainingTime,
                    startTimeStamp,
                    targetTimeout
                }
            }
        }

        const blockData = readData(filename);
        void writeData({
            ...blockData,
            timerInfo: data
        }, filename);

    }, 1000);

    activeTimers.set(settingId, {
        intervalId,
        endTime
    });

    console.log(`🟢 Started timer for ${settingId}`);
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

    const getBlockedAppsList = () => {
        const blockData = readData('blockData.json');
        const blockedLists = blockData ? blockData.blockedApps : [];
        return blockedLists || [];
    };

    const checkBlockedApps = async () => {
        const processMap = await getAllProcessInfo();
        const blockedApps = getBlockedAppsList();

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
    };

    const monitorBlockedApps = () => {
        if (monitoringInterval) return;

        monitoringInterval = setInterval(async () => {
            const isAppBlockingEnabled = checkSavedPreferences("overlayRestrictedContent");


            if (!isAppBlockingEnabled) {
                clearInterval(monitoringInterval);
                monitoringInterval = null;
                activeOverlays.clear();
                return;
            }

            await checkBlockedApps();
        }, 8000);
    };

    const mainCall = async () => {
        const isAppBlockingEnabled = checkSavedPreferences("overlayRestrictedContent");
        if (isAppBlockingEnabled) {
            await checkBlockedApps();
            monitorBlockedApps();
        }
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
    const monitorSettings = async () => {
        try {
            const hostMonitoringCommand = `powershell -Command "Get-Process notepad -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match 'hosts' }"`;
            const isHostsFileFlagged = await monitorApp(hostMonitoringCommand);

            if(isHostsFileFlagged){
                flagAppWithOverlay("Notepad (hosts file)", "notepad.exe");
                return false;
            }

            const controlPanelMonitorCommand =  `powershell -Command "Get-Process | Where-Object { $_.MainWindowTitle -match 'Control Panel' }"`;

            const isControlPanelOpen = await monitorApp(controlPanelMonitorCommand);
            if(isControlPanelOpen){
                flagAppWithOverlay("Control Panel", "control.exe");
                return false;
            }

        } catch (e) {
            console.error("Error monitoring settings:", e);
        }
    };

    if (checkSavedPreferences("blockSettingsSwitch")) {
        const settingsInterval = setInterval(monitorSettings, 12000);

        void monitorSettings();
        appBlockProtection();

        return settingsInterval;
    }
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

    try {
        const content = fs.readFileSync(HOSTS_PATH, 'utf8');
        return requiredEntries.every(entry => content.includes(entry));
    } catch (err) {
        console.error('❌ Error reading hosts file:', err.message);
        return false;
    }
}
