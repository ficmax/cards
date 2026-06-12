// --- Application State & Config ---
const GITHUB_OWNER = "ficnerm"; // CHANGE THIS TO YOUR USERNAME
const GITHUB_REPO = "cards";
const CARDS_FOLDER = "cards";
const DATA_BRANCH = "data"; // The branch where progress is saved

const SAVE_THRESHOLD = 5;       // Save to GitHub after 5 evaluated cards
const SAVE_INTERVAL_MS = 60000; // Background timer: Save every 60 seconds

const AppState = {
    syncMode: 'local', 
    token: null,       
    deckId: null,      
    meta: {},          
    deck: [],          
    currentIndex: -1,
    unsavedChanges: 0  // Tracks cards evaluated since last save
};

// --- Initialization ---
document.addEventListener("DOMContentLoaded", async () => {
    const savedToken = localStorage.getItem('anki_github_token');
    if (savedToken) {
        AppState.token = savedToken;
        AppState.syncMode = 'github';
        updateSyncBadge("Cloud Sync Active", "#4caf50", "white");
    }
    await populateDecksDropdown();
});

function updateSyncBadge(text, bg, color) {
    const badge = document.getElementById('sync-status-badge');
    if(badge) {
        badge.innerText = text;
        badge.style.background = bg;
        badge.style.color = color || "black";
    }
}

// --- File Discovery (API Call) ---
async function populateDecksDropdown() {
    const dropdown = document.getElementById('public-decks-dropdown');
    dropdown.innerHTML = '<option value="">Loading decks...</option>';

    try {
        // Always read the list of available decks from the main branch
        const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${CARDS_FOLDER}`;
        const response = await fetch(url);
        const files = await response.json();

        dropdown.innerHTML = '<option value="">-- Select a deck --</option>';
        files.forEach(file => {
            if (file.name.endsWith('.json')) {
                const option = document.createElement('option');
                option.value = file.path; 
                option.innerText = file.name.replace('.json', '');
                dropdown.appendChild(option);
            }
        });
    } catch (error) {
        dropdown.innerHTML = '<option value="">Failed to load decks.</option>';
        console.error(error);
    }
}

// --- Loading Data ---
async function loadSelectedPublicDeck() {
    const path = document.getElementById('public-decks-dropdown').value;
    if (!path) return alert("Please select a deck.");
    
    AppState.deckId = path;

    if (AppState.syncMode === 'github') {
        // Cloud Mode: Try to fetch progress from the 'data' branch first
        try {
            const dataBranchUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}?ref=${DATA_BRANCH}`;
            const res = await fetch(dataBranchUrl, { headers: { 'Authorization': `token ${AppState.token}` } });
            
            if (res.ok) {
                const apiData = await res.json();
                const decodedStr = decodeURIComponent(escape(atob(apiData.content)));
                return setupDeck(JSON.parse(decodedStr), path);
            }
            // If res is not ok (e.g. 404), it means we haven't saved progress yet. Fall through to fetch main branch.
        } catch(e) {
            console.log("No progress found in data branch. Loading original file.");
        }
    }

    // Local Mode OR Cloud Mode fallback (fetching clean deck from main branch)
    try {
        const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
        const apiRes = await fetch(url); // No token needed for public main branch
        const apiData = await apiRes.json();
        const decodedStr = decodeURIComponent(escape(atob(apiData.content)));
        setupDeck(JSON.parse(decodedStr), path);
    } catch (error) {
        alert("Failed to load deck.");
        console.error(error);
    }
}

function loadUploadedFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    AppState.deckId = file.name;
    AppState.syncMode = 'local'; // Force local mode for uploads
    updateSyncBadge("Local Save Mode", "#eee", "black");

    const reader = new FileReader();
    reader.onload = function(e) {
        setupDeck(JSON.parse(e.target.result), file.name);
    };
    reader.readAsText(file);
}

function setupDeck(fileContent, storageKey) {
    AppState.meta = fileContent.meta || { title: "Untitled Deck" };
    document.getElementById('deck-title-display').innerText = AppState.meta.title;

    let rawCards = fileContent.cards || [];

    if (AppState.syncMode === 'local') {
        const savedData = JSON.parse(localStorage.getItem(`progress_${storageKey}`)) || {};
        AppState.deck = rawCards.map(card => {
            const savedStats = savedData[card.question] || {};
            return {
                question: card.question,
                answer: card.answer,
                value: savedStats.value !== undefined ? savedStats.value : 0,
                repeats: savedStats.repeats || 0,
                history: savedStats.history || []
            };
        });
    } else {
        // If Cloud Sync is active, the file either came from 'data' (with progress) or 'main' (clean).
        AppState.deck = rawCards.map(card => ({
            question: card.question,
            answer: card.answer,
            value: card.value !== undefined ? card.value : 0,
            repeats: card.repeats || 0,
            history: card.history || []
        }));
    }

    document.getElementById('range-max').value = AppState.deck.length - 1;
    document.getElementById('setup-section').classList.add('hidden');
    document.getElementById('study-section').classList.remove('hidden');

    // Start the background save timer
    startAutoSave();
}

// --- Admin Login Logic ---
function toggleAdminLogin() {
    document.getElementById('admin-login-section').classList.toggle('hidden');
}

function saveAdminToken() {
    const token = document.getElementById('admin-token').value;
    if (!token) return;
    localStorage.setItem('anki_github_token', token);
    alert("Admin login saved!");
    location.reload(); 
}

// --- Core Study Logic ---
function pickNextCard() {
    const min = parseInt(document.getElementById('range-min').value);
    const max = parseInt(document.getElementById('range-max').value);
    
    let availableCards = AppState.deck
        .map((card, index) => ({ card, index }))
        .filter(item => item.index >= min && item.index <= max);

    if (availableCards.length === 0) return alert("No cards in that range!");

    let totalWeight = 0;
    const weightedCards = availableCards.map(item => {
        let weight = getWeight(item.card.value);
        totalWeight += weight;
        return { ...item, weight };
    });

    let random = Math.random() * totalWeight;
    for (let item of weightedCards) {
        if (random < item.weight) {
            AppState.currentIndex = item.index;
            break;
        }
        random -= item.weight;
    }

    displayCard(AppState.deck[AppState.currentIndex], AppState.currentIndex);
}

function getWeight(value) {
    switch(value) {
        case 0: return 20; 
        case 5: return 20; 
        case 4: return 10;
        case 3: return 5;
        case 2: return 2;
        case 1: return 1; 
        default: return 1;
    }
}

function displayCard(card, index) {
    document.getElementById('flashcard').classList.remove('hidden');
    document.getElementById('answer-section').classList.add('hidden');
    document.getElementById('show-answer-btn').classList.remove('hidden');

    document.getElementById('card-id').innerText = `Card #${index}`;
    document.getElementById('card-value').innerText = `Value: ${card.value} ${card.value === 0 ? '(New)' : ''}`;
    document.getElementById('question-text').innerText = card.question;
    document.getElementById('answer-text').innerText = card.answer;
}

function showAnswer() {
    document.getElementById('show-answer-btn').classList.add('hidden');
    document.getElementById('answer-section').classList.remove('hidden');
}

// --- Evaluation & Batch Saving ---
function evaluateCard(mark) {
    let card = AppState.deck[AppState.currentIndex];
    
    card.value = mark;
    card.repeats += 1;
    card.history.push(mark);

    AppState.unsavedChanges += 1;
    document.getElementById('answer-section').classList.add('hidden');
    
    // Trigger save if threshold reached
    if (AppState.unsavedChanges >= SAVE_THRESHOLD) {
        saveProgress(); 
    }
    
    pickNextCard();
}

async function saveProgress() {
    if (AppState.unsavedChanges === 0) return;

    const changesToSave = AppState.unsavedChanges;
    
    if (AppState.syncMode === 'local') {
        const progressMap = {};
        AppState.deck.forEach(card => {
            if (card.repeats > 0) {
                progressMap[card.question] = { value: card.value, repeats: card.repeats, history: card.history };
            }
        });
        localStorage.setItem(`progress_${AppState.deckId}`, JSON.stringify(progressMap));
        AppState.unsavedChanges = 0;
    } 
    else if (AppState.syncMode === 'github') {
        try {
            updateSyncBadge("Syncing...", "#ff9800", "white");
            
            const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${AppState.deckId}`;
            
            // Try to get the SHA of the file SPECIFICALLY on the data branch
            let fileSha = undefined;
            try {
                // Must use ?ref=data to fetch the SHA from the correct branch
                const getRes = await fetch(`${url}?ref=${DATA_BRANCH}`, { 
                    headers: { 'Authorization': `token ${AppState.token}` } 
                });
                if (getRes.ok) {
                    const currentData = await getRes.json();
                    fileSha = currentData.sha;
                }
            } catch (e) {
                console.log("File not found on data branch. Creating new file.");
            }

            const newPayload = { meta: AppState.meta, cards: AppState.deck };
            const jsonString = JSON.stringify(newPayload, null, 2);
            
            // Base64 Encoding using standard web APIs (handling Unicode characters correctly)
            const bytes = new TextEncoder().encode(jsonString);
            let binaryString = "";
            // Loop through safely, avoiding the call stack limit
            for (let i = 0; i < bytes.byteLength; i++) {
                binaryString += String.fromCharCode(bytes[i]);
            }
            const base64Content = btoa(binaryString);

            // Construct the payload for GitHub
            const bodyPayload = {
                message: `Cards Auto-Sync: Updated ${changesToSave} cards`,
                content: base64Content,
                branch: DATA_BRANCH // Explicitly tell GitHub to push to the data branch
            };
            
            // If the file already exists on the 'data' branch, we MUST include its SHA to overwrite it.
            // If it doesn't exist, we MUST NOT include the 'sha' key at all.
            if (fileSha) {
                bodyPayload.sha = fileSha;
            }

            const putRes = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${AppState.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(bodyPayload)
            });

            if (!putRes.ok) {
                const errorData = await putRes.json();
                throw new Error(errorData.message || "PUT request failed");
            }
            
            AppState.unsavedChanges = 0;
            updateSyncBadge("Cloud Sync Active", "#4caf50", "white");
        } catch (error) {
            console.error("Cloud Sync Failed:", error);
            updateSyncBadge("Sync Failed!", "#f44336", "white");
        }
    }
}

// --- Auto-Save Timers ---
function startAutoSave() {
    setInterval(() => {
        if (AppState.unsavedChanges > 0) {
            console.log("Timer triggered background save...");
            saveProgress();
        }
    }, SAVE_INTERVAL_MS);
}

// Warn if trying to close tab with unsaved changes
window.addEventListener('beforeunload', function (e) {
    if (AppState.unsavedChanges > 0) {
        if (AppState.syncMode === 'github') {
            const previousMode = AppState.syncMode;
            AppState.syncMode = 'local';
            saveProgress(); // Force emergency local save
            AppState.syncMode = previousMode;
        }
        e.preventDefault();
        e.returnValue = "You have unsaved cards. Are you sure you want to leave?";
    }
});