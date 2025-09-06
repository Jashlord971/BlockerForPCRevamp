const { Service } = require('node-windows');
const path = require('path');
const ps = require('ps-node');
const { exec } = require('child_process');
const fs = require('fs');

// Configure logging
const logDirectory = path.join(__dirname, 'logs');
const logFile = path.join(logDirectory, 'service.log');

// Ensure log directory exists
if (!fs.existsSync(logDirectory)) {
    fs.mkdirSync(logDirectory);
}

function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logFile, logMessage);
    console.log(message);
}

const appPath = path.join(__dirname, 'dist', 'EagleBlocker.exe');

function ensureRunning() {
    log("Checking if EagleBlocker is running...");
    ps.lookup({ command: 'EagleBlocker.exe' }, (err, resultList) => {
        if (err) {
            log(`Error checking process: ${err.message}`);
            return;
        }

        if (!resultList || resultList.length === 0) {
            log('EagleBlocker not running, starting application...');
            exec(`"${appPath}"`, (error, stdout, stderr) => {
                if (error) {
                    log(`Failed to start EagleBlocker: ${error.message}`);
                }
                if (stderr) {
                    log(`EagleBlocker stderr: ${stderr}`);
                }
                if (stdout) {
                    log(`EagleBlocker stdout: ${stdout}`);
                }
            });
        } else {
            log('EagleBlocker is already running.');
        }
    });
}

// Create the service
const svc = new Service({
    name: 'EagleBlockerService',
    description: 'Keeps EagleBlocker running at all times.',
    script: path.join(__dirname, 'background.js'),
    nodeOptions: ['--harmony', '--max_old_space_size=4096']
});

// Service event handlers
svc.on('install', () => {
    log('Service installed. Starting service and application...');
    svc.start();
    ensureRunning();
    setInterval(ensureRunning, 3 * 60 * 1000); // Check every 3 minutes
});

svc.on('alreadyinstalled', () => {
    log('Service already installed.');
});

svc.on('start', () => {
    log('Service started. Beginning monitoring...');
    ensureRunning();
    setInterval(ensureRunning, 3 * 60 * 1000);
});

svc.on('stop', () => {
    log('Service stopped.');
});

svc.on('error', (error) => {
    log(`Service error: ${error.message}`);
});

// Install the service
log('Attempting to install EagleBlocker service...');
svc.install();

/*
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
 */
