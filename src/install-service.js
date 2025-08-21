const { Service } = require('node-windows');
const path = require('path');

const svc = new Service({
    name: 'EagleBlockerService',
    description: 'Keeps EagleBlocker running at all times.',
    script: path.join(__dirname, 'background.js'),
    nodeOptions: ['--harmony', '--max_old_space_size=4096']
});

svc.on('install', () => {
    console.log('Service installed and started.');
    svc.start();
});

svc.on('alreadyinstalled', () => {
    console.log('Service already installed.');
});

svc.install();
