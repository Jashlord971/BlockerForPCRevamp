const {ipcRenderer} = require("electron");
const {get, set} = require("./store");
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
        list.forEach((item, index) => {
            const row = document.createElement('tr');

            const nameCell = document.createElement('td');
            nameCell.textContent = typeof item === 'string' ? item : item.displayName;

            const deleteCell = document.createElement('td');
            const deleteButton = document.createElement('button');
            deleteButton.textContent = 'Delete';
            deleteButton.style.backgroundColor = '#FF5555';
            deleteButton.style.color = '#fff';
            deleteButton.style.border = 'none';
            deleteButton.style.padding = '5px 10px';
            deleteButton.style.borderRadius = '5px';
            deleteButton.style.cursor = 'pointer';
            deleteButton.onclick = () => removeItem(index);
            deleteCell.appendChild(deleteButton);

            row.appendChild(nameCell);
            row.appendChild(deleteCell);
            tbody.appendChild(row);
        });
    }
}

window.removeItem = function(index) {
    const list = get(key, []);
    list.splice(index, 1);
    set(key, list);
    renderTable();
};

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

    cancelBtn.addEventListener('click', () => modal.style.display = 'none');

    saveBtn.addEventListener('click', async () => {
        const value = input.value.trim();
        if (!value) return;

        try {
            const success = await addToBlockListsForWebsites(value);
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

async function addToBlockListsForWebsites(domain) {
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

    return new Promise((resolve, reject) => {
        ipcRenderer.send('addWebsiteToHostsFile', { domain: baseDomain });
        ipcRenderer.once('websiteBlockedSuccess', () => resolve(true));
        ipcRenderer.once('websiteBlockedError', (event, error) => reject(new Error(error)));
    });
}


