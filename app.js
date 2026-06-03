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

// 1. GESTION DU CYCLE DE VIE (PREMIÈRE VISITE & AUTH)
function initApp() {
    const hash = window.location.hash;
    let token = localStorage.getItem('spotify_token');

    // Si on détecte le token de retour Spotify dans l'URL
    if (hash) {
        const params = new URLSearchParams(hash.substring(1));
        token = params.get('access_token');
        localStorage.setItem('spotify_token', token);
        localStorage.setItem('has_visited', 'true'); 
        window.location.hash = ''; 
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

// 2. FORCE REFRESH À CHAQUE OUVERTURE SUR IPHONE (ANTI-FREEZE)
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        console.log("App réouverte, actualisation forcée du statut...");
        if (spotifyInterval) clearInterval(spotifyInterval);
        lastTrackId = ""; // Force le rafraîchissement des paroles
        initApp();
    }
});

// 3. BOUTON DE CONNEXION (Flux Implicit Grant obligatoirement avec response_type=token)
loginBtn.addEventListener('click', () => {
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}&response_type=token&show_dialog=true`;
    window.location.href = authUrl;
});

// 4. SUIVI TEMPS RÉEL SPOTIFY
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

// 5. MISE À JOUR DE L'INTERFACE GRAPHIQUE
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

// 6. RÉCUPÉRATION DES PAROLES (Simulation temporaire)
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
Tout est fluide, le design s'adapte à l'encoche.
L'authentification utilise bien le jeton direct !`;
    }, 1000);
}
