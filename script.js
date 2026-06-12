// --- Application State & Config ---
const GITHUB_OWNER = "ficmax"; // CHANGE THIS TO YOUR USERNAME
const GITHUB_REPO = "cards";
const CARDS_FOLDER = "cards";

const AppState = {
    syncMode: 'local', // 'local' (public visitor) or 'github' (admin logged in)
    token: null,       // Your PAT token for admin cloud sync
    deckId: null,      // e.g., 'cards/cs-basics.json'
    meta: {},          // The "meta" header block from the JSON
    deck: [],          // The "cards" array from the JSON
    currentIndex: -1
};

// --- Initialization ---
document.addEventListener("DOMContentLoaded", async () => {
    // 1. Check if admin token is already saved on this device
    const savedToken = localStorage.getItem('anki_github_token');
    if (savedToken) {
        AppState.token = savedToken;
        AppState.syncMode = 'github';
        document.getElementById('sync-status-badge').innerText = "Cloud Sync Active";
        document.getElementById('sync-status-badge').style.background = "#4caf50";
        document.getElementById('sync-status-badge').style.color = "white";
    }

    // 2. Automatically load the list of available decks from the repository
    await populateDecksDropdown();
});

// --- File Discovery (API Call) ---
async function populateDecksDropdown() {
    const dropdown = document.getElementById('public-decks-dropdown');
    dropdown.innerHTML = '<option value="">Loading decks...</option>';

    try {
        // We can read public repo contents without a token
        const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${CARDS_FOLDER}`;
        const response = await fetch(url);
        const files = await response.json();

        dropdown.innerHTML = '<option value="">-- Select a deck --</option>';
        
        // Add each .json file to the dropdown
        files.forEach(file => {
            if (file.name.endsWith('.json')) {
                const option = document.createElement('option');
                option.value = file.path; // e.g. "cards/deck.json"
                // Format the name slightly to look better (remove .json)
                option.innerText = file.name.replace('.json', '');
                dropdown.appendChild(option);
            }
        });
    } catch (error) {
        dropdown.innerHTML = '<option value="">Failed to load decks.</option>';
        console.error("Error fetching repository contents:", error);
    }
}

// --- Loading Data (Public Repo vs Local Upload) ---
async function loadSelectedPublicDeck() {
    const path = document.getElementById('public-decks-dropdown').value;
    if (!path) return alert("Please select a deck.");

    AppState.deckId = path;

    try {
        // Fetch the raw JSON content directly from GitHub Pages
        const response = await fetch(`/${GITHUB_REPO}/${path}`);
        
        // Fallback for local testing if running from file://
        if (!response.ok) throw new Error("Could not fetch via Pages URL");
        
        const rawData = await response.json();
        setupDeck(rawData, path);
    } catch (error) {
        // Fallback using GitHub API if Pages routing fails during testing
        try {
            const apiRes = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`);
            const apiData = await apiRes.json();
            // Decode Base64 content
            const decodedStr = decodeURIComponent(escape(atob(apiData.content)));
            setupDeck(JSON.parse(decodedStr), path);
        } catch(fallbackErr) {
            alert("Failed to load deck.");
        }
    }
}

function loadUploadedFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    AppState.deckId = file.name;
    // Force local mode for uploaded files, even if admin is logged in
    const previousMode = AppState.syncMode; 
    AppState.syncMode = 'local'; 

    const reader = new FileReader();
    reader.onload = function(e) {
        const rawData = JSON.parse(e.target.result);
        setupDeck(rawData, file.name);
    };
    reader.readAsText(file);
}

function setupDeck(fileContent, storageKey) {
    // 1. Separate metadata from cards
    AppState.meta = fileContent.meta || { title: "Untitled Deck" };
    document.getElementById('deck-title-display').innerText = AppState.meta.title;

    let rawCards = fileContent.cards || [];

    // 2. Merge with any local progress if we are NOT in Cloud Sync mode
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
        // If Cloud Sync is active, the file from GitHub already contains the latest progress
        AppState.deck = rawCards.map(card => ({
            question: card.question,
            answer: card.answer,
            value: card.value !== undefined ? card.value : 0,
            repeats: card.repeats || 0,
            history: card.history || []
        }));
    }

    // Set Max Range boundary based on deck size
    document.getElementById('range-max').value = AppState.deck.length - 1;

    // Transition UI
    document.getElementById('setup-section').classList.add('hidden');
    document.getElementById('study-section').classList.remove('hidden');
}

// --- Admin Login Logic ---
function toggleAdminLogin() {
    const section = document.getElementById('admin-login-section');
    section.classList.toggle('hidden');
}

function saveAdminToken() {
    const token = document.getElementById('admin-token').value;
    if (!token) return;
    
    localStorage.setItem('anki_github_token', token);
    AppState.token = token;
    AppState.syncMode = 'github';
    alert("Admin login saved! Files will now sync to GitHub.");
    location.reload(); // Reload to update badges and state safely
}

// --- Core Study Logic ---
function pickNextCard() {
    const min = parseInt(document.getElementById('range-min').value);
    const max = parseInt(document.getElementById('range-max').value);
    
    let availableCards = AppState.deck
        .map((card, index) => ({ card, index }))
        .filter(item => item.index >= min && item.index <= max);

    if (availableCards.length === 0) return alert("No cards in that range!");

    // Weighted randomization logic
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

// --- Evaluation & Saving ---
async function evaluateCard(mark) {
    let card = AppState.deck[AppState.currentIndex];
    
    // Update stats
    card.value = mark;
    card.repeats += 1;
    card.history.push(mark);

    // Hide answer UI to indicate processing
    document.getElementById('answer-section').classList.add('hidden');
    
    await saveProgress();
    pickNextCard();
}

async function saveProgress() {
    if (AppState.syncMode === 'local') {
        const progressMap = {};
        AppState.deck.forEach(card => {
            if (card.repeats > 0) {
                progressMap[card.question] = { 
                    value: card.value, 
                    repeats: card.repeats, 
                    history: card.history 
                };
            }
        });
        localStorage.setItem(`progress_${AppState.deckId}`, JSON.stringify(progressMap));
    } 
    else if (AppState.syncMode === 'github') {
        try {
            const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${AppState.deckId}`;
            
            // Get current file SHA
            const getRes = await fetch(url, { headers: { 'Authorization': `token ${AppState.token}` } });
            const currentData = await getRes.json();
            
            // Prepare payload
            const newPayload = { meta: AppState.meta, cards: AppState.deck };
            
            // Base64 encode handling unicode characters
            const jsonString = JSON.stringify(newPayload, null, 2);
            const bytes = new TextEncoder().encode(jsonString);
            const base64Content = btoa(String.fromCharCode(...bytes));

            // Overwrite file
            await fetch(url, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${AppState.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: "Cards Sync: Updated card progress",
                    content: base64Content,
                    sha: currentData.sha
                })
            });
        } catch (error) {
            console.error("Cloud Sync Failed", error);
            alert("Failed to sync to GitHub. Check your connection or token.");
        }
    }
}