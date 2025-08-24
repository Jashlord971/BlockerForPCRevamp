const {exec} = require("child_process");
const {EventEmitter} = require("events");
const {checkSavedPreferences} = require("./store.js");
const {readData} = require("./store");

const { ipcRenderer } = require('electron');

const blockProtectionEmitter = new EventEmitter();

const flagAppWithOverlay = (displayName, processName) => ipcRenderer.send('flagWithOverlay', { displayName, processName });

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

                if (result.processes) {
                    result.processes.forEach(proc => {
                        const key = proc.ProcessName?.toLowerCase();
                        if (key) {
                            processMap.set(key, {
                                processName: proc.ProcessName,
                                windowTitle: proc.MainWindowTitle || '',
                                id: proc.Id
                            });
                        }
                    });
                }

                processMap.set('_meta', {
                    controlPanelOpen: result.controlPanel,
                    notepadHostsOpen: result.notepadHosts
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
        const blockData = readData();
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

    mainCall();
}

function closeApp(processName, displayName) {
    const baseName = processName.replace('.exe', '');

    return new Promise((resolve) => {
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
        `;

        exec(`powershell -Command "${closeCmd.replace(/\s+/g, ' ')}"`, (err) => {
            if (err) {
                console.error(`Failed to close ${processName}:`, err);
            } else {
                console.log(`✅ Attempted to close ${processName}`);
            }
            resolve();
        });
    });
}

function settingsProtectionOn() {

    const monitorSettings = async () => {
        const processMap = await getAllProcessInfo();
        const meta = processMap.get('_meta');

        if (!meta) return;

        if (meta.controlPanelOpen) {
            console.log("⚠️ Control Panel is open!");
            exec(`powershell -Command "$cp = Get-Process | Where-Object { $_.MainWindowTitle -match 'Control Panel' }; $cp | ForEach-Object { $_.CloseMainWindow() }"`,
                (err) => {
                    if (!err) console.log('✅ Attempted to close Control Panel');
                });
        }

        if (meta.notepadHostsOpen) {
            flagAppWithOverlay('Notepad', 'notepad.exe');
        }
    };

    if (checkSavedPreferences("blockSettingsSwitch")) {
        const settingsInterval = setInterval(monitorSettings, 12000);

        void monitorSettings();
        appBlockProtection();

        return settingsInterval;
    }
}

module.exports = {
    settingsProtectionOn,
    appBlockProtection,
    closeApp,
    blockProtectionEmitter
};