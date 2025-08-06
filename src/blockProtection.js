const {exec} = require("child_process");
const {EventEmitter} = require("events");
const {checkSavedPreferences}  = require("./store.js");
const {getJson} = require("./store.js");

const blockProtectionEmitter = new EventEmitter();

const flagAppWithOverlay = (displayName, processName) => blockProtectionEmitter.emit('flagAppWithOverlay', {displayName, processName});

function appBlockProtection(){
    const getBlockedAppsList = () => {
        const data = getJson("data/blockData.json");
        if(!data || !data.hasOwnProperty("blockedApps")){
            return [];
        }
        return data['blockedApps'];
    }

    const findAndCloseBlockedApps = () => {
        const blockingCall = () => {
            const blockedApps = getBlockedAppsList();

            blockedApps.forEach(app => {
                const processNameBase = app.processName.replace('.exe', '');
                const displayName = app.displayName;

                exec(`powershell -Command "$p = Get-Process -Name '${processNameBase}' -ErrorAction SilentlyContinue; if ($p) { Write-Output 'RUNNING' }"`,
                    (err, stdout) => {
                        if (stdout && stdout.trim() === 'RUNNING') {
                            console.log(`⚠️ Blocked app ${displayName} (${app.processName}) is running!`);
                            flagAppWithOverlay(displayName, app.processName);
                            return;
                        }

                        exec(
                            `powershell -Command "Get-Process | Where-Object { $_.MainWindowTitle -match '${displayName}' } | Select-Object ProcessName,MainWindowTitle"`,
                            (err, stdout) => {
                                if (stdout && stdout.toLowerCase().includes(displayName.toLowerCase())) {
                                    console.log(`⚠️ Blocked app ${displayName} detected by window title!`);
                                    flagAppWithOverlay(displayName, app.processName);
                                }
                            }
                        );
                    }
                );
            });
        };

        blockingCall();
    }

    const monitorBlockedApps = () => setInterval(() => findAndCloseBlockedApps(), 2000);

    const mainCall = () => {
        const id = "overlayRestrictedContent";
        const isAppBlockingEnabled = checkSavedPreferences(id);
        if (isAppBlockingEnabled) {
            findAndCloseBlockedApps();
            monitorBlockedApps();
        }
    }

    mainCall();
}

function closeApp(processName, displayName) {
    const baseName = processName.replace('.exe', '');

    return new Promise((resolve) => {
        exec(`powershell -Command "$proc = Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue; if ($proc) { $sig = '[DllImport(\\"user32.dll\\")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);'; $type = Add-Type -MemberDefinition $sig -Name NativeMethods -Namespace Win32 -PassThru; $proc | ForEach-Object { $type::PostMessage($_.MainWindowHandle, 0x0010, 0, 0) } }"`,
            (err) => {
                if (err) {
                    console.error(`Failed to close ${processName} by process name:`, err);
                } else {
                    console.log(`✅ Attempted to close ${processName} by process name`);
                }

                exec(`powershell -Command "$procs = Get-Process | Where-Object { $_.MainWindowTitle -match '${displayName}' }; if ($procs) { $sig = '[DllImport(\\"user32.dll\\")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);'; $type = Add-Type -MemberDefinition $sig -Name NativeMethods -Namespace Win32 -PassThru; $procs | ForEach-Object { $type::PostMessage($_.MainWindowHandle, 0x0010, 0, 0) } }"`,
                    () => {
                        console.log(`✅ Attempted to close ${displayName} by window title`);

                        setTimeout(() => {
                            exec(`powershell -Command "Get-Process -Name '${baseName}' -ErrorAction SilentlyContinue"`, (err, stdout) => {
                                if (!err && stdout.toLowerCase().includes(baseName.toLowerCase())) {
                                    console.log(`⚠️ ${baseName} still running. Force killing...`);
                                    exec(`powershell -Command "Stop-Process -Name '${baseName}' -Force -ErrorAction SilentlyContinue"`, () => {
                                        resolve();
                                    });
                                } else {
                                    console.log(`✅ ${baseName} appears to be closed.`);
                                    resolve();
                                }
                            });
                        }, 3000);
                    });
            });
    });
}

const findAndCloseControlPanel = () => {
    exec(`powershell -Command "Get-Process | Where-Object { $_.MainWindowTitle -match 'Control Panel' } | Select-Object ProcessName,MainWindowTitle"`, (err, stdout) => {
        if (err) {
            console.error('PowerShell error:', err);
            return;
        }

        if (stdout.toLowerCase().includes('control panel')) {
            console.log("⚠️ Control Panel is open!");

            exec(`powershell -Command "$cp = Get-Process | Where-Object { $_.MainWindowTitle -match 'Control Panel' }; if ($cp) { $sig = '[DllImport(\\"user32.dll\\")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);'; $type = Add-Type -MemberDefinition $sig -Name NativeMethods -Namespace Win32 -PassThru; $cp | ForEach-Object { $type::PostMessage($_.MainWindowHandle, 0x0010, 0, 0) } }"`, (err) => {
                if (err) {
                    console.error('Failed to close Control Panel:', err);
                } else {
                    console.log('✅ Attempted to close Control Panel window');
                }
            });
        }
    });
}

const isHostsFileOpenedInNotepad = (callback) => {
    const psCommand = `
        $hostsPath = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
        $result = $false;
        
        try {
            # Get all Notepad processes
            $notepadProcesses = Get-Process notepad -ErrorAction SilentlyContinue;
            
            foreach ($proc in $notepadProcesses) {
                try {
                    # Check if any Notepad window has "hosts" in the title
                    if ($proc.MainWindowTitle -like '*hosts*') {
                        $result = $true;
                        break;
                    }
                    
                    # Alternative check for file content
                    if ($proc.MainWindowTitle -eq 'Untitled - Notepad') {
                        $windowText = (Get-Clipboard);
                        if ($windowText -like '*127.0.0.1*') {
                            $result = $true;
                            break;
                        }
                    }
                } catch {}
            }
        } catch {}
        
        $result
    `;

    const formattedCmd = psCommand
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'))
        .join('; ');

    exec(`powershell -Command "${formattedCmd}"`, (error, stdout) => {
        if (error) {
            console.error('PowerShell error:', error.message);
            return callback(false);
        }

        const isOpen = stdout.trim() === 'True';
        callback(isOpen);
    });
}

const monitorHostsFileInNotepad = () => {
    exec('taskkill /f /im notepad.exe', (error, stdout, stderr) => {
        if (error) {
            console.error('Failed to kill Notepad:', error.message);
            return;
        }
        console.log('Notepad force-closed!');
    });

    return setInterval(() => {
        isHostsFileOpenedInNotepad((isOpen) => {
            /*
            if (isOpen) {
                void closeApp('notepad.exe', 'Notepad');
            }*/

        });
    }, 30000);
};

function settingsProtectionOn(){
    const monitorControlPanelNetworkSection = () => setInterval(() => findAndCloseControlPanel(), 2000);

    if(checkSavedPreferences("blockSettingsSwitch")){
        findAndCloseControlPanel();
        monitorControlPanelNetworkSection();
        monitorHostsFileInNotepad();
        appBlockProtection();
    }
}

module.exports = {
    settingsProtectionOn,
    appBlockProtection,
    closeApp,
    blockProtectionEmitter
}