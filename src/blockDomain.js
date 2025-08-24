const fs = require('fs');
const os = require('os');
const sudoPrompt = require('sudo-prompt');
const { get, set } = require('./store.js');

async function blockDomain(baseDomain) {
    const HOSTS_FILE = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
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
        const path = ${JSON.stringify(HOSTS_FILE)};
        const lines = ${JSON.stringify(lines)};
        let content = fs.readFileSync(path, 'utf8');
        lines.forEach(line => {
            if (!content.includes(line)) content += os.EOL + line;
        });
        fs.writeFileSync(path, content, 'utf8');
        console.log("✅ Blocked: " + lines.join(', '));
    `.trim().replace(/\n\s+/g, ' ');

    console.log("script:" + script);

    return new Promise((resolve) => {
        const command = `node -e "${script.replace(/"/g, '\\"')}"`;
        sudoPrompt.exec(command, { name: 'Website Blocker' }, (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ Failed to block ${baseDomain}:`, error.message || stderr);
                resolve(false);
                return;
            }
            console.log(stdout.trim());
            resolve(true);
        });
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
    const HOSTS_FILE = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
    let content = fs.readFileSync(HOSTS_FILE, 'utf8');

    const regex = new RegExp(`^.*127\\.0\\.0\\.1\\s+(www\\.)?${domain}.*$`, 'gm');
    const newContent = content.replace(regex, '').replace(/\n{2,}/g, '\n');

    fs.writeFileSync(HOSTS_FILE, newContent.trim() + os.EOL, 'utf8');
}

module.exports = {
    blockDomain,
    addWebsiteToHostsFile
}