document.addEventListener('DOMContentLoaded', () => {
    setUpAppInfo();
    initializeCloseButton();
    hideElement('hidden');
    setUpAltCloseButton();
});

function setUpAltCloseButton() {
    const altButton = document.getElementById("altButton");
    if (!altButton) return;

    altButton.addEventListener("click", () => {
        window.electronAPI.closeOverlay();
    });
}


function setUpAppInfo(){
    if (window.electronAPI?.onAppInfo) {
        window.electronAPI.onAppInfo(({ displayName, processName, isManualOverrideAllowed }) => {
            const appNameElement = document.getElementById('appName');
            if (appNameElement) {
                appNameElement.textContent = displayName;
            }
            window.currentAppInfo = { displayName, processName , isManualOverrideAllowed};
        });
    }
}

function showElement(id) {
    document.getElementById(id).style.display = "block";
}

function hideElement(id) {
    document.getElementById(id).style.display = "none";
}

function initializeCloseButton(){
    const closeButton = document.getElementById('closeBtn');
    if(!closeButton){
        return;
    }
    closeButton.addEventListener('click', () => {
        if (window.currentAppInfo && window.electronAPI?.requestCloseApp) {
            window.electronAPI.requestCloseApp(window.currentAppInfo);

            const loadingIcon = document.getElementById('loading');
            if(loadingIcon){
                loadingIcon.style.display = 'block';
            }

            closeButton.disabled = true;
            closeButton.textContent = "Closing...";

            setTimeout(() => {
                showElement('hidden');
                hideElement('shown');
            }, 60_000);
        }
        else {
            throw new Error("Missing app info or electronAPI");
        }
    });
}