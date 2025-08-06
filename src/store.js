const fs = require('fs');

const dataPath = "data/blockData.json";
const preferencesPath = "data/savedPreferences.json";

function readData() {
    if (!fs.existsSync(dataPath)) return { blockedApps: [], blockedWebsites: [] };
    const raw = fs.readFileSync(dataPath, 'utf-8');
    return JSON.parse(raw);
}

function writeData(data) {
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

function getJson(path){
    try{
        if (fs.existsSync(path)) {
            const content = fs.readFileSync(path, 'utf8');
            if (content.trim() !== '') {
                return JSON.parse(content);
            }
        }
    } catch (err) {
        console.error("Error reading existing preferences:", err);
    }
    return {};
}

function saveToPath(data, path){
    fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

function getPreference(id, path){
    try{
        if (fs.existsSync(path)) {
            const content = fs.readFileSync(path, 'utf8');
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
        fs.writeFileSync(preferencesPath, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("Error writing preferences:", err);
    }
}

function checkSavedPreferences(id) {
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
    get, set, getJson, getPreference, savePreference, checkSavedPreferences, saveToPath
}