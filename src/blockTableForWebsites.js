const {ipcRenderer} = require("electron");
const sudoPrompt = require("sudo-prompt");
const fs = require("fs");
const os = require("os");

const HOSTS_FILE = 'C:\\Windows\\System32\\drivers\\etc\\hosts';

function init(){
    if(ipcRenderer){
        ipcRenderer.on('renderLatestTable', () => renderTable());
    }

    if(!!!window){
        return;
    }

    window.addEventListener('DOMContentLoaded', () => {
        const modal = document.getElementById('modal');
        const input = document.getElementById('modal-input');
        const saveBtn = document.getElementById('save-btn');
        const cancelBtn = document.getElementById('cancel-btn');
        const addBtn = document.getElementById('add-btn');

        void renderTable();

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
                    void renderTable();
                    modal.style.display = 'none';
                }
            } catch (error) {
                console.error('Error blocking website:', error);
                alert(`Failed to block website: ${error.message}`);
            }
        });
    });

    window.removeItem = async function(index) {
        const list = await getListOfBlockedWebsites();
        list.splice(index, 1);
        return saveBlockedWebsitesList(list)
            .then(() => renderTable())
            .catch(error => console.log(error));
    };
}

init();

function getScriptForBlockingWebsite(lines){
    return `
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
}

async function getListOfBlockedWebsites(){
    const blockData = await ipcRenderer.invoke('getBlockData');
    if(blockData){
        return blockData.blockedWebsites;
    }
    return [];
}

function createEmptyRow(message) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 2;
    cell.textContent = message;
    row.appendChild(cell);
    return row;
}

function createDataRow(item, index, isAllowedToDelete) {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.textContent = typeof item === 'string' ? item : item.displayName;

    const deleteCell = document.createElement('td');
    const deleteButton = createDeleteButton(item, index, isAllowedToDelete);
    deleteCell.appendChild(deleteButton);

    row.appendChild(nameCell);
    row.appendChild(deleteCell);

    return row;
}

function createDeleteButton(item, index, isAllowedToDelete) {
    const button = document.createElement('button');
    const { label, color } = getButtonTextAndColour(isAllowedToDelete);

    button.textContent = label;
    button.style.backgroundColor = '#FF5555';
    button.style.color = color;
    button.style.border = 'none';
    button.style.padding = '5px 10px';
    button.style.borderRadius = '5px';
    button.style.cursor = 'pointer';

    button.onclick = () => {
        if (isAllowedToDelete) {
            removeItem(index);
        } else {
            const settingId = `site-->${item}`;
            ipcRenderer.send('prime-block-for-deletion', settingId);
        }
    };

    return button;
}

async function renderTable() {
    const tbody = document.querySelector('#data-table tbody');
    tbody.innerHTML = '';

    const list = await getListOfBlockedWebsites();

    const blockData = await ipcRenderer.invoke('getBlockData');
    const allowedWebsitesForDeletions = blockData.allowedForUnblockWebsites ?? [];

    if (list.length === 0) {
        tbody.appendChild(createEmptyRow("No websites blocked yet."));
        return;
    }

    list.forEach((item, index) => {
        const isAllowedToDelete = allowedWebsitesForDeletions.includes(item);
        const row = createDataRow(item, index, isAllowedToDelete);
        tbody.appendChild(row);
    });
}


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

async function saveBlockedWebsitesList(newList){
    const blockData = await ipcRenderer.invoke('getBlockData');
    const newData = {
        ...blockData,
        blockedWebsites: newList
    }
    ipcRenderer.send('saveData', {
        data: newData,
        fileName: 'blockData.json'
    });
}

function closeModal(modal){
    modal.style.display = 'none';
}

async function addToBlockListsForWebsites(modal, domain) {
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
        .then(async(isBlocked) => {
            if (isBlocked) {
                const blockData = await ipcRenderer.invoke('getBlockData');
                const blockedWebsites = blockData['blockedWebsites'] ?? [];
                if (!blockedWebsites.includes(domain)) {
                    blockedWebsites.push(domain);
                    blockData['blockedWebsites'] = blockedWebsites;
                    saveData(blockData, 'blockData.json');
                }
            }
            if(modal != null){
                closeModal(modal);
                void renderTable();
            }
        })
        .catch((error) => {
            console.log(error);
            alert("Unable to block given website");
        });
}

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
    const script = getScriptForBlockingWebsite(lines);

    return new Promise((resolve) => {
        const command = `node -e "${script.replace(/"/g, '\\"')}"`;
        sudoPrompt.exec(command, { name: 'Website Blocker' }, (error, stdout, stderr) => {
            if (error) {
                console.error(`❌ Failed to block ${baseDomain}:`, error.message || stderr);
                resolve(false);
                return;
            }
            resolve(true);
        });
    });
}

function unblockDomain(domain) {
    const HOSTS_FILE = 'C:\\Windows\\System32\\drivers\\etc\\hosts';
    let content = fs.readFileSync(HOSTS_FILE, 'utf8');

    const regex = new RegExp(`^.*127\\.0\\.0\\.1\\s+(www\\.)?${domain}.*$`, 'gm');
    const newContent = content.replace(regex, '').replace(/\n{2,}/g, '\n');

    fs.writeFileSync(HOSTS_FILE, newContent.trim() + os.EOL, 'utf8');
}

function saveData(data, fileName){
    ipcRenderer.send('saveData', {
        data,
        fileName
    });
}
