// ============================================================
// VARIABLES GLOBALES
// ============================================================
let outdoorTemp = 15;        
let outdoorHumidity = 50;
let outdoorPressure = 1013;
let outdoorWind = 0;         
let sunshineStatus = 'Clouds';

let manualCloAdjustment = 0; 
const apiKey = '4ec1eb2b0cc90a4b18a79008b17581a8'; 
let GLOBAL_HOUSE_CONFIG = {};

// NOUVEAU : Mémoire des températures pour recalculer sans rappeler Make.com
let DONNEES_HABITAT = {}; 

const capteursMaison = {
    "Cuisine": "98e2d34a-769f-4296-93ed-6083772e703e",
    "Chambre parents": "051291b5-d2d0-43a8-b783-08b8509d2c84",
    "Chambre Orso": "c432fd4b-3836-4d98-94fd-3e6822aa96c5",
    "Garage": "762dd667-b30a-4bed-8bf6-2fc2a09fc29b",
    "Entrée": "598d83ea-cfcd-43f8-89f6-cfed3a4517d4",
    "Cave": "d8906d8b-68d2-4100-a074-03129a672ae1",
    "Chambre Ysée": "5ac8836a-c232-4225-a688-f161dcca60f6",
    "Extérieur - Jardin": "50ad97e0-a6e1-4b54-9b6a-dc306df7c068",
    "Salle de bain - Haut": "322388c4-c9b2-475d-9c68-3e13e501ce6a",
    "Extérieur - Rue": "c755bde8-9f8a-4ea4-ac2e-2fea154e9c09",
    "Salon": "20fee90c-95f2-47ea-b477-e3d8a6058440",
    "Salle de bain - Bas": "a70def7d-7071-4950-99d1-3a16e9759eee"
};

// ============================================================
// 1. INITIALISATION DU DASHBOARD
// ============================================================
window.addEventListener('load', () => {
    const savedConfig = localStorage.getItem('HOUSE_CONFIG');
    if (savedConfig) {
        GLOBAL_HOUSE_CONFIG = JSON.parse(savedConfig);
        initialiserDashboard(); // ⬅️ On dessine les tuiles !
    } else {
        alert("⚠️ Aucune zone n'a été paramétrée par l'expert.\nVeuillez d'abord créer vos pièces dans l'espace Expert.");
        window.location.href = 'setup.html';
        return;
    }
    restoreSessionData();
});

