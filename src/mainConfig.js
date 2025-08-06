const {ipcRenderer} = require("electron");
const {checkSavedPreferences, savePreference}  = require("./store.js");
const {isSafeSearchEnforced} = require("./safeSearchEnforcer");

const setChecked = (id, value) => {
    const element = document.getElementById(id);
    if (element) {
        element.checked = !!value;
    }
}

const showDelayChangeOrAccountabilityPartnerPrompt= (id) => ipcRenderer.send('show-delay-accountability-dialog', id);

const showDNSSelectionPrompt = () => ipcRenderer.send('show-dns-dialog');

function reflectSavedChanges() {
    const switchIds = [
        'enableProtectiveDNS',
        'overlayRestrictedContent',
        'blockSettingsSwitch',
        'appUninstallationProtection'
    ];

    switchIds.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            const value = checkSavedPreferences(id);
            element.checked = !!value;
        }
    });
}

function initializeOverlaySettingSwitch() {
    const id = "overlayRestrictedContent";
    const overlaySettingsSwitch = document.getElementById(id);

    if (overlaySettingsSwitch) {
        overlaySettingsSwitch.addEventListener("change", function (e) {
            const savedValue = checkSavedPreferences(id);

            if (savedValue === true) {
                overlaySettingsSwitch.checked = true;
                showDelayChangeOrAccountabilityPartnerPrompt(id);
            } else {
                savePreference(id, true);
            }
        });
    }
}

const checkDnsSafety = async () => await ipcRenderer.invoke('check-dns-safety');

function initializeProtectiveDNS(){
    const id = "enableProtectiveDNS";
    const protectiveDNS = document.getElementById(id);

    if(!protectiveDNS || protectiveDNS._hasListener){
        return;
    }
    protectiveDNS._hasListener = true;

    protectiveDNS.addEventListener("change", async() => {
        const savedValue = checkSavedPreferences(id);

        const isDnsSafeAlready = await checkDnsSafety();

        if(isDnsSafeAlready && !!!savedValue){
            protectiveDNS.checked = true;
            savePreference(id, true);
        }
        else if(!!savedValue){
            protectiveDNS.checked = true;
            showDelayChangeOrAccountabilityPartnerPrompt(id);
        }
        else{
            protectiveDNS.checked = false;
            showDNSSelectionPrompt();
        }
    });
}

function initializeGenericSwitch(id){
    const settingsProtection = document.getElementById(id);
    if(!settingsProtection){
        return;
    }
    settingsProtection.addEventListener("change", () => {
        const savedValue = checkSavedPreferences(id);
        if(!!savedValue){
            settingsProtection.checked = true;
            showDelayChangeOrAccountabilityPartnerPrompt(id);
        }
        else{
            savePreference(id, true);
        }
    });
}

ipcRenderer.on('turnOffSetting', (event, id) => setChecked(id, false));

function initializeSafeSearchSwitch() {
    const id = "enforceSafeSearch";
    const safeSearchSwitch = document.getElementById(id);

    if (!safeSearchSwitch || safeSearchSwitch._hasListener) return;
    safeSearchSwitch._hasListener = true; // Mark as initialized

    safeSearchSwitch.addEventListener("change", () => {
        const savedValue = checkSavedPreferences(id);

        if (isSafeSearchEnforced() && !savedValue) {
            safeSearchSwitch.checked = true;
            savePreference(id, true);
            return;
        }

        if (savedValue) {
            safeSearchSwitch.checked = true;
            showDelayChangeOrAccountabilityPartnerPrompt(id);
        } else {
            safeSearchSwitch.checked = false;
            ipcRenderer.send('enforce-safe-search');
        }
    });
}

document.querySelectorAll('.info-icon').forEach(icon => {
    icon.addEventListener('mouseenter', (e) => {
        const existing = document.querySelector('.tooltip-box');
        if (existing) existing.remove();

        const tooltip = document.createElement('div');
        tooltip.className = 'tooltip-box';
        tooltip.innerText = icon.getAttribute('data-description');
        document.body.appendChild(tooltip);

        const rect = icon.getBoundingClientRect();
        const tooltipWidth = 250;
        const offset = 10;
        tooltip.style.top = (rect.top + window.scrollY + 5) + 'px';
        tooltip.style.left = (rect.left + window.scrollX - tooltipWidth - offset) + 'px';
        tooltip.style.display = 'block';

        icon._tooltip = tooltip;
    });

    icon.addEventListener('mouseleave', () => {
        if (icon._tooltip) {
            icon._tooltip.remove();
            icon._tooltip = null;
        }
    });
});

function init() {
    reflectSavedChanges();
    initializeOverlaySettingSwitch();
    initializeProtectiveDNS();
    initializeGenericSwitch('blockSettingsSwitch');
    initializeGenericSwitch('appUninstallationProtection');
    initializeSafeSearchSwitch();
}

ipcRenderer.on('refreshMainConfig', () => init());

window.addEventListener('DOMContentLoaded', () => init());