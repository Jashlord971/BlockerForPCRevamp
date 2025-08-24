const { ipcRenderer } = require('electron');
const store = require('./store.js');

let allInstalledApps = [];
const key = 'blockedApps';

ipcRenderer.on('load-type', (event, type) => {
    renderTable();
});

function renderTable() {
    const list = store.get(key, []);
    const tbody = document.querySelector('#data-table tbody');
    tbody.innerHTML = '';

    list.forEach((item, index) => {
        const row = document.createElement('tr');

        const nameCell = document.createElement('td');
        nameCell.textContent = item.displayName;

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

window.removeItem = function(index) {
    const key = 'blockedApps';
    const list = store.get(key, []);
    list.splice(index, 1);
    store.set(key, list);
    renderTable();
};

window.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('modal');
    const input = document.getElementById('modal-input');
    const saveBtn = document.getElementById('save-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const addBtn = document.getElementById('add-btn');
    const topCancelButton = document.getElementById("closeAppModal");

    ipcRenderer.send('getAllInstalledApps');

    const title = document.getElementById('title');
    title.innerText = 'Blocked Apps';

    renderTable();

    addBtn.addEventListener('click', () => {
        const list = store.get('blockedApps', []);
        const blockedProcessNames = new Set(list.map(app => app.processName));
        const apps = allInstalledApps.filter(app => !blockedProcessNames.has(app.processName));
        renderAppSearchModal(apps);
    });

    cancelBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    saveBtn.addEventListener('click', () => {
        const value = input.value.trim();
        if (value){
            const list = store.get(key, []);
            list.push(value);
            store.set(key, list);
            renderTable();
            modal.style.display = 'none';
        }
    });

    topCancelButton.addEventListener('click', () => {
        modal.style.display = 'none';
    });
});

ipcRenderer.on('installedAppsResult', async (_, apps) => {
    allInstalledApps = apps.filter(app => app.displayName);
});

function renderAppSearchModal(apps) {
    const modal = document.getElementById('appSelectionModal');
    const tbody = document.getElementById('appList');
    const searchInput = document.getElementById('appSearchInput');
    const cancelBtn = document.getElementById('cancelSelectionBtn');
    const blockBtn = document.getElementById('blockSelectedBtn');

    const renderList = (filteredApps) => {
        tbody.innerHTML = '';

        filteredApps.forEach((app) => {
            const row = document.createElement('tr');

            const selectCell = document.createElement('td');
            selectCell.style.padding = '10px';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.dataset.processName = app.processName;
            checkbox.dataset.displayName = app.displayName;
            selectCell.appendChild(checkbox);

            const nameCell = document.createElement('td');
            nameCell.textContent = app.displayName;
            nameCell.style.padding = '10px';

            row.appendChild(selectCell);
            row.appendChild(nameCell);
            tbody.appendChild(row);
        });
    };

    searchInput.value = '';
    renderList(apps);

    searchInput.oninput = () => {
        const keyword = searchInput.value.toLowerCase();
        const filtered = apps.filter(app =>
            app.displayName.toLowerCase().includes(keyword)
        );
        renderList(filtered);
    };

    cancelBtn.onclick = () => {
        modal.style.display = 'none';
    };

    blockBtn.onclick = () => {
        const checkboxes = tbody.querySelectorAll('input[type="checkbox"]:checked');
        const key = 'blockedApps';
        const list = store.get(key, []);

        checkboxes.forEach(cb => {
            const processName = cb.dataset.processName;
            const alreadyBlocked = list.some(app => app.processName === processName);
            if (!alreadyBlocked) {
                const app = apps.find(a => a.processName === processName);
                if (app) list.push(app);
            }
        });

        store.set(key, list);
        renderTable();
        modal.style.display = 'none';
    };

    modal.style.display = 'block';
}