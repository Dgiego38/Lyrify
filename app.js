// CONFIGURATION SPOTIFY
const CLIENT_ID = 'bca08c406d4847d6ae1e56c04894fbcb'; 

// S'adapte parfaitement sur localhost et GitHub Pages en gérant le cas du slash final
const REDIRECT_URI = window.location.origin + window.location.pathname; 
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

// 1. GESTION DU CYCLE DE VIE (PREMIÈRE VISITE & AUTH)
window.addEventListener('DOMContentLoaded', () => {
    const hash = window.location.hash;
    let token = localStorage.getItem('spotify_token');

    // Si on détecte le token de retour Spotify dans l'URL
    if (hash) {
        const params = new URLSearchParams(hash.substring(1));
        token = params.get('access_token');
        localStorage.setItem('spotify_token', token);
        localStorage.setItem('has_visited', 'true'); // Enregistre le passage
        window.location.hash = ''; // Nettoie l'URL pour stopper d'éventuelles boucles
    }

    const hasVisited = localStorage.getItem('has_visited');

    if (!hasVisited && !token) {
        // Premier arrivage : on montre l'écran d'accueil
        welcomeScreen.classList.remove('hidden');
        mainApp.classList.add('hidden');
    } else {
        // Déjà venu : on bascule sur l'app directement
        welcomeScreen.classList.add('hidden');
        mainApp.classList.remove('hidden');
        if (token) {
            startTrackingSpotify(token);
        } else {
            // Si le token manque, on remontre l'accueil pour forcer la connexion
            welcomeScreen.classList.remove('hidden');
            mainApp.classList.add('hidden');
        }
    }
});

// 2. BOUTON DE CONNEXION (Flux Implicit Grant - response_type=token)
loginBtn.addEventListener('click', () => {
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}&response_type=token&show_dialog=true`;
    window.location.href = authUrl;
});

// FORCE REFRESH À CHAQUE OUVERTURE SUR IPHONE (ANTI-FREEZE)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        if (spotifyInterval) clearInterval(spotifyInterval);
        if (syncTickerInterval) clearInterval(syncTickerInterval);
        lastTrackId = ""; 
        const token = localStorage.getItem('spotify_token');
        if (token) startTrackingSpotify(token);
    }
});

// 3. SUIVI TEMPS RÉEL SPOTIFY & COMPTEUR LOCAL HAUTE PRÉCISION
function startTrackingSpotify(token) {
    if (spotifyInterval) clearInterval(spotifyInterval);
    if (syncTickerInterval) clearInterval(syncTickerInterval);

    checkCurrentTrack(token);
    // Vérification toutes les 3 secondes auprès de Spotify pour recalibrer la position réelle
    spotifyInterval = setInterval(() => checkCurrentTrack(token), 3000);

    // Compteur local fluide (toutes les 100ms) pour une synchro ultra-réactive des paroles
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

        // Token expiré (401) -> Déconnexion et reset
        if (response.status === 401) {
            localStorage.removeItem('spotify_token');
            window.location.reload();
            return;
        }

        // Aucune musique active (204)
        if (response.status === 204) {
            updatePlayerUI(null);
            return;
        }

        const data = await response.json();
        if (data && data.item) {
            isPlaying = data.is_playing;
            currentTrackProgress = data.progress_ms; // Ajustement sur le temps réel de Spotify

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

// 4. MISE À JOUR DE L'INTERFACE GRAPHIQUE
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

    // On ne met à jour le texte et les paroles que si le morceau a changé
    const currentTrackId = `${track.title}-${track.artist}`;
    if (lastTrackId !== currentTrackId) {
        lastTrackId = currentTrackId;
        
        titleEl.innerText = track.title;
        artistEl.innerText = track.artist;
        artEl.src = track.albumArt;

        fetchRealLyrics(track.title, track.artist);
    }
}

// 5. RÉCUPÉRATION DES VRAIES PAROLES SYNCHRONISÉES (API LRCLIB SECURISEE)
async function fetchRealLyrics(title, artist) {
    lyricsContainer.innerHTML = `<p class="placeholder-text">Recherche des paroles synchronisées...</p>`;
    parsedLyrics = [];

    try {
        // Nettoyage pour enlever les "(feat...)" ou "- Remaster" qui faussent la recherche
        const cleanTitle = title.split(' - ')[0].split(' (')[0];
        const query = encodeURIComponent(`${cleanTitle} ${artist}`);
        
        // Requête HTTPS sécurisée vers l'API de paroles
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

// Découpe le format LRC [mm:ss.xx] en millisecondes pour l'animation
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

// 6. ANIMATION ET CENTRAGE AUTOMATIQUE AU CENTRE DE L'ÉCRAN
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

            // Calcul de défilement au pixel près adapté à Safari iOS
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
