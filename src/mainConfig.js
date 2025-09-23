const {ipcRenderer} = require("electron");

let preferencesCache = null;
let cachePromise = null;

const setChecked = (id, value) => {
    const element = document.getElementById(id);
    if (element) {
        element.checked = !!value;
    }
}

const showDelayChangeOrAccountabilityPartnerPrompt = (id) => ipcRenderer.send('show-delay-accountability-dialog', id);
const showDNSSelectionPrompt = () => ipcRenderer.send('show-dns-dialog');

function getPreferences() {
    if (cachePromise) {
        return cachePromise;
    }

    cachePromise = ipcRenderer.invoke('getPreferences')
        .then(prefs => {
            preferencesCache = prefs || {};
            return preferencesCache;
        })
        .catch(error => {
            console.error('Failed to get preferences:', error);
            preferencesCache = {};
            return preferencesCache;
        });

    return cachePromise;
}

function invalidateCache() {
    preferencesCache = null;
    cachePromise = null;
}

function checkSavedPreferences(id) {
    return getPreferences()
        .then(preferences => !!(preferences && preferences[id]))
        .catch(error => console.error("Encountered error when saving preferences:", error));
}

function isSafeSearchEnforced() {
    return ipcRenderer.invoke('isSafeSearchEnforced');
}

const pendingPreferenceUpdates = {};
let updateTimeout = null;

function savePreference(id, value) {
    pendingPreferenceUpdates[id] = value;

    if (updateTimeout) {
        clearTimeout(updateTimeout);
    }

    updateTimeout = setTimeout(() => {
        const updates = {...pendingPreferenceUpdates};
        Object.keys(pendingPreferenceUpdates).forEach(key => {
            delete pendingPreferenceUpdates[key];
        });

        getPreferences()
            .then(preferences => {
                Object.assign(preferences, updates);
                ipcRenderer.send('saveData', {
                    data: preferences,
                    fileName: 'savedPreferences.json'
                });
                invalidateCache();
            })
            .catch(error => console.error('Failed to save preferences:', error));
    }, 500);
}

function updateUIState() {
    const switchIds = [
        'enableProtectiveDNS',
        'overlayRestrictedContent',
        'blockSettingsSwitch',
        'appUninstallationProtection',
        'enforceSafeSearch',
        'maliciousAppBlacklist'
    ];

    return getPreferences()
        .then(preferences => {
            switchIds.forEach(id => {
                const element = document.getElementById(id);
                if (element) {
                    element.checked = !!(preferences && preferences[id]);
                }
            });
        })
        .catch(error => console.error('Failed to update UI state:', error));
}

function initializeOverlaySettingSwitch() {
    const id = "overlayRestrictedContent";
    const overlaySettingsSwitch = document.getElementById(id);

    if (!overlaySettingsSwitch || overlaySettingsSwitch._hasListener) return;
    overlaySettingsSwitch._hasListener = true;

    overlaySettingsSwitch.addEventListener("change", () => {
        checkSavedPreferences(id)
            .then(savedValue => {
                if (savedValue === true) {
                    overlaySettingsSwitch.checked = true;
                    showDelayChangeOrAccountabilityPartnerPrompt(id);
                } else {
                    savePreference(id, true);
                }
            })
            .catch(error => console.error('Error in overlay switch:', error));
    });
}

function initializeProtectiveDNS() {
    const id = "enableProtectiveDNS";
    const protectiveDNS = document.getElementById(id);

    if (!protectiveDNS || protectiveDNS._hasListener) return;
    protectiveDNS._hasListener = true;

    protectiveDNS.addEventListener("change", () => {
        Promise.all([
            checkSavedPreferences(id),
            ipcRenderer.invoke('check-dns-safety')
        ])
            .then(([savedValue, isDnsSafeAlready]) => {
                if (isDnsSafeAlready && !savedValue) {
                    protectiveDNS.checked = true;
                    savePreference(id, true);
                } else if (savedValue) {
                    protectiveDNS.checked = true;
                    showDelayChangeOrAccountabilityPartnerPrompt(id);
                } else {
                    protectiveDNS.checked = false;
                    showDNSSelectionPrompt();
                }
            })
            .catch(error => console.error('Error in DNS switch:', error));
    });
}

function settingsProtectionSwitch() {
    const id = 'blockSettingsSwitch';
    const settingsProtection = document.getElementById(id);
    if (!settingsProtection || settingsProtection._hasListener) return;
    settingsProtection._hasListener = true;

    settingsProtection.addEventListener("change", () => {
        checkSavedPreferences(id)
            .then(savedValue => {
                if (savedValue) {
                    settingsProtection.checked = true;
                    showDelayChangeOrAccountabilityPartnerPrompt(id);
                } else {
                    return checkSavedPreferences(id)
                        .then(currentValue => {
                            savePreference(id, !currentValue);
                            return ipcRenderer.invoke('activateSettingsProtection');
                        });
                }
            })
            .catch(error => console.error('Error in settings protection switch:', error));
    });
}

function initializeSafeSearchSwitch() {
    const id = "enforceSafeSearch";
    const safeSearchSwitch = document.getElementById(id);

    if (!safeSearchSwitch || safeSearchSwitch._hasListener) return;
    safeSearchSwitch._hasListener = true;

    safeSearchSwitch.addEventListener("change", () => {
        Promise.all([
            checkSavedPreferences(id),
            isSafeSearchEnforced()
        ])
            .then(([savedValue, isSafeSearchEnforcedValue]) => {
                if (isSafeSearchEnforcedValue && !savedValue) {
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
            })
            .catch(error => console.error('Error in safe search switch:', error));
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

function turnOnAppProtection() {
    ipcRenderer.send('turnOnAppProtection');
}

function turnOnSettingsProtection() {
    ipcRenderer.send('turnOnSettingsProtection');
}

function turnOnSettings() {
    turnOnAppProtection();
    turnOnSettingsProtection();
}

function initializeEventListeners() {
    initializeOverlaySettingSwitch();
    initializeProtectiveDNS();
    settingsProtectionSwitch();
    initializeSafeSearchSwitch();
    initializeTooltips();
}

function init() {
    initializeEventListeners();
    updateUIState()
        .then(() => turnOnSettings())
        .catch(error => console.error('Initialization error:', error));
    initNavBar();
}


function initNavBar(){
    const homeButton = document.getElementById("home");
    homeButton.addEventListener("click", (e) => {
        ipcRenderer.send('openMainConfig');
    });

    const openBlockApps = document.getElementById("blockApps");
    openBlockApps.addEventListener("click", (e) => {
        ipcRenderer.send('openBlockApps');
    });
}

ipcRenderer.on('turnOffSetting', (event, id) => {
    setChecked(id, false);
    invalidateCache();
});

ipcRenderer.on('refreshMainConfig', () => {
    invalidateCache();
    updateUIState()
        .then(() => turnOnSettings())
        .catch(error => console.error('Initialization error:', error));
});

window.addEventListener('DOMContentLoaded', () => init());