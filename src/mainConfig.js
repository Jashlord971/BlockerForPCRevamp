const {ipcRenderer} = require("electron");
const {isSafeSearchEnforced} = require("./safeSearchEnforcer");
const {appBlockProtection, settingsProtectionOn} = require("./blockProtection");

const setChecked = (id, value) => {
    const element = document.getElementById(id);
    if (element) {
        element.checked = !!value;
    }
}

const showDelayChangeOrAccountabilityPartnerPrompt = (id) => ipcRenderer.send('show-delay-accountability-dialog', id);

const showDNSSelectionPrompt = () => ipcRenderer.send('show-dns-dialog');

async function updateUIState() {
    const switchIds = [
        'enableProtectiveDNS',
        'overlayRestrictedContent',
        'blockSettingsSwitch',
        'appUninstallationProtection',
        'enforceSafeSearch'
    ];

    for (const id of switchIds) {
        const element = document.getElementById(id);
        if (element) {
            const value = await checkSavedPreferences(id);
            element.checked = !!value;
        }
    }
}

function initializeOverlaySettingSwitch() {
    const id = "overlayRestrictedContent";
    const overlaySettingsSwitch = document.getElementById(id);

    if (!overlaySettingsSwitch || overlaySettingsSwitch._hasListener) return;
    overlaySettingsSwitch._hasListener = true;

    overlaySettingsSwitch.addEventListener("change", async () => {
        const savedValue = await checkSavedPreferences(id);

        if (savedValue === true) {
            overlaySettingsSwitch.checked = true;
            showDelayChangeOrAccountabilityPartnerPrompt(id);
        } else {
            void savePreference(id, true);
        }
    });
}

function turnOnSettings(){
    appBlockProtection();
    settingsProtectionOn();
}

const checkDnsSafety = async () => await ipcRenderer.invoke('check-dns-safety');

function initializeProtectiveDNS() {
    const id = "enableProtectiveDNS";
    const protectiveDNS = document.getElementById(id);

    if (!protectiveDNS || protectiveDNS._hasListener) return;
    protectiveDNS._hasListener = true;

    protectiveDNS.addEventListener("change", async () => {
        const savedValue = await checkSavedPreferences(id);
        const isDnsSafeAlready = await checkDnsSafety();

        if (isDnsSafeAlready && !!!savedValue) {
            protectiveDNS.checked = true;
            void savePreference(id, true);
        } else if (!!savedValue) {
            protectiveDNS.checked = true;
            showDelayChangeOrAccountabilityPartnerPrompt(id);
        } else {
            protectiveDNS.checked = false;
            showDNSSelectionPrompt();
        }
    });
}

function initializeGenericSwitch(id) {
    const settingsProtection = document.getElementById(id);
    if (!settingsProtection || settingsProtection._hasListener) return;
    settingsProtection._hasListener = true;

    settingsProtection.addEventListener("change", async () => {
        const savedValue = await checkSavedPreferences(id);
        if (!!savedValue) {
            settingsProtection.checked = true;
            showDelayChangeOrAccountabilityPartnerPrompt(id);
        } else {
            const currentValue = await checkSavedPreferences(id);
            void savePreference(id, !currentValue);
        }
    });
}

function initializeSafeSearchSwitch() {
    const id = "enforceSafeSearch";
    const safeSearchSwitch = document.getElementById(id);

    if (!safeSearchSwitch || safeSearchSwitch._hasListener) return;
    safeSearchSwitch._hasListener = true;

    safeSearchSwitch.addEventListener("change", async () => {
        const savedValue = await checkSavedPreferences(id);

        if (isSafeSearchEnforced() && !savedValue) {
            safeSearchSwitch.checked = true;
            void savePreference(id, true);
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

function initializeTooltips() {
    const tooltipsInitialized = document.body.dataset.tooltipsInitialized;
    if (tooltipsInitialized) return;
    document.body.dataset.tooltipsInitialized = 'true';

    document.querySelectorAll('.info-icon').forEach(icon => {
        icon.addEventListener('mouseenter', () => {
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
}

function initializeEventListeners() {
    initializeOverlaySettingSwitch();
    initializeProtectiveDNS();
    initializeGenericSwitch('blockSettingsSwitch');
    initializeGenericSwitch('appUninstallationProtection');
    initializeSafeSearchSwitch();
    initializeTooltips();
}

function init() {
    initializeEventListeners();
    updateUIState()
        .then(() => turnOnSettings());
}

ipcRenderer.on('turnOffSetting', (event, id) => setChecked(id, false));

ipcRenderer.on('refreshMainConfig', () => updateUIState());

window.addEventListener('DOMContentLoaded', () => init());

async function checkSavedPreferences(id){
    const preferences = await ipcRenderer.invoke('getPreferences');
    return preferences && !!preferences[id];
}

async function savePreference(id, value){
    const preferences = await ipcRenderer.invoke('getPreferences');
    preferences[id] = value;
    ipcRenderer.send('saveData', {
        data: preferences,
        fileName: 'savedPreferences.json'
    });
}
