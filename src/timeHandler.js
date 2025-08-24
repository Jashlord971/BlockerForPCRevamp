const EventEmitter = require('events');
const {readData, savePreference, writeData} = require("./store");

const timerEvents = new EventEmitter();

function reactivateTimers(activeTimers) {
    const data = readData();

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
    const delimiter = '-->';
    if(settingId === "delayTimeout"){
        savePreference(settingId, targetTimeout);
    }
    else if(settingId.includes(delimiter)){
        const splits = settingId.split(delimiter);
        const key = splits[0];
        const item = splits[1];

        const keyInBlockData = (key === 'site') ? 'allowedForUnblockWebsites' : 'allowedForUnblockApps';
        let blockData = readData();
        if(!blockData.hasOwnProperty(keyInBlockData)){
            blockData[keyInBlockData] = [];
        }

        blockData[keyInBlockData].push(item);
        timerEvents.emit('renderTableCall');
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
    const mainData = readData();

    const intervalId = setInterval(() => {
        const now = Date.now();
        const remaining = Math.max(endTime - now, 0);

        console.log(settingId + ": " + remaining);
        const data = mainData?.timerInfo ?? {};

        if (remaining <= 0) {
            clearInterval(intervalId);
            activeTimers.delete(settingId);

            void handleExpiration(settingId, targetTimeout);

            if(data.hasOwnProperty(settingId)){
                delete data[settingId];
            }
        } else {
            activeTimers.set(settingId, {
                intervalId,
                endTime
            });

            remainingTime = !remainingTime ? delayTimeout : remaining

            if(!data[settingId]){
                data[settingId] = {
                    delayTimeout,
                    remainingTime,
                    startTimeStamp,
                    targetTimeout
                }
            }
        }

        void writeData({
            ...mainData,
            timerInfo: data
        });

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