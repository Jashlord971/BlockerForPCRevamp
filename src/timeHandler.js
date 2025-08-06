const {savePreference, getJson, saveToPath} = require("./store.js");
const {ipcRenderer} = require("electron");
const timerPath = "data/timers.json";
const EventEmitter = require('events');


const timerEvents = new EventEmitter();

function reactivateTimers(activeTimers) {
    const data = getJson(timerPath);

    Object.keys(data).forEach(settingId => {
        const timer = data[settingId];
        const elapsed = Date.now() - timer.startTimeStamp;
        const remaining = timer.delayTimeout - elapsed;

        if (remaining > 0) {
            console.log("starting timer for :", settingId + " with a remaining time: ", remaining);
            startCountdownTimer(activeTimers, settingId, remaining);
        } else {
            handleExpiration(settingId, timer.targetTimeout);
        }
    });
}

function handleExpiration(settingId, targetTimeout){
    if(settingId === "delayTimeout"){
        savePreference(settingId, targetTimeout);
    }
    else{
        savePreference(settingId, false);
    }
    timerEvents.emit('expired', settingId);
}

function startCountdownTimer(activeTimers, settingId, remainingTime, targetTimeout = null) {
    //const delayTimeout = getPreference("delayTimeout", preferencesPath);
    const delayTimeout = 30000;
    const startTimeStamp = Date.now();
    const endTime = startTimeStamp + delayTimeout;

    const intervalId = setInterval(() => {
        const now = Date.now();
        const remaining = Math.max(endTime - now, 0);

        console.log(settingId + ": " + remaining);

        if (remaining <= 0) {
            clearInterval(intervalId);
            activeTimers.delete(settingId);

            handleExpiration(settingId, targetTimeout);

            const data = getJson(timerPath);
            if(data.hasOwnProperty(settingId)){
                delete data[settingId];
            }
            saveToPath(data, timerPath);
        } else {
            activeTimers.set(settingId, {
                intervalId,
                endTime
            });

            const data = getJson(timerPath);

            remainingTime = !remainingTime ? delayTimeout : remaining

            if(!data[settingId]){
                data[settingId] = {
                    delayTimeout,
                    remainingTime,
                    startTimeStamp,
                    targetTimeout
                }
            }

            saveToPath(data, timerPath);
        }
    }, 1000);

    activeTimers.set(settingId, {
        intervalId,
        endTime
    });

    console.log(`🟢 Started timer for ${settingId}`);
}

module.exports = {
    startCountdownTimer,
    reactivateTimers,
    timerEvents
}