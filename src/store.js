const path = require('path');
const fs = require('fs');

let dataPath, preferencesPath, mainPath, timerPath;
let isInitialized = false;

async function init(){
    mainPath = 'C\\Users\\Admin\\AppData\\Roaming\\data';
    dataPath = path.join(mainPath, "blockData.json");
    timerPath = path.join(mainPath, 'timers.json');
    preferencesPath = path.join(mainPath, 'savedPreferences.json');
    isInitialized = true;
}

function saveToPath(data, filename) {
    if (!mainPath) {
        throw new Error('Data manager not initialized. Call init() first.');
    }

    const fullPath = path.join(mainPath, filename);

    if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isDirectory()) {
        fs.rmdirSync(fullPath, { recursive: true });
    }

    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, JSON.stringify(data, null, 2));
}

function readData() {
    const defaultBlockData =  {
        blockedApps: [],
        blockedWebsites: [],
        allowedForUnblockWebsites: [],
        allowedForUnblockApps: []
    }

    if (!fs.existsSync(dataPath)){
        return defaultBlockData;
    }

    try {
        const raw = fs.readFileSync(dataPath, 'utf-8');
        return JSON.parse(raw);
    } catch (err) {
        console.error(`[readData] Failed to read or parse data from ${dataPath}:`, err);
        return defaultBlockData;
    }
}

function writeData(data) {
    const dir = path.dirname(dataPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
}

function get(key) {
    const data = readData();
    return data[key] || [];
}

function set(key, list) {
    const data = readData();
    data[key] = list;
    writeData(data);
}

async function getJson(filePath){
    try{
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            if (content.trim() !== '') {
                return JSON.parse(content);
            }
        }
    } catch (err) {
        console.error("Error reading JSON file:", err);
    }
    return {};
}

async function getPreference(id, filePath){
    const pathToUse = filePath || preferencesPath;

    try{
        if (fs.existsSync(pathToUse)) {
            const content = fs.readFileSync(pathToUse, 'utf8');
            if (content.trim() !== '') {
                const data = JSON.parse(content);
                if(data.hasOwnProperty(id)){
                    return data[id];
                }
            }
        }
    } catch (err) {
        console.error("Error reading existing preferences:", err);
    }
    return null;
}

function savePreference(id, value) {
    let data = {};
    try {
        if (fs.existsSync(preferencesPath)) {
            const content = fs.readFileSync(preferencesPath, 'utf8');
            if (content.trim() !== '') {
                data = JSON.parse(content);
            }
        }
    } catch (err) {
        console.error("Error reading existing preferences:", err);
    }

    data[id] = value;

    try {
        const dir = path.dirname(preferencesPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(preferencesPath, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Error writing preferences:", err);
    }
}

async function checkSavedPreferences(id) {
    try {
        if (fs.existsSync(preferencesPath)) {
            const content = fs.readFileSync(preferencesPath, 'utf8');
            if (content.trim() === ''){
                return false;
            }

            const data = JSON.parse(content);
            return data[id];
        }
    } catch (err) {
        console.error("Error reading saved preferences:", err);
    }
    return false;
}

module.exports = {
    init,
    get,
    set,
    getJson,
    getPreference,
    savePreference,
    checkSavedPreferences,
    saveToPath,
    readData,
    writeData
}