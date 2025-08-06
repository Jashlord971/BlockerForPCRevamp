const sudoPrompt = require("sudo-prompt");
const fs = require("fs");
const HOSTS_PATH = 'C:\\Windows\\System32\\drivers\\etc\\hosts';

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

module.exports = {
    isSafeSearchEnforced,
    enforceSafeSearch
}