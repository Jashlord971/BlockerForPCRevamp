const { exec } = require('child_process');
const path = require('path');
const nodeWindows = require('node-windows'); // full module
const { Service } = nodeWindows;

nodeWindows.config = {
    basePath: path.join(process.env.PROGRAMDATA || process.env.APPDATA, 'EagleBlockerService')
};

class ServiceManager {
    static checkServiceExists() {
        return new Promise((resolve) => {
            exec('sc query EagleBlockerService', (error, stdout) => {
                if (error || stdout.includes('FAILED')) {
                    resolve(false);
                } else {
                    resolve(true);
                }
            });
        });
    }

    static installService() {
        return new Promise((resolve, reject) => {
            const serviceScript = path.join(process.resourcesPath, 'app', 'backgroundService.js');

            const svc = new Service({
                name: 'EagleBlockerService',
                description: 'Eagle Blocker background protection service',
                script: serviceScript,
                nodeOptions: ['--harmony', '--max_old_space_size=4096']
            });

            svc.on('install', () => {
                console.log('Service installed');
                svc.start();
                resolve('Service installed and started');
            });

            svc.on('alreadyinstalled', () => resolve('Service already installed'));
            svc.on('error', err => reject(err));

            svc.install();
        });
    }

    static startService() {
        return new Promise((resolve, reject) => {
            exec('net start EagleBlockerService', (error, stdout) => {
                if (error) return reject(new Error(`Failed to start service: ${error.message}`));
                resolve(stdout || 'Service started successfully');
            });
        });
    }
}

module.exports = ServiceManager;
