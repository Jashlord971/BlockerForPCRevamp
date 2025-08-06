const fs  = require("fs");
const {path} = require("path");
const {getInstalledApps}  = require("get-installed-apps");

const isUserApp = (app) => {
    if(app.hasOwnProperty("InstallLocation") &&app.hasOwnProperty("DisplayName") && app.hasOwnProperty("UninstallString")){
        const location = (app.InstallLocation ?? "").toLowerCase();
        return app.DisplayName && !location.includes('windows') && app.UninstallString;
    }
    return false;
}

const findExeInInstallLocation = (installLocation) => {
    if (!installLocation || !fs.existsSync(installLocation)) return null;

    const files = fs.readdirSync(installLocation);
    const exe = files.find(file => file.toLowerCase().endsWith('.exe'));
    return exe || null;
}

const getMatchFromName = (str = "") => {
    const match = str.match(/\\([^\\]+\.exe)/i);
    return match ? match[1].toLowerCase() : null;
}

const tryExeFromIcon = (iconPath) => {
    if (!iconPath || !iconPath.toLowerCase().endsWith('.ico')) return null;

    const exePath = iconPath.replace(/\.ico$/i, '.exe');
    if (fs.existsSync(exePath)) return path.basename(exePath);
    return null;
}

const extractProcessName = (displayIcon, uninstallString, installLocation) => {
    const matchFromDisplayIcon = getMatchFromName(displayIcon);
    if(matchFromDisplayIcon){
        return matchFromDisplayIcon;
    }

    const matchFromUnInstallString = getMatchFromName(uninstallString);
    if(matchFromUnInstallString){
        return matchFromUnInstallString;
    }

    const exeFromIconLocation = tryExeFromIcon(displayIcon);
    if(exeFromIconLocation){
        return exeFromIconLocation;
    }

    return findExeInInstallLocation(installLocation);
}

async function getInstalledAppInfo(){
    const apps = await getInstalledApps();

    return apps
        .filter(app => isUserApp(app))
        .map(app => {
            return {
                displayName: (app.hasOwnProperty("DisplayName") && app.DisplayName) ? app.DisplayName : app.appName,
                processName: extractProcessName(app.DisplayIcon , app.UninstallString, app.InstallLocation),
                iconPath: app.DisplayIcon,
                installationPath: app.InstallLocation
            }
        });
}

module.exports = {
    getInstalledAppInfo
}