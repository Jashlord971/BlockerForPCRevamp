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