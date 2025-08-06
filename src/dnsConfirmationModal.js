const { ipcRenderer } = require('electron');

const radioButtons = document.querySelectorAll('input[name="approvalOption"]');
const modal = document.querySelector('.modal-content');
const cancelBtn = document.getElementById('cancelBtn');
const confirmBtn = document.getElementById('confirmBtn');

cancelBtn.addEventListener('click', () => {
    modal.style.display = 'none';
});

radioButtons.forEach(radio => {
    radio.addEventListener('change', (event) => {
        confirmBtn.disabled = !event.target.checked;
    });
});

confirmBtn.addEventListener('click', () => {
    const selectedOption = document.querySelector('input[name="approvalOption"]:checked').value;
    const isStrict = (selectedOption === "strict");
    turnOnDNS(isStrict);
    modal.style.display = 'none';
});

function turnOnDNS(isStrict){
    ipcRenderer.send('set-dns', [
        {
            isStrict: isStrict
        }
    ]);
}

//TODO: Needs logic to handle if a user disable the dns and controlling whether we turn on the dns if the user has given permission or taken it away