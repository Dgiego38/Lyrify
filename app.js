// CONFIGURATION SPOTIFY PRODUCTION OFFICIELLE
const CLIENT_ID = 'bca08c406d4847d6ae1e56c04894fbcb'; 

// Nettoyage complet pour correspondre à 100% avec le Dashboard Spotify (Supprime le slash de fin et index.html)
const REDIRECT_URI = window.location.origin + window.location.pathname.replace(/\/$/, "").replace(/\/index\.html$/, "");

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

// UTILS CRYPTO PKCE COMPATIBLES SAFARI NATIVE
function generateRandomString(length) {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
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

// 1. INITIALISATION DE L'APPLICATION
async function initApp() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    let token = localStorage.getItem('spotify_token');

    if (code) {
        // Nettoyage immédiat de la barre d'adresse pour casser la boucle infinie sur iOS
        window.history.replaceState({}, document.title, window.location.pathname);
        token = await exchangeCodeForToken(code);
    }

    if (!token) {
        welcomeScreen.classList.remove('hidden');
        mainApp.classList.add('hidden');
    } else {
        welcomeScreen.classList.add('hidden');
        mainApp.classList.remove('hidden');
        startTrackingSpotify(token);
    }
}

window.addEventListener('DOMContentLoaded', initApp);

// 2. ÉCHANGE DU CODE CONTRE UN ACCESS TOKEN (PRODUCTION ENDPOINT)
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
        const response = await fetch('https://accounts.spotify.com/api/token', payload);
        const data = await response.json();
        if (data.access_token) {
            localStorage.setItem('spotify_token', data.access_token);
            return data.access_token;
        }
    } catch (error) {
        console.error("Erreur d'échange de jeton :", error);
    }
    return null;
}

// CLIC CONNEXION : SYNTAXE CORRECTE $ ET URL INTERNATIONALE
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
    
    // Correction ici : Ajout du "$" manquant et de la vraie URL de login Spotify
    window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
});

// ANTI-FREEZE IPHONE (RESET DES INTERVALLES LORS DU VERROUILLAGE/DÉVERROUILLAGE)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (spotifyInterval) clearInterval(spotifyInterval);
        if (syncTickerInterval) clearInterval(syncTickerInterval);
        lastTrackId = ""; 
        initApp();
    }
});

// 3. LOGIQUE DOUBLE HORLOGE (3S ET TICKER 100MS POUR LE RECALIBRAGE)
function startTrackingSpotify(token) {
    if (spotifyInterval) clearInterval(spotifyInterval);
    if (syncTickerInterval) clearInterval(syncTickerInterval);
    
    checkCurrentTrack(token);
    spotifyInterval = setInterval(() => checkCurrentTrack(token), 3000);

    // Ticker haute fréquence (100ms) pour faire avancer le compteur en local de manière ultra fluide
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
            currentTrackProgress = data.progress_ms; 

            updatePlayerUI({
                title: data.item.name,
                artist: data.item.artists[0].name,
                albumArt: data.item.album.images[0].url
            });
        }
    } catch (error) {
        console.error("Erreur API Spotify Player :", error);
    }
}

function updatePlayerUI(track) {
    const titleEl = document.getElementById('track-title');
    const artistEl = document.getElementById('track-artist');
    const artEl = document.getElementById('album-art');

    if (!track) {
        titleEl.innerText = "Aucune musique";
        artistEl.innerText = "Lancez un morceau sur Spotify";
        artEl.src = "https://placehold.co/60x60/121212/ffffff?text=Lyrify";
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

// 4. RÉCUPÉRATION DES PAROLES (LRCLIB)
async function fetchRealLyrics(title, artist) {
    lyricsContainer.innerHTML = `<p class="placeholder-text">Recherche des paroles...</p>`;
    parsedLyrics = [];

    try {
        const cleanTitle = title
            .replace(/-\s*Remastered.*/i, '')
            .replace(/-\s*Remaster.*/i, '')
            .replace(/\(\s*feat\..*?\)/i, '')
            .replace(/-\s*Single Version/i, '')
            .trim();

        const query = encodeURIComponent(`${cleanTitle} ${artist}`);
        const response = await fetch(`https://lrclib.net/api/search?q=${query}`);
        const data = await response.json();

        if (data && data.length > 0) {
            const matched = data.find(item => item.syncedLyrics);
            if (matched) {
                parseLrc(matched.syncedLyrics);
                return;
            } else if (data[0].plainLyrics) {
                renderPlainLyrics(data[0].plainLyrics);
                return;
            }
        }
        lyricsContainer.innerHTML = `<p class="placeholder-text">Paroles indisponibles pour ce morceau 😢</p>`;
    } catch (error) {
        console.error("Erreur paroles :", error);
        lyricsContainer.innerHTML = `<p class="placeholder-text">Erreur lors du chargement.</p>`;
    }
}

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
            const msStr = match[3];
            const milliseconds = parseInt(msStr.length === 2 ? msStr + '0' : msStr);
            
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

// 5. RENDU ET CENTRAGE DYNAMIQUE VIA GETBOUNDINGCLIENTRECT (APPLE MUSIC INSPIRATION)
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

            const containerRect = lyricsSection.getBoundingClientRect();
            const elemRect = activeElement.getBoundingClientRect();
            
            // Calcul mathématique précis pour bloquer la ligne active parfaitement au centre vertical de l'iPhone
            const offset = elemRect.top - containerRect.top - (containerRect.height / 2) + (elemRect.height / 2);
            
            lyricsSection.scrollBy({
                top: offset,
                behavior: 'smooth'
            });
        }
    }
}
