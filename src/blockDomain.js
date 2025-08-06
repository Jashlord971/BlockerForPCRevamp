const fs = require('fs');
const os = require('os');
const sudoPrompt = require('sudo-prompt');
const { get, set } = require('./store.js');

const HOSTS_FILE = 'C:\\Windows\\System32\\drivers\\etc\\hosts';

async function blockDomain(baseDomain) {
    if (!baseDomain) {
        console.error(`❌ Invalid domain or URL: ${baseDomain}`);
        return;
    }

    const domainsToBlock = [baseDomain];
    if (!baseDomain.startsWith('www.')) {
        domainsToBlock.push(`www.${baseDomain}`);
    }

    const lines = domainsToBlock.map(d => `127.0.0.1 ${d}`);

    const script = `
        const fs = require('fs');
        const os = require('os');
        const path = "${HOSTS_FILE.replace(/\\/g, '\\\\')}";
        const lines = ${JSON.stringify(lines)};
        let content = fs.readFileSync(path, 'utf8');
        lines.forEach(line => {
            if (!content.includes(line)) content += os.EOL + line;
        });
        fs.writeFileSync(path, content, 'utf8');
        console.log("✅ Blocked: " + lines.join(', '));
    `.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n\s+/g, ' ');

    return new Promise ((resolve) => {
        sudoPrompt.exec(`node -e "${script}"`, { name: 'Website Blocker' }, (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ Failed to block ${baseDomain}:`, error.message || stderr);
                resolve(false);
                return;
            }
            console.log(stdout.trim());
            resolve(true);
        })
    });
}

async function addWebsiteToHostsFile(event, domain){
    blockDomain(domain)
        .then(isBlocked => {
            if (isBlocked) {
                const blockedWebsites = get('blockedWebsites', []);
                if (!blockedWebsites.includes(domain)) {
                    blockedWebsites.push(domain);
                    set('blockedWebsites', blockedWebsites);
                }
                event.sender.send('websiteBlockedSuccess');
            } else {
                event.sender.send('websiteBlockedError', 'Domain was not blocked');
            }
        })
        .catch(error => {
            event.sender.send('websiteBlockedError', error.message);
        });
}

function unblockDomain(domain) {
    let content = fs.readFileSync(HOSTS_FILE, 'utf8');

    const regex = new RegExp(`^.*127\\.0\\.0\\.1\\s+(www\\.)?${domain}.*$`, 'gm');
    const newContent = content.replace(regex, '').replace(/\n{2,}/g, '\n');

    fs.writeFileSync(HOSTS_FILE, newContent.trim() + os.EOL, 'utf8');
}

module.exports = {
    blockDomain,
    addWebsiteToHostsFile
}