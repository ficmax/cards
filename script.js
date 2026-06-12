// --- Application State ---
const AppState = {
    syncMode: 'local', // 'local' (public) or 'github' (admin)
    deckId: null,      // Name of public file OR Gist ID
    token: null,       // Admin GitHub Token
    filename: null,    // Specific file within the Gist
    deck: [],
    currentIndex: -1
};

// --- Initialization ---
document.addEventListener("DOMContentLoaded", () => {
    // Check if device already has admin credentials saved
    const savedToken = localStorage.getItem('anki_github_token');
    if (savedToken) {
        AppState.token = savedToken;
        document.getElementById('admin-token-input').value = savedToken;
    }
});

// --- Mode 1: Public/Local Mode (Visitors) ---
// Loads a default public JSON file hosted in your repository
async function loadPublicDeck(fileName) {
    try {
        const response = await fetch(fileName);
        const rawData = await response.json();
        
        AppState.syncMode = 'local';
        AppState.deckId = fileName; // Use filename as the local storage key
        
        // Merge with any progress the visitor previously saved in their browser
        AppState.deck = mergeLocalProgress(rawData, fileName);
        
        startStudySession();
    } catch (error) {
        console.error("Failed to load public deck", error);
    }
}

// Loads a file uploaded directly by the visitor
function loadUploadedFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const rawData = JSON.parse(e.target.result);
        AppState.syncMode = 'local';
        AppState.deckId = file.name;
        AppState.deck = mergeLocalProgress(rawData, file.name);
        startStudySession();
    };
    reader.readAsText(file);
}

// Merges fresh questions with a visitor's local browser storage
function mergeLocalProgress(freshDeck, storageKey) {
    const savedData = JSON.parse(localStorage.getItem(`progress_${storageKey}`)) || {};
    
    return freshDeck.map(card => {
        // If the user studied this question before, load their stats
        const savedStats = savedData[card.question] || {};
        return {
            question: card.question,
            answer: card.answer,
            value: savedStats.value !== undefined ? savedStats.value : 0,
            repeats: savedStats.repeats || 0,
            history: savedStats.history || []
        };
    });
}

// --- Mode 2: Admin/Cloud Mode (You) ---
async function loginAndLoadGist() {
    const token = document.getElementById('admin-token-input').value;
    const gistId = document.getElementById('admin-gist-input').value;
    
    if (!token || !gistId) return alert("Requires Token and Gist ID");

    // Save token to device so you don't have to log in every time
    localStorage.setItem('anki_github_token', token);
    AppState.token = token;
    AppState.deckId = gistId;
    AppState.syncMode = 'github';

    try {
        const response = await fetch(`https://api.github.com/gists/${gistId}`, {
            headers: { 'Authorization': `token ${token}` }
        });
        const gist = await response.json();
        
        AppState.filename = Object.keys(gist.files)[0];
        const rawContent = gist.files[AppState.filename].content;
        
        // Admin gists are assumed to already have progress properties saved inside them
        AppState.deck = JSON.parse(rawContent);
        startStudySession();
    } catch (error) {
        alert("Admin Login Failed. Check Token/Gist ID.");
    }
}

// --- Universal Saving Logic ---
async function saveProgress() {
    if (AppState.syncMode === 'local') {
        // Save ONLY stats to Local Storage (mapped by question text to save space)
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
        console.log("Saved to browser locally.");
    } 
    else if (AppState.syncMode === 'github') {
        // Overwrite the entire Gist via API
        const payload = {
            files: {
                [AppState.filename]: { content: JSON.stringify(AppState.deck, null, 2) }
            }
        };
        await fetch(`https://api.github.com/gists/${AppState.deckId}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `token ${AppState.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        console.log("Saved to GitHub Gist.");
    }
}

// --- Card Logic (Shortened for brevity) ---
function startStudySession() {
    // Hide setup UI, show study UI
    document.getElementById('setup-section').style.display = 'none';
    document.getElementById('study-section').style.display = 'block';
    pickNextCard();
}

function pickNextCard() {
    // (Insert the weighted random logic we wrote previously here)
    // For now, simple random:
    AppState.currentIndex = Math.floor(Math.random() * AppState.deck.length);
    displayCard(AppState.deck[AppState.currentIndex]);
}

function displayCard(card) {
    document.getElementById('question-text').innerText = card.question;
    document.getElementById('answer-text').innerText = card.answer;
    document.getElementById('answer-section').style.display = 'none';
}

async function evaluateCard(score) {
    let card = AppState.deck[AppState.currentIndex];
    card.value = score;
    card.repeats++;
    card.history.push(score);
    
    await saveProgress();
    pickNextCard();
}