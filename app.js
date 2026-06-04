// CONFIGURATION SPOTIFY
const CLIENT_ID = 'bca08c406d4847d6ae1e56c04894fbcb'; 

// Force une URL propre sans double slash pour Spotify Dashboard
const REDIRECT_URI = window.location.origin + window.location.pathname.replace(/\/$/, ""); 
const SCOPES = 'user-read-currently-playing user-read-playback-state';

// ÉLÉMENTS DU DOM
const welcomeScreen = document.getElementById('welcome-screen');
const mainApp = document.getElementById('main-app');
const loginBtn = document.getElementById('welcome-login-btn');
const lyricsSection = document.getElementById('lyrics-section');
const lyricsContainer = document.getElementById('lyrics-container');

let spotifyInterval = null;
let syncTickerInterval = null;

let lastTrackId = "";
let currentTrackProgress = 0; 
let isPlaying = false;
let parsedLyrics = []; 

// OUTILS CRYPTO PKCE
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

    if (code) {
        token = await exchangeCodeForToken(code);
        // Nettoie l'URL en enlevant le ?code=...
        window.history.replaceState({}, document.title, window.location.pathname);
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
            redirect_uri: REDIRECT_URI, // Version nettoyée
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
        } else {
            console.error("Erreur Spotify API :", response);
        }
    } catch (error) {
        console.error("Erreur réseau lors de l'échange du jeton :", error);
    }
    return null;
}

// FORCE REFRESH À CHAQUE OUVERTURE SUR IPHONE (ANTI-FREEZE)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (spotifyInterval) clearInterval(spotifyInterval);
        if (syncTickerInterval) clearInterval(syncTickerInterval);
        lastTrackId = ""; 
        initApp();
    }
});

// BOUTON DE CONNEXION AVEC GENERATION PKCE
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
    window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
});

// 3. SUIVI TEMPS RÉEL SPOTIFY & RECALIBRATION DU COMPTEUR
function startTrackingSpotify(token) {
    if (spotifyInterval) clearInterval(spotifyInterval);
    if (syncTickerInterval) clearInterval(syncTickerInterval);
    
    checkCurrentTrack(token);
    // Rafraîchissement plus court (3 secondes) pour éviter les décalages au changement de morceau
    spotifyInterval = setInterval(() => checkCurrentTrack(token), 3000); 

    // Compteur local fluide cadencé à 100ms pour une animation Apple Music ultra-réactive
    syncTickerInterval = setInterval(() => {
        if (isPlaying && parsedLyrics.length > 0) {
            currentTrackProgress += 100;
            updateLyricsHighlight(currentTrackProgress);
        }
    }, 100);
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
            isPlaying = data.is_playing;
            currentTrackProgress = data.progress_ms; // Recalibrage précis basé sur Spotify

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

function updatePlayerUI(track) {
    const titleEl = document.getElementById('track-title');
    const artistEl = document.getElementById('track-artist');
    const artEl = document.getElementById('album-art');

    if (!track) {
        titleEl.innerText = "Aucune musique";
        artistEl.innerText = "Lancez un morceau sur Spotify";
        artEl.src = "https://via.placeholder.com/60";
        lyricsContainer.innerHTML = `<p class="placeholder-text">Lancez une musique sur Spotify pour voir les paroles.</p>`;
        parsedLyrics = [];
        return;
    }

    const currentTrackId = `${track.title}-${track.artist}`;
    if (lastTrackId !== currentTrackId) {
        lastTrackId = currentTrackId;
        
        titleEl.innerText = track.title;
        artistEl.innerText = track.artist;
        artEl.src = track.albumArt;

        fetchRealLyrics(track.title, track.artist);
    }
}

// 4. RÉCUPÉRATION DES PAROLES SYNCHRONISÉES (API LRCLIB)
async function fetchRealLyrics(title, artist) {
    lyricsContainer.innerHTML = `<p class="placeholder-text">Recherche des paroles synchronisées...</p>`;
    parsedLyrics = [];

    try {
        const cleanTitle = title.split(' - ')[0].split(' (')[0];
        const query = encodeURIComponent(`${cleanTitle} ${artist}`);
        
        const response = await fetch(`https://lrclib.net/api/search?q=${query}`);
        const data = await response.json();

        if (data && data.length > 0 && data[0].syncedLyrics) {
            parseLrc(data[0].syncedLyrics);
        } else if (data && data.length > 0 && data[0].plainLyrics) {
            renderPlainLyrics(data[0].plainLyrics);
        } else {
            lyricsContainer.innerHTML = `<p class="placeholder-text">Paroles indisponibles pour ce morceau 😢</p>`;
        }
    } catch (error) {
        console.error("Erreur paroles :", error);
        lyricsContainer.innerHTML = `<p class="placeholder-text">Erreur lors du chargement des paroles.</p>`;
    }
}

// Découpe le format LRC [00:12.34] en millisecondes
function parseLrc(lrcText) {
    parsedLyrics = [];
    lyricsContainer.innerHTML = "";

    const lines = lrcText.split('\n');
    const timeRegEx = /\[(\d+):(\d+)\.(\d+)\]/;

    lines.forEach((line, index) => {
        const match = timeRegEx.exec(line);
        if (match) {
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            const milliseconds = parseInt(match[3].padEnd(3, '0').substring(0, 3));
            
            const timeInMs = (minutes * 60 * 1000) + (seconds * 1000) + milliseconds;
            const text = line.replace(timeRegEx, '').trim();

            if (text) { 
                parsedLyrics.push({ time: timeInMs, text: text, id: `line-${index}` });

                const p = document.createElement('p');
                p.id = `line-${index}`;
                p.className = 'lyric-line';
                p.innerText = text;
                lyricsContainer.appendChild(p);
            }
        }
    });
}

function renderPlainLyrics(text) {
    lyricsContainer.innerHTML = "";
    const p = document.createElement('p');
    p.className = 'placeholder-text';
    p.style.whiteSpace = "pre-line";
    p.style.textAlign = "left";
    p.innerText = text;
    lyricsContainer.appendChild(p);
}

// 5. ANIMATION ET CENTRAGE AUTOMATIQUE
function updateLyricsHighlight(progress) {
    if (parsedLyrics.length === 0) return;

    let activeLine = null;
    for (let i = 0; i < parsedLyrics.length; i++) {
        if (progress >= parsedLyrics[i].time) {
            activeLine = parsedLyrics[i];
        } else {
            break;
        }
    }

    if (activeLine) {
        const activeElement = document.getElementById(activeLine.id);
        if (activeElement && !activeElement.classList.contains('active')) {
            document.querySelectorAll('.lyric-line.active').forEach(el => el.classList.remove('active'));
            activeElement.classList.add('active');

            const offsetTop = activeElement.offsetTop;
            const containerHeight = lyricsSection.clientHeight;
            lyricsSection.scrollTop = offsetTop - (containerHeight / 2) + (activeElement.clientHeight / 2);
        }
    }
}
