const {ipcRenderer} = require("electron");
const {get, set, readData} = require("./store");
const sudoPrompt = require("sudo-prompt");
const key = 'blockedWebsites';

function renderTable() {
    const tbody = document.querySelector('#data-table tbody');
    tbody.innerHTML = '';

    const list = get(key, []);
    if (list.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 2;
        cell.textContent = "No websites blocked yet.";
        row.appendChild(cell);
        tbody.appendChild(row);
    }
    else{
        const blockData = readData();
        const allowedWebsitesForDeletions = blockData.allowedForUnblockWebsites ?? [];

        list.forEach((item, index) => {
            const isAllowedToDelete = allowedWebsitesForDeletions.includes(item);

            const row = document.createElement('tr');

            const nameCell = document.createElement('td');
            nameCell.textContent = typeof item === 'string' ? item : item.displayName;

            const deleteCell = document.createElement('td');
            const deleteButton = document.createElement('button');

            const deleteButtonDetails = getButtonTextAndColour(isAllowedToDelete);
            deleteButton.textContent = deleteButtonDetails.label;
            deleteButton.style.backgroundColor = '#FF5555';
            deleteButton.style.color = deleteButtonDetails.color;
            deleteButton.style.border = 'none';
            deleteButton.style.padding = '5px 10px';
            deleteButton.style.borderRadius = '5px';
            deleteButton.style.cursor = 'pointer';
            deleteButton.onclick = () => {
                if(isAllowedToDelete){
                    removeItem(index);
                }
                else{
                    const settingId = "site-->" + item;
                    ipcRenderer.send('prime-block-for-deletion', settingId);
                }
            }
            deleteCell.appendChild(deleteButton);

            row.appendChild(nameCell);
            row.appendChild(deleteCell);
            tbody.appendChild(row);
        });
    }
}

ipcRenderer.on('listeningForRenderTableCall', () => renderTable());

function getButtonTextAndColour(isAllowedToDelete){
    if(isAllowedToDelete){
        return {
            label: "Delete",
            color: '#fff'
        }
    }

    return {
        color: 'green',
        label: "Prepare for Deletion"
    }
}

window.removeItem = function(index) {
    const list = get(key, []);
    list.splice(index, 1);
    set(key, list);
    renderTable();
};

function closeModal(modal){
    modal.style.display = 'none';
}

window.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('modal');
    const input = document.getElementById('modal-input');
    const saveBtn = document.getElementById('save-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const addBtn = document.getElementById('add-btn');

    ipcRenderer.send('getAllInstalledApps');

    renderTable();

    addBtn.addEventListener('click', () => {
        input.value = '';
        modal.style.display = 'flex';
        input.focus();
    });

    cancelBtn.addEventListener('click', () => closeModal(modal));

    saveBtn.addEventListener('click', async () => {
        const value = input.value.trim();
        if (!value) return;

        try {
            const success = await addToBlockListsForWebsites(modal, value);
            if (success) {
                renderTable();
                modal.style.display = 'none';
            }
        } catch (error) {
            console.error('Error blocking website:', error);
            alert(`Failed to block website: ${error.message}`);
        }
    });
});

function addToBlockListsForWebsites(modal, domain) {
    const normalizeDomain = (input) => {
        try {
            if (!input.startsWith('http')) input = 'http://' + input;
            const url = new URL(input);
            let hostname = url.hostname.toLowerCase();
            return hostname.replace(/^www\./, '');
        } catch {
            return null;
        }
    }

    const baseDomain = normalizeDomain(domain);
    if (baseDomain === null) {
        alert("Invalid website address. Please enter a valid URL.");
        return false;
    }

    return blockDomain(domain)
        .then(isBlocked => {
            if (isBlocked) {
                const blockedWebsites = get('blockedWebsites', []);
                if (!blockedWebsites.includes(domain)) {
                    blockedWebsites.push(domain);
                    set('blockedWebsites', blockedWebsites);
                }
            }
            renderTable();
            closeModal(modal);
        })
        .catch(() => {
            alert("Unable to block given website");
        });
}

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

