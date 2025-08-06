document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM fully loaded and parsed');
    console.log('Window APIs:', {
        electronAPI: window.electronAPI,
        hasRequestCloseApp: !!window.electronAPI?.requestCloseApp
    });

    setUpAppInfo();
    initializeCloseButton();

    setupSwitch('overlaySwitch', 'Overlay');

    setupSwitch('blockSettingsSwitch', 'Block Settings', () => {
        if (window.electronAPI?.setDns) {
            window.electronAPI.setDns();
        }
    });

    setupSwitch('debugSwitch', 'Debug Logs');
});

function setupSwitch(id, name, callback) {
    const element = document.getElementById(id);
    if (!element) {
        console.error(`Element with ID ${id} not found`);
        return;
    }

    element.addEventListener('change', (e) => {
        console.log(`${name} toggled:`, e.target.checked);
        if (callback) callback(e);
    });
}

function setUpAppInfo(){
    if (window.electronAPI?.onAppInfo) {
        window.electronAPI.onAppInfo(({ displayName, processName }) => {
            const appNameElement = document.getElementById('appName');
            if (appNameElement) {
                appNameElement.textContent = displayName;
            }
            window.currentAppInfo = { displayName, processName };
        });
    }
}

function initializeCloseButton(){
    const closeButton = document.getElementById('closeBtn');
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            if (window.currentAppInfo && window.electronAPI?.requestCloseApp) {
                window.electronAPI.requestCloseApp(window.currentAppInfo);

                const loadingIcon = document.getElementById('loading');
                if(loadingIcon){
                    loadingIcon.style.display = 'block';
                }

                closeButton.disabled = true;
                closeButton.textContent = "Closing...";
            } else {
                throw new Error("Missing app info or electronAPI");
            }
        });
    }
}