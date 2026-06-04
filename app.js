// CONFIGURATION LOGIQUE DU FLUX
const CLIENT_ID = 'bca08c406d4847d6ae1e56c04894fbcb';
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

    if (code) {
        window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);
        token = await exchangeCodeForToken(code);
    }

    if (!token) {
        window.location.href = 'login.html';
    } else {
        if (mainApp) mainApp.classList.remove('hidden');
        startTrackingSpotify(token);
    }
});

async function exchangeCodeForToken(code) {
    const codeVerifier = localStorage.getItem('spotify_code_verifier');
    const payload = {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
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
            localStorage.removeItem('spotify_code_verifier');
            return data.access_token;
        }
        return null;
    } catch (error) {
        console.error("Erreur token:", error);
        return null;
    }
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (spotifyInterval) clearInterval(spotifyInterval);
        if (syncTickerInterval) clearInterval(syncTickerInterval);
        const token = localStorage.getItem('spotify_token');
        if (token) startTrackingSpotify(token);
    }
});

// 2. SUIVI EN TEMPS RÉEL
function startTrackingSpotify(token) {
    if (spotifyInterval) clearInterval(spotifyInterval);
    if (syncTickerInterval) clearInterval(syncTickerInterval);

    checkCurrentTrack(token);
    spotifyInterval = setInterval(() => checkCurrentTrack(token), 2000);

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
            currentTrackProgress = data.progress_ms;

            updatePlayerUI({
                id: data.item.id,
                title: data.item.name,
                artist: data.item.artists[0].name,
                albumArt: data.item.album.images[0].url
            });
        }
    } catch (error) {
        console.error("Erreur API Spotify:", error);
    }
}

// 3. INTERFACE GRAPHIQUE
function updatePlayerUI(track) {
    const titleEl = document.getElementById('track-title');
    const artistEl = document.getElementById('track-artist');
    const artEl = document.getElementById('album-art');

    if (!track) {
        titleEl.innerText = "Aucune musique";
        artistEl.innerText = "Lancez un morceau sur Spotify";
        artEl.src = "https://via.placeholder.com/60";
        lyricsContainer.innerHTML = `<p class="placeholder-text">Lancez une musique sur Spotify.</p>`;
        parsedLyrics = [];
        lastTrackId = "";
        return;
    }

    if (lastTrackId !== track.id) {
        lastTrackId = track.id;
        
        titleEl.innerText = track.title;
        artistEl.innerText = track.artist;
        artEl.src = track.albumArt;

        // Lancement en tâche de fond (asynchrone) pour ne pas figer l'application
        fetchLyricsAsync(track.title, track.artist);
    }
}

// 4. RÉCUPÉRATION FLUIDE SANS BLOCAGE (LRCLIB STABLE)
async function fetchLyricsAsync(title, artist) {
    // On ne vide pas l'écran agressivement avec un message de chargement qui fait clignoter l'app
    parsedLyrics = [];

    try {
        const cleanTitle = title.split(' - ')[0].split(' (')[0].split(' [')[0].trim();
        const cleanArtist = artist.split(',')[0].trim();
        
        const url = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(cleanArtist)}&track_name=${encodeURIComponent(cleanTitle)}`;
        const response = await fetch(url);
        
        if (response.ok) {
            const data = await response.json();
            if (data.syncedLyrics) {
                parseLrc(data.syncedLyrics);
                return;
            } else if (data.plainLyrics) {
                renderPlainLyrics(data.plainLyrics);
                return;
            }
        }

        // Plan B : Recherche classique si la recherche exacte échoue
        const fallbackResponse = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle + ' ' + cleanArtist)}`);
        const fallbackData = await fallbackResponse.json();

        if (fallbackData && fallbackData.length > 0) {
            const bestMatch = fallbackData[0];
            if (bestMatch.syncedLyrics) {
                parseLrc(bestMatch.syncedLyrics);
                return;
            } else if (bestMatch.plainLyrics) {
                renderPlainLyrics(bestMatch.plainLyrics);
                return;
            }
        }

        lyricsContainer.innerHTML = `<p class="placeholder-text">Paroles indisponibles 😢</p>`;

    } catch (error) {
        console.error("Erreur paroles:", error);
        lyricsContainer.innerHTML = `<p class="placeholder-text">Erreur de chargement.</p>`;
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

// 5. ANIMATION ET CENTRAGE
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