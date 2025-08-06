const { ipcRenderer } = require('electron');

let settingId;
let remainingTime;

function init(){
    const modal = document.querySelector('.modal-content');
    const cancelBtn = document.getElementById('cancelBtn');
    const confirmBtn = document.getElementById('confirmBtn');

    if(cancelBtn){
        cancelBtn.addEventListener('click', () => {
            if(modal && modal.style && modal.style.display){
                modal.style.display = 'none';
            }
            console.log(settingId);
            ipcRenderer.send('cancel-delay-change', { settingId });
            closeModal();
        });
    }

    if(confirmBtn){
        confirmBtn.addEventListener('click', () => {
            if(modal){
                modal.style.display = 'none';
            }

            ipcRenderer.send('confirm-delay-accountability', settingId);
            closeModal();
        });
    }
}

init();

function closeModal(){
    ipcRenderer.send('close-delay-accountability-modal');
}

ipcRenderer.on('init-delay-modal', (event, { id, durationSeconds }) => {
    settingId = id;
    remainingTime = durationSeconds;

    if(remainingTime !== null){
        startCountdown(settingId, remainingTime);
    }

    console.log("currentSettingId: ",  settingId);
});

function startCountdown(settingId, durationSeconds) {
    const bar = document.getElementById('progress-bar');
    const label = document.getElementById('time-left');
    const idSpan = document.getElementById('setting-id');

    console.log("remainingTime:" + durationSeconds);
    let remaining = durationSeconds;
    idSpan.textContent = settingId;

    const update = () => {
        const percent = (remaining / durationSeconds) * 100;
        bar.style.width = `${percent}%`;

        const seconds = Math.floor((remaining / 1000) % 60);
        const minutes = Math.floor((remaining / (1000 * 60)) % 60);
        const hours = Math.floor((remaining / (1000 * 60 * 60)) % 24);
        const days = Math.floor(remaining / (1000 * 60 * 60 * 24));

        let timeStr = '';
        if (days > 0) {
            timeStr = `${days}d ${hours}h ${minutes}m`;
        } else if (hours > 0) {
            timeStr = `${hours}h ${minutes}m ${seconds}s`;
        } else if (minutes > 0) {
            timeStr = `${minutes}m ${seconds}s`;
        } else {
            timeStr = `${seconds}s`;
        }

        label.textContent = `Time left: ${timeStr}`;

        if (remaining <= 0) {
            clearInterval(timer);
            label.textContent = 'Timer ended';
            bar.style.background = '#dc3545';
        }

        remaining -= 1000;

        if(remaining <= 0){
            closeModal();
        }
    };

    update();
    const timer = setInterval(update, 1000);
}