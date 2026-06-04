// CONFIGURATION LOGIQUE DU FLUX
const CLIENT_ID = 'bca08c406d4847d6ae1e56c04894fbcb';

// Déduit automatiquement l'adresse de retour correspondante à login.html
const REDIRECT_URI = window.location.origin + window.location.pathname.replace('index.html', '') + 'login.html';

const mainApp = document.getElementById('main-app');
const lyricsSection = document.getElementById('lyrics-section');
const lyricsContainer = document.getElementById('lyrics-container');

let spotifyInterval = null;
let syncTickerInterval = null;

let lastTrackId = "";
let currentTrackProgress = 0; 
let isPlaying = false;
let parsedLyrics = []; 

// 1. CYCLE DE VIE DE L'APPLICATION
window.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    let token = localStorage.getItem('spotify_token');

    // Si on intercepte un code d'authentification transmis par la redirection Spotify
    if (code) {
        // Nettoyage immédiat des paramètres URL pour éviter les boucles au rechargement
        window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
        
        // Échange du code contre le jeton final
        token = await exchangeCodeForToken(code);
    }

    // Sécurité d'accès : S'il n'y a aucun token valide, retour au login
    if (!token) {
        window.location.href = 'login.html';
    } else {
        if (mainApp) mainApp.classList.remove('hidden');
        startTrackingSpotify(token);
    }
});

// Échange du code d'autorisation via requête POST PKCE
async function exchangeCodeForToken(code) {
    const codeVerifier = localStorage.getItem('spotify_code_verifier');
    
    const payload = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_id: CLIENT_ID,
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
            code_verifier: codeVerifier,
        }),
    };

    try {
        const response = await fetch('https://accounts.spotify.com/api/token', payload);
        const data = await response.json();
        
        if (data.access_token) {
            localStorage.setItem('spotify_token', data.access_token);
            localStorage.removeItem('spotify_code_verifier'); // Nettoyage de sécurité
            return data.access_token;
        }
        return null;
    } catch (error) {
        console.error("Erreur lors de l'échange du token :", error);
        return null;
    }
}

// PROTECTION ANTI-FREEZE IPHONE : RECONNEXION INSTANTANÉE SANS CHARGEMENT LENT
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        // On coupe proprement les compteurs pour repartir sur un flux propre
        if (spotifyInterval) clearInterval(spotifyInterval);
        if (syncTickerInterval) clearInterval(syncTickerInterval);

        const token = localStorage.getItem('spotify_token');
        if (token) {
            // Relance immédiate du suivi en tâche de fond
            startTrackingSpotify(token);
        } else {
            window.location.href = 'login.html';
        }
    }
});

// 2. SUIVI EN TEMPS RÉEL DE L'ÉCOUTE
function startTrackingSpotify(token) {
    if (spotifyInterval) clearInterval(spotifyInterval);
    if (syncTickerInterval) clearInterval(syncTickerInterval);

    // Premier appel direct à la milliseconde près au démarrage ou déverrouillage
    checkCurrentTrack(token);
    
    // Synchro globale toutes les 3 secondes auprès de Spotify
    spotifyInterval = setInterval(() => checkCurrentTrack(token), 3000);

    // Micro-compteur de 100ms ultra-fluide pour le glissement des paroles
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
            window.location.href = 'login.html';
            return;
        }

        if (response.status === 204) {
            updatePlayerUI(null);
            return;
        }

        const data = await response.json();
        if (data && data.item) {
            isPlaying = data.is_playing;
            currentTrackProgress = data.progress_ms; // Recalibrage sur le flux réel de Spotify

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

// 3. AFFICHAGE DES INFOS DU MORCEAU
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
        lastTrackId = ""; // Reset pour forcer la recherche si une musique reprend plus tard
        return;
    }

    // Déclenchement de la recherche UNIQUEMENT si le morceau a changé
    const currentTrackId = `${track.title}-${track.artist}`;
    if (lastTrackId !== currentTrackId) {
        lastTrackId = currentTrackId;
        
        titleEl.innerText = track.title;
        artistEl.innerText = track.artist;
        artEl.src = track.albumArt;

        fetchRealLyrics(track.title, track.artist);
    }
}

// 4. RÉCUPÉRATION ET TRADUCTION DES PAROLES (API LRCLIB)
async function fetchRealLyrics(title, artist) {
    lyricsContainer.innerHTML = `<p class="placeholder-text">Recherche des paroles...</p>`;
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
        console.error("Erreur chargement paroles :", error);
        lyricsContainer.innerHTML = `<p class="placeholder-text">Erreur lors du chargement des paroles.</p>`;
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

// 5. ANIMATION ET CENTRAGE FLUIDE DES PAROLES (APPLE MUSIC STYLE)
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

            // Calcul du centrage vertical exact dans la boîte de défilement
            const containerTop = lyricsSection.getBoundingClientRect().top;
            const elementTop = activeElement.getBoundingClientRect().top;
            const relativeTop = elementTop - containerTop;

            lyricsSection.scrollBy({
                top: relativeTop - (lyricsSection.clientHeight / 2) + (activeElement.clientHeight / 2),
                behavior: 'smooth'
            });
        }
    }
}