// Génération visuelle des tuiles HTML pour chaque pièce
// Génération visuelle des tuiles HTML pour chaque pièce
function initialiserDashboard() {
    const grid = document.getElementById('dashboard-grid');
    if (!grid) return;
    grid.innerHTML = ''; 

    // On boucle sur toutes les pièces du dictionnaire domotique
    for (const [nomPiece, idCapteur] of Object.entries(capteursMaison)) {
        
        const tuile = document.createElement('div');
        tuile.style.cssText = 'background: white; border: 1px solid #e0e0e0; border-radius: 12px; padding: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.05); transition: transform 0.2s;';
        
        // Vérifie si la configuration expert existe pour afficher le bon badge
        const isConfigured = GLOBAL_HOUSE_CONFIG[nomPiece];
        const badgeExpert = isConfigured 
            ? `<span style="font-size: 0.7em; color: #27ae60; background: #e9f7ef; padding: 2px 6px; border-radius: 4px;">⚙️ Config. OK</span>`
            : `<span style="font-size: 0.7em; color: #e74c3c; background: #fdedec; padding: 2px 6px; border-radius: 4px;">⚠️ Manque Config. Expert</span>`;

        tuile.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 15px;">
                <div>
                    <h3 style="margin: 0; font-size: 1.2em; color: #2c3e50;">${nomPiece}</h3>
                    <div style="margin-top: 4px;">${badgeExpert}</div>
                </div>
                <span id="status-${idCapteur}" style="font-size: 0.75em; color: #7f8c8d; background: #f1f2f6; padding: 3px 8px; border-radius: 10px;">En attente</span>
            </div>
            
            <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
                <div style="text-align: center; flex: 1;">
                    <div style="font-size: 0.85em; color: #95a5a6; text-transform: uppercase;">Temp.</div>
                    <div id="temp-${idCapteur}" style="font-size: 1.6em; font-weight: bold; color: #34495e; margin-top: 5px;">--°C</div>
                </div>
                <div style="text-align: center; flex: 1; border-left: 1px solid #eee;">
                    <div style="font-size: 0.85em; color: #95a5a6; text-transform: uppercase;">Humidité</div>
                    <div id="hum-${idCapteur}" style="font-size: 1.6em; font-weight: bold; color: #34495e; margin-top: 5px;">--%</div>
                </div>
            </div>
            
            <div id="pmv-box-${idCapteur}" style="text-align: center; margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 8px; transition: background 0.3s;">
                <div style="font-size: 0.85em; color: #7f8c8d; margin-bottom: 5px;">Indice PMV (Confort)</div>
                <div id="pmv-${idCapteur}" style="font-size: 1.3em; font-weight: bold; color: #bdc3c7;">--</div>
                <div id="pmv-text-${idCapteur}" style="font-size: 0.8em; margin-top: 5px; color: #7f8c8d;">--</div>
            </div>
            
            <button onclick="voirRecommandations('${nomPiece}')" style="width: 100%; padding: 12px; background-color: #3498db; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 1em;">
                🔍 Analyser cette pièce
            </button>
        `;
        grid.appendChild(tuile);
    }
}

function restoreSessionData() {
    const loc = sessionStorage.getItem('location');
    if (loc) document.getElementById('location').value = loc;

    if (sessionStorage.getItem('outdoorTemp')) {
        outdoorTemp = parseFloat(sessionStorage.getItem('outdoorTemp'));
        outdoorHumidity = parseFloat(sessionStorage.getItem('outdoorHumidity'));
        outdoorPressure = parseFloat(sessionStorage.getItem('outdoorPressure'));
        outdoorWind = parseFloat(sessionStorage.getItem('outdoorWind'));
        sunshineStatus = sessionStorage.getItem('sunshineStatus');
    }

    if (sessionStorage.getItem('manualCloAdjustment')) {
        manualCloAdjustment = parseFloat(sessionStorage.getItem('manualCloAdjustment'));
    }
    updateClothingDisplay();
}

// ============================================================
// 2. MOTEUR PHYSIQUE ET CALCULS (Refondus pour le Multi-Pièces)
// ============================================================
function getBaseCloAndMet(zoneId) {
    let met = 1.0; 
    let baseClo = 1.0; 

    if (outdoorTemp > 25) baseClo = 0.5; 
    else if (outdoorTemp < 15) baseClo = 1.2; 

    if (zoneId && GLOBAL_HOUSE_CONFIG[zoneId]) {
        const usages = GLOBAL_HOUSE_CONFIG[zoneId].usages;
        if (usages.includes('gym') || usages.includes('kitchen')) met = 1.6; 
        else if (usages.includes('office')) met = 1.2; 
        else if (usages.includes('bedroom')) {
            met = 0.8; 
            const currentMonth = new Date().getMonth(); 
            if (currentMonth === 11 || currentMonth === 0 || currentMonth === 1) baseClo = 2.5; 
            else if (currentMonth >= 5 && currentMonth <= 7) baseClo = 0.8; 
            else baseClo = 1.5; 
        }
    }
    return { met: met, totalClo: Math.max(0.1, Math.min(4.0, baseClo + manualCloAdjustment)) };
}

function calculateMeanRadiantTemp(zone, t_air) {
    if (!zone || !zone.adj) return t_air;
    const insulation = zone.insulation || 'iti_recent'; 
    let U_wall = 0.3, U_roof = 0.2, U_floor = 0.3;

    if (insulation === 'iti_recent') { U_wall = 0.25; } 
    else if (insulation === 'ite_recent') { U_wall = 0.25; } 
    else if (insulation === 'iti_old') { U_wall = 0.8; U_roof = 0.5; U_floor = 0.8; } 
    else if (insulation === 'ite_old') { U_wall = 0.8; U_roof = 0.5; U_floor = 0.8; } 
    else if (insulation === 'low') { U_wall = 2.5; U_roof = 2.0; U_floor = 2.0; }

    const hi = 8.0; 
    const area = parseFloat(zone.area) || 16;
    const h = parseFloat(zone.height) || 2.5;
    const side = Math.sqrt(area);
    const wallArea = side * h; 
    const floorArea = area;

    let totalArea = 0;
    let sumAreaTemp = 0;

    function getSurfaceTemp(adjacency, U) {
        if (adjacency === 'heated') return t_air; 
        let t_ext_adj = outdoorTemp;
        if (adjacency === 'unheated') t_ext_adj = (t_air + outdoorTemp) / 2; 
        return t_air - (U / hi) * (t_air - t_ext_adj);
    }

    const wallsAdj = [zone.adj.wall1, zone.adj.wall2, zone.adj.wall3, zone.adj.wall4];
    wallsAdj.forEach(adj => {
        sumAreaTemp += (getSurfaceTemp(adj, U_wall) * wallArea);
        totalArea += wallArea;
    });

    let U_floor_actual = (zone.floorType === 'heavy') ? 1.5 : 0.8;
    sumAreaTemp += (getSurfaceTemp(zone.adj.ceiling, U_roof) * floorArea);
    totalArea += floorArea;
    sumAreaTemp += (getSurfaceTemp(zone.adj.floor, U_floor_actual) * floorArea);
    totalArea += floorArea;
    
    if (zone.windows && zone.windows.length > 0) {
        const now = new Date().getTime();
        const sunrise = parseInt(sessionStorage.getItem('sunriseTime')) || now - 1000;
        const sunset = parseInt(sessionStorage.getItem('sunsetTime')) || now + 1000;
        const isDaytime = (now > sunrise && now < sunset);
        const isSunny = sunshineStatus.toLowerCase().includes('clear');

        zone.windows.forEach(win => {
            const wArea = parseFloat(win.area) || 2;
            let U_win = 1.5; 
            if (win.glass === 'single') U_win = 5.8; 
            if (win.glass === 'triple') U_win = 0.8; 
            if (win.glass === 'double_recent') U_win = 1.1;

            let t_win = getSurfaceTemp('outside', U_win);

            if (isDaytime && isSunny && win.mask !== 'heavy') {
                let solarBoost = 0; 
                if (win.orient === 'S') solarBoost = 4.0; 
                else if (win.orient === 'SE' || win.orient === 'SW') solarBoost = 2.5;
                else if (win.orient === 'E' || win.orient === 'W') solarBoost = 1.0;
                if (win.mask === 'partial') solarBoost *= 0.5;
                t_win += solarBoost; 
            }
            sumAreaTemp -= (getSurfaceTemp('outside', U_wall) * wArea);
            sumAreaTemp += (t_win * wArea);
        });
    }
    return sumAreaTemp / totalArea;
}

function calculatePMV(ta, tr, vel, rh, met, clo) {
    if (!ta && ta !== 0) return -99; 
    const M = met * 58.15; 
    const Icl = 0.155 * clo;
    const fcl = (clo <= 0.5) ? (1.0 + 0.2 * clo) : (1.05 + 0.1 * clo);
    const pa = rh * 10 * Math.exp(16.6536 - 4030.183 / (ta + 235));
    const hc = 12.1 * Math.sqrt(Math.max(vel, 0.1));
    const hr = 4.7; 
    const numerateur = 35.7 - (0.028 * M) + (Icl * fcl * (hr * tr + hc * ta));
    const denominateur = 1 + (Icl * fcl * (hr + hc));
    const tcl = numerateur / denominateur;
    const perte_vapeur = 3.05 * 0.001 * (5733 - 6.99 * M - pa);
    const perte_sueur = (M > 58.15) ? 0.42 * (M - 58.15) : 0;
    const perte_resp_latente = 1.7e-5 * M * (5867 - pa);
    const perte_resp_sensible = 0.0014 * M * (34 - ta);
    const perte_rayonnement = fcl * hr * (tcl - tr);
    const perte_convection = fcl * hc * (tcl - ta);
    const ts = 0.303 * Math.exp(-0.036 * M) + 0.028;
    return ts * (M - perte_vapeur - perte_sueur - perte_resp_latente - perte_resp_sensible - perte_rayonnement - perte_convection);
}

// Fonction centrale pour calculer le confort d'UNE tuile et modifier ses couleurs
function mettreAJourTuile(nomPiece) {
    const data = DONNEES_HABITAT[nomPiece];
    const idCapteur = capteursMaison[nomPiece];
    if (!data || !idCapteur) return; // Pas encore de données pour cette pièce

    const zone = GLOBAL_HOUSE_CONFIG[nomPiece];
    let vel = 0.1; 
    if (zone.windows && zone.windows.some(w => w.glass === 'single') && outdoorWind > 20) vel = 0.25;

    const tr = calculateMeanRadiantTemp(zone, data.ta);
    const config = getBaseCloAndMet(nomPiece);
    let pmv = calculatePMV(data.ta, tr, vel, data.rh, config.met, config.totalClo);
    pmv = Math.max(-3, Math.min(3, pmv)); 

    // Mise à jour visuelle (Le Feu Tricolore)
    document.getElementById('temp-' + idCapteur).textContent = data.ta.toFixed(1) + "°C";
    document.getElementById('hum-' + idCapteur).textContent = data.rh.toFixed(1) + "%";
    
    const pmvBox = document.getElementById('pmv-box-' + idCapteur);
    const pmvVal = document.getElementById('pmv-' + idCapteur);
    const pmvText = document.getElementById('pmv-text-' + idCapteur);
    
    pmvVal.textContent = pmv.toFixed(2);

    if (pmv < -0.5) { 
        pmvBox.style.backgroundColor = "#e8f4f8"; 
        pmvVal.style.color = "#3498db"; 
        pmvText.textContent = "Sensation Fraîche 🥶";
    } else if (pmv > 0.5) { 
        pmvBox.style.backgroundColor = "#fdedec"; 
        pmvVal.style.color = "#e74c3c"; 
        pmvText.textContent = "Sensation Chaude 🥵";
    } else { 
        pmvBox.style.backgroundColor = "#e9f7ef"; 
        pmvVal.style.color = "#27ae60"; 
        pmvText.textContent = "Zone Neutre (Confort) ✅";
    }
}

// Relancer toutes les tuiles d'un coup (Quand on change d'habit ou que la météo change)
function recalculerToutLeDashboard() {
    for (const nomPiece in DONNEES_HABITAT) {
        mettreAJourTuile(nomPiece);
    }
}

// ============================================================
// 3. VÊTEMENTS ET MÉTÉO (Interactions Globales)
// ============================================================
function adjustClothing(amount) { 
    manualCloAdjustment += amount; 
    updateClothingDisplay();
    recalculerToutLeDashboard(); // ⬅️ On actualise toutes les tuiles
}
function resetClothing() { 
    manualCloAdjustment = 0; 
    updateClothingDisplay();
    recalculerToutLeDashboard(); 
}
function updateClothingDisplay() {
    const config = getBaseCloAndMet(null); // Moyenne
    const cloSpan = document.getElementById('currentCloValue');
    if (cloSpan) cloSpan.textContent = config.totalClo.toFixed(1);
}

// --- DEBUT DU BLOC METEO A REMPLACER ---
document.getElementById('getWeatherButton').addEventListener('click', () => {
    const city = document.getElementById('location').value.trim();
    if (!city) { alert("Veuillez entrer une ville."); return; }
    
    const btn = document.getElementById('getWeatherButton');
    const originalText = btn.textContent;
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric&lang=fr`;
    fetchWeather(url, btn, originalText);
});

document.getElementById('geoLocateButton').addEventListener('click', () => {
    const btn = document.getElementById('geoLocateButton');
    const originalText = btn.textContent;

    if ("geolocation" in navigator) {
        btn.textContent = "⏳...";
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=fr`;
                fetchWeather(url, btn, originalText);
            },
            (error) => {
                alert("📍 Le navigateur bloque l'accès au GPS. Tapez la ville manuellement.");
                btn.textContent = originalText;
            }
        );
    }
});

function fetchWeather(url, btnElement, originalBtnText) {
    if(btnElement) btnElement.textContent = "⏳...";
    
    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error("Erreur API");
            return res.json();
        })
        .then(data => {
            outdoorTemp = data.main.temp;
            outdoorHumidity = data.main.humidity;
            outdoorPressure = data.main.pressure;
            outdoorWind = (data.wind.speed * 3.6); 
            sunshineStatus = data.weather[0].main;
            
            sessionStorage.setItem('sunriseTime', data.sys.sunrise * 1000);
            sessionStorage.setItem('sunsetTime', data.sys.sunset * 1000);
            document.getElementById('location').value = data.name;
            
            if(btnElement) {
                btnElement.textContent = "✅"; 
                setTimeout(() => btnElement.textContent = originalBtnText, 2000);
            }
            
            updateClothingDisplay();
            recalculerToutLeDashboard(); 
        })
        .catch(err => { 
            console.error("Erreur détaillée :", err);
            alert("❌ Erreur : Ville introuvable ou problème de connexion."); 
            if(btnElement) btnElement.textContent = originalBtnText; 
        });
}
// --- FIN DU BLOC METEO ---

// ============================================================
// 4. LECTURE DES CAPTEURS (Stratégie 1 en préparation)
// ============================================================
// Attention : En attendant l'URL Make.com globale (Bulk API), 
// ce bouton interroge actuellement les pièces une par une.
async function synchroniserTouteLaMaison() {
    const btn = document.getElementById('btn-sync-all');
    btn.innerHTML = "⏳ Scan des capteurs en cours...";
    btn.style.backgroundColor = "#9b59b6";

    // On boucle sur toutes les pièces configurées
    for (const [nomPiece, idCapteur] of Object.entries(capteursMaison)) {
        if (!GLOBAL_HOUSE_CONFIG[nomPiece]) continue; 

        const statusEl = document.getElementById('status-' + idCapteur);
        statusEl.textContent = "📡 Ping...";
        statusEl.style.color = "#f39c12";

        try {
            // APPEL AU SERVEUR MAKE (À remplacer par un appel unique plus tard)
            const url = 'https://hook.eu1.make.com/0jz9xnz6phk3nmn5pdwkijlylowdxosd?capteur_id=' + idCapteur;
            const response = await fetch(url);
            if (!response.ok) throw new Error("Erreur Serveur");
            
            const data = await response.json();
            
            if (data.temperature) {
                // On sauvegarde la donnée en mémoire
                DONNEES_HABITAT[nomPiece] = { ta: parseFloat(data.temperature), rh: parseFloat(data.humidity) };
                
                // On met à jour l'affichage de Fanger pour cette tuile
                mettreAJourTuile(nomPiece);
                
                const now = new Date();
                statusEl.textContent = "Actuel (" + now.getHours() + "h" + now.getMinutes() + ")";
                statusEl.style.color = "#27ae60";
            }
        } catch (error) {
            statusEl.textContent = "❌ Hors Ligne";
            statusEl.style.color = "#e74c3c";
        }
    }

    btn.innerHTML = "⚡ Actualiser toutes les pièces";
    btn.style.backgroundColor = "#8e44ad";
}

// ============================================================
// 5. ENVOI DES DONNÉES VERS PAGE 2 (Le Diagnostic Expert)
// ============================================================
function voirRecommandations(nomPiece) {
    if (!DONNEES_HABITAT[nomPiece]) {
        alert("⚠️ Aucune donnée pour " + nomPiece + ". Veuillez d'abord cliquer sur 'Actualiser' !");
        return;
    }

    const data = DONNEES_HABITAT[nomPiece];
    const zone = GLOBAL_HOUSE_CONFIG[nomPiece];
    const config = getBaseCloAndMet(nomPiece);
    const tr = calculateMeanRadiantTemp(zone, data.ta);
    const opTemp = (data.ta + tr) / 2;
    const pmv = document.getElementById('pmv-' + capteursMaison[nomPiece]).textContent;

    // Sauvegarde contextuelle avant voyage vers Page 2
    sessionStorage.setItem('currentZoneId', nomPiece);
    sessionStorage.setItem('roomType', zone.usages[0] || 'living'); 
    
    let insulationLvl = 'medium';
    if(zone.insulation === 'low') insulationLvl = 'low';
    else if(zone.insulation === 'ite_recent' || zone.insulation === 'iti_recent') insulationLvl = 'high';
    
    sessionStorage.setItem('buildingInsulation', insulationLvl);
    sessionStorage.setItem('calculatedOperativeTemp', opTemp.toFixed(1));
    sessionStorage.setItem('calculatedPMV', pmv);
    sessionStorage.setItem('calculatedClo', config.totalClo.toFixed(1));
    
    sessionStorage.setItem('indoorAirTemp', data.ta);
    sessionStorage.setItem('indoorHumidity', data.rh);
    sessionStorage.setItem('location', document.getElementById('location').value);
    sessionStorage.setItem('manualCloAdjustment', manualCloAdjustment); 

    sessionStorage.setItem('outdoorTemp', outdoorTemp);
    sessionStorage.setItem('outdoorHumidity', outdoorHumidity);
    sessionStorage.setItem('outdoorPressure', outdoorPressure);
    sessionStorage.setItem('sunshineStatus', sunshineStatus);
    sessionStorage.setItem('outdoorWind', outdoorWind);

    // En route vers l'audit !
    window.location.href = 'page2.html';
}