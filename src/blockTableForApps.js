const { ipcRenderer } = require('electron');
const filename = 'blockData.json';
const _ = require('lodash');

ipcRenderer.on('renderLatestTable', () => renderTable());

let blockedApps;
let allInstalledApps;

function processBlockedAppsAndRenderTable(list){
    blockedApps = Object.assign(blockedApps, list);
    const tbody = document.querySelector('#data-table tbody');
    tbody.innerHTML = '';

    list.forEach((item, index) => {
        if(!document){
            return;
        }
        const row = document.createElement('tr');

        const nameCell = document.createElement('td');
        nameCell.textContent = item.displayName;

        const deleteCell = document.createElement('td');
        const deleteButton = getDeleteButton();
        deleteButton.onclick = () => removeItem(index);
        deleteCell.appendChild(getDeleteButton());

        row.appendChild(nameCell);
        row.appendChild(deleteCell);
        tbody.appendChild(row);
    });
}

async function renderTable(list = null) {
    if(list){
        return processBlockedAppsAndRenderTable(list);
    }
    return getBlockedAppsList()
        .then(list => {
            blockedApps = list;
            processBlockedAppsAndRenderTable(blockedApps);
        });
}

function getDeleteButton(text = 'Delete') {
    const button = document.createElement('button');
    button.textContent = text;
    button.style.backgroundColor = '#FF5555';
    button.style.color = '#fff';
    button.style.border = 'none';
    button.style.padding = '5px 10px';
    button.style.borderRadius = '5px';
    button.style.cursor = 'pointer';
    return button;
}

async function removeItemAtIndex (index){
    return getBlockedAppsList()
        .then(list => {
            if(!list || list.length === 0){
                return;
            }
            list.splice(index, 1);
            return saveBlockedAppsList(list)
                .then(() => {
                    console.log("Deletion of object at index: " + index + " was successful");
                    renderTable(list);
                })
                .catch(error => console.log(error));
        })
        .catch(() => undefined);
}

window.removeItem = async function(index) {
    await removeItemAtIndex(index);
}

async function getAllInstalledApps(){
    return await ipcRenderer.invoke('getAllInstalledApps');
}

window.addEventListener('DOMContentLoaded', async () => {
    const modal = document.getElementById('modal');
    const input = document.getElementById('modal-input');
    const saveBtn = document.getElementById('save-btn');
    const cancelBtn = document.getElementById('cancel-btn');
    const addBtn = document.getElementById('add-btn');

    const title = document.getElementById('title');
    title.innerText = 'Blocked Apps';

    void renderTable();

    getAllInstalledApps()
        .then(installedApps => allInstalledApps = installedApps);

    getBlockedAppsList()
        .then(givenBlockedApps => blockedApps = givenBlockedApps);

    addBtn.addEventListener('click', () => {
        const blockedProcessNames = new Set(blockedApps.map(app => app.processName));
        const apps = allInstalledApps.filter(app => !blockedProcessNames.has(app.processName));
        renderAppSearchModal(apps);
    });

    cancelBtn.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    saveBtn.addEventListener('click', () => {
        const attribute = 'value';
        const value = (input[attribute]).trim();

        if(!value){
            return;
        }

        return ipcRenderer.invoke('getBlockData')
            .then(blockData => {
                const list = blockData.blockedApps;
                list.push(value);
                blockData.blockedApps = list;
                ipcRenderer.send('saveData', {
                    data: blockData,
                    fileName: filename
                });
                return renderTable();
            })
            .then(() => modal.style.display = 'none');
    });
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
            console.log(app.displayName);
            nameCell.textContent = app.displayName;
            nameCell.style.padding = '10px';
            nameCell.style.color = 'black';

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

    blockBtn.onclick = async () => {
        const checkboxes = tbody.querySelectorAll('input[type="checkbox"]:checked');
        const list = await getBlockedAppsList();

        checkboxes.forEach(cb => {
            const processName = cb?.dataset?.processName;
            const alreadyBlocked = list.some(app => app.processName === processName);
            if (!alreadyBlocked) {
                const app = apps.find(a => a.processName === processName);
                if (app) list.push(app);
            }
        });

        return saveBlockedAppsList(list)
            .then(async () => {
                await renderTable();
                modal.style.display = 'none';
            })
            .catch(error => console.log(error));
    };

    modal.style.display = 'block';

    const appSelectionModal = document.getElementById('appSelectionModal');
    const topCancelButton = document.getElementById("closeAppModal");
    topCancelButton.addEventListener('click', () => {
        appSelectionModal.style.display = 'none';
    });
}

async function getBlockedAppsList(){
    const blockData = await ipcRenderer.invoke('getBlockData');
    return blockData.blockedApps || [];
}

async function saveBlockedAppsList(newList){
    const blockData = await ipcRenderer.invoke('getBlockData');
    const newData = {
        ...blockData,
        blockedApps: newList
    }
    ipcRenderer.send('saveData', {
        data: newData,
        fileName: filename
    });
}