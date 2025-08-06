const { ipcRenderer } = require('electron');

const customRadio = document.getElementById('customRadio');
const customInput = document.getElementById('customInput');
const customDays = document.getElementById('customDays');

const confirmBtn = document.getElementById('confirmBtn');
const delayTimesDialog = document.getElementById("delayTimes");
const progressContainer = document.getElementById('progressContainer');

let delayTimeoutValue;

function validateForm() {
    confirmBtn.disabled = !shouldEnableConfirmButton();
}

function shouldEnableConfirmButton() {
    const selected = document.querySelector('input[name="delay"]:checked');
    if (!selected) {
        return false;
    }
    if (selected.value === 'custom') {
        const days = parseFloat(customDays.value);
        if (isNaN(days) || days <= 0 || delayTimeoutValue === days * 24 * 60 * 60 * 1000){
            return false;
        }
    }
    else {
        if (eval(selected.value) === delayTimeoutValue){
            return false;
        }
    }
    return true;
}

document.querySelectorAll('input[name="delay"]').forEach(radio => {
    radio.addEventListener('change', () => {
        customInput.style.display = customRadio.checked ? 'block' : 'none';
        validateForm();
    });
});

customDays.addEventListener('input', validateForm);

confirmBtn.addEventListener('click', () => {
    let selectedValue = eval(document.querySelector('input[name="delay"]:checked')?.value);

    if (selectedValue === 'custom') {
        const days = parseFloat(customDays.value);
        if (isNaN(days) || days <= 0) {
            alert("Please enter a valid custom delay in days.");
            return;
        }
        selectedValue = days * 24 * 60 * 60 * 1000;
    }
    else {
        selectedValue = parseInt(selectedValue);
    }

    if(selectedValue !== delayTimeoutValue) {
        if (selectedValue > delayTimeoutValue) {
            ipcRenderer.send('set-delay-timeout', selectedValue);
            confirmBtn.disabled = true;
            location.reload();
        }
        else {
            ipcRenderer.send('start-delay-timeout-change', selectedValue);
            showProgressBar(delayTimeoutValue, delayTimeoutValue);
        }
    }
});

ipcRenderer.on('delayTimeout', (event, status) => {
    console.log("delayValue (ms):", status);

    delayTimeoutValue = status.currentTimeout;

    if (!delayTimeoutValue || isNaN(delayTimeoutValue)) return;

    const radioButtons = document.querySelectorAll('input[name="delay"]');
    let matched = false;

    for (const radio of radioButtons) {
        const value = radio.value;

        if (value === 'custom') continue;

        try {
            const evaluated = eval(value);
            if (evaluated === delayTimeoutValue) {
                radio.checked = true;
                customInput.style.display = 'none';
                matched = true;
                break;
            }
        } catch (e) {
            console.warn(`Invalid radio value expression: ${value}`);
        }
    }

    if (!matched) {
        customRadio.checked = true;
        customInput.style.display = 'block';
        const days = delayTimeoutValue / (24 * 60 * 60 * 1000);
        customDays.value = days.toFixed(2);
    }

    if (status.isChanging) {
        showProgressBar(status.timeRemaining, status.currentTimeout);
    }


    validateForm();
});

const cancelButton = document.getElementById("cancelBtn");

if(cancelButton){
    cancelButton.addEventListener('click', () => {
        confirmBtn.disabled = true;
        progressContainer.style.display = 'none';
        delayTimesDialog.style.display = 'block';
        ipcRenderer.send('close-timer', 'delayTimeout');
    });
}

function showProgressBar(timeRemaining, currentTimeout){
    delayTimesDialog.style.display = 'none';
    progressContainer.style.display = 'block';

    const endTime = Date.now() + timeRemaining;

    const updateProgress = () => {
        const now = Date.now();
        const remaining = Math.max(endTime - now, 0);
        const percent = 100 - Math.floor((remaining / currentTimeout) * 100);

        document.getElementById('timeRemaining').innerText = `${Math.ceil(remaining / 1000)}s`;
        document.getElementById('progressBar').style.width = `${percent}%`;

        if (remaining <= 0) {
            clearInterval(interval);
            progressContainer.style.display = 'none';
            delayTimesDialog.style.display = 'block';
            confirmBtn.disabled = true;
        }
    };

    updateProgress();
    const interval = setInterval(updateProgress, 1000);
}