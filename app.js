// CONFIGURATION SPOTIFY
const CLIENT_ID = 'bca08c406d4847d6ae1e56c04894fbcb'; 
const REDIRECT_URI = window.location.origin + window.location.pathname; 
const SCOPES = 'user-read-currently-playing user-read-playback-state';

// ÉLÉMENTS DU DOM
const welcomeScreen = document.getElementById('welcome-screen');
const mainApp = document.getElementById('main-app');
const loginBtn = document.getElementById('welcome-login-btn');

let spotifyInterval = null;
let lastTrackId = "";

// OUTILS DE SÉCURITÉ CRYPTO POUR FLUX CODE PKCE
function generateRandomString(length) {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

async function generateCodeChallenge(codeVerifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode.apply(null, new Uint8Array(digest)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// 1. GESTION DU CYCLE DE VIE (PREMIÈRE VISITE, RETOUR AUTH & CODES)
async function initApp() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    let token = localStorage.getItem('spotify_token');

    // Si on détecte le paramètre ?code= de retour de Spotify
    if (code) {
        window.history.replaceState({}, document.title, window.location.pathname); // Nettoie immédiatement l'URL (?code=...)
        token = await exchangeCodeForToken(code);
    }

    const hasVisited = localStorage.getItem('has_visited');

    if (!hasVisited && !token) {
        welcomeScreen.classList.remove('hidden');
        mainApp.classList.add('hidden');
    } else {
        welcomeScreen.classList.add('hidden');
        mainApp.classList.remove('hidden');
        if (token) {
            startTrackingSpotify(token);
        } else {
            welcomeScreen.classList.remove('hidden');
            mainApp.classList.add('hidden');
        }
    }
}

window.addEventListener('DOMContentLoaded', initApp);

// 2. ÉCHANGE DU CODE CONTRE UN ACCESS TOKEN (POST API)
async function exchangeCodeForToken(code) {
    const codeVerifier = localStorage.getItem('code_verifier');

    const payload = {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: CLIENT_ID,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
            code_verifier: codeVerifier
        }),
    };

    try {
        const body = await fetch('https://accounts.spotify.com/api/token', payload);
        const response = await body.json();
        
        if (response.access_token) {
            localStorage.setItem('spotify_token', response.access_token);
            localStorage.setItem('has_visited', 'true');
            return response.access_token;
        }
    } catch (error) {
        console.error("Erreur lors de l'échange du jeton :", error);
    }
    return null;
}

// 3. FORCE REFRESH À CHAQUE OUVERTURE SUR IPHONE (ANTI-FREEZE)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (spotifyInterval) clearInterval(spotifyInterval);
        lastTrackId = ""; 
        initApp();
    }
});

// 4. BOUTON DE CONNEXION AVEC GENERATION PKCE (response_type=code)
loginBtn.addEventListener('click', async () => {
    const codeVerifier = generateRandomString(64);
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    
    localStorage.setItem('code_verifier', codeVerifier);

    const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        scope: SCOPES,
        redirect_uri: REDIRECT_URI,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge
    });

    window.location.href = `https://accounts.spotify.com/authorize?client_id=${params.toString()}`;
});

// 5. SUIVI TEMPS RÉEL SPOTIFY
function startTrackingSpotify(token) {
    if (spotifyInterval) clearInterval(spotifyInterval);
    
    checkCurrentTrack(token);
    spotifyInterval = setInterval(() => checkCurrentTrack(token), 5000);
}

async function checkCurrentTrack(token) {
    try {
        const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (response.status === 401) {
            localStorage.removeItem('spotify_token');
            window.location.reload();
            return;
        }

        if (response.status === 204) {
            updatePlayerUI(null);
            return;
        }

        const data = await response.json();
        if (data && data.item) {
            updatePlayerUI({
                title: data.item.name,
                artist: data.item.artists[0].name,
                albumArt: data.item.album.images[0].url
            });
        }
    } catch (error) {
        console.error("Erreur API Spotify :", error);
    }
}

// 6. MISE À JOUR DE L'INTERFACE GRAPHIQUE
function updatePlayerUI(track) {
    const titleEl = document.getElementById('track-title');
    const artistEl = document.getElementById('track-artist');
    const artEl = document.getElementById('album-art');

    if (!track) {
        titleEl.innerText = "Aucune musique";
        artistEl.innerText = "Lancez un morceau sur Spotify";
        artEl.src = "https://via.placeholder.com/60";
        return;
    }

    const currentTrackId = `${track.title}-${track.artist}`;
    if (lastTrackId !== currentTrackId) {
        lastTrackId = currentTrackId;
        
        titleEl.innerText = track.title;
        artistEl.innerText = track.artist;
        artEl.src = track.albumArt;

        fetchLyrics(track.title, track.artist);
    }
}

// 7. RÉCUPÉRATION DES PAROLES (Simulation temporaire)
function fetchLyrics(title, artist) {
    const container = document.getElementById('lyrics-container');
    container.innerHTML = `<p class="placeholder-text">Recherche des paroles...</p>`;
    
    setTimeout(() => {
        container.innerText = `[Couplet 1]
Voici un exemple de paroles pour tester Lyrify.
Le morceau détecté est bien : 
"${title}" de ${artist}.

[Refrain]
Ça s'affiche directement sur ton iPhone !
L'authentification sécurisée PKCE avec response_type=code fonctionne à merveille.`;
    }, 1000);
}
