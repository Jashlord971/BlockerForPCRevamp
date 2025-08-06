const util = require("util");
const {exec}  = require( "child_process");
const sudoPrompt = require("sudo-prompt");
const {EventEmitter} = require('events');
const {savePreference} = require("./store");

const execPromise = util.promisify(exec);

const options = {
    name: 'My Electron App',
};

const dnsSuccessfullySetEvent = new EventEmitter();

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
                dnsSuccessfullySetEvent.emit('dnsSuccessfullySet');
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

module.exports = {
    isSafeDNS,
    getActiveInterfaceName,
    configureSafeDNS,
    dnsSuccessfullySetEvent
}
