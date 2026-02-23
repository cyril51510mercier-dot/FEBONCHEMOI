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

// ============================================================
// 1. INITIALISATION & RESTAURATION
// ============================================================
window.addEventListener('load', () => {
    // 1. Charger la configuration experte
    const savedConfig = localStorage.getItem('HOUSE_CONFIG');
    if (savedConfig) {
        GLOBAL_HOUSE_CONFIG = JSON.parse(savedConfig);
        populateZoneSelect();
    } else {
        alert("⚠️ Aucune zone n'a été paramétrée par l'expert.\nVeuillez d'abord créer vos pièces dans l'espace Expert.");
        window.location.href = 'setup.html';
        return;
    }

    // 2. Restaurer la session utilisateur (s'il revient de la page 2)
    restoreSessionData();
});

function populateZoneSelect() {
    const select = document.getElementById('zoneSelect');
    select.innerHTML = '<option value="">-- Choisissez une zone --</option>';
    
    for (const key in GLOBAL_HOUSE_CONFIG) {
        const zone = GLOBAL_HOUSE_CONFIG[key];
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = `📍 ${zone.name}`;
        select.appendChild(opt);
    }
}

function restoreSessionData() {
    if (sessionStorage.getItem('currentZoneId')) {
        document.getElementById('zoneSelect').value = sessionStorage.getItem('currentZoneId');
    }
    
    const fields = ['airTemp', 'relativeHumidity', 'airVelocity', 'location'];
    fields.forEach(id => {
        const val = sessionStorage.getItem(id);
        if(val !== null && document.getElementById(id)) {
            document.getElementById(id).value = val;
        }
    });

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
    calculateAndDisplay();
}

// ============================================================
// 2. MOTEUR PHYSIQUE : CALCUL DES TEMPÉRATURES DE PAROIS=
// ============================================================
function calculateMeanRadiantTemp(zone, t_air) {
    // Si la zone n'est pas définie, on suppose que Tr = T_air (bâtiment neutre)
    if (!zone || !zone.adj) return t_air;

    // Détermination de l'isolation (Coefficient U estimé en W/m².K)
    let U_wall = 2.5; // Par défaut : passoire thermique
    if (zone.insulPos === 'ITI' || zone.insulPos === 'ITE') U_wall = 0.4; // Bien isolé
    else if (zone.insulPos === 'ITR') U_wall = 0.8; // Moyen
    else if (zone.wallMat === 'wood') U_wall = 1.0; 

    const U_window = 1.5; // Simplification (on pourrait affiner selon vitrage)
    const hi = 8.0; // Coefficient d'échange superficiel intérieur (Constant physique)

    // Calcul géométrique (On suppose une pièce carrée pour répartir les surfaces)
    const area = parseFloat(zone.area) || 16;
    const h = parseFloat(zone.height) || 2.5;
    const side = Math.sqrt(area);
    const wallArea = side * h; // Surface d'un seul mur
    const floorArea = area;

    let totalArea = 0;
    let sumAreaTemp = 0;

    // Fonction de calcul de la T° de surface (Tsi) selon l'adjacence
    function getSurfaceTemp(adjacency, U) {
        if (adjacency === 'heated') return t_air; // Mur mitoyen chauffé = T°air
        
        let t_ext_adj = outdoorTemp;
        if (adjacency === 'unheated') {
            t_ext_adj = (t_air + outdoorTemp) / 2; // Garage/Cellier à mi-chemin
        }
        
        // Formule physique du gradient thermique : Tsi = Tint - (U/hi) * (Tint - Text)
        return t_air - (U / hi) * (t_air - t_ext_adj);
    }

    // 1. Les 4 Murs
    const wallsAdj = [zone.adj.wall1, zone.adj.wall2, zone.adj.wall3, zone.adj.wall4];
    wallsAdj.forEach(adj => {
        const tsi = getSurfaceTemp(adj, U_wall);
        sumAreaTemp += (tsi * wallArea);
        totalArea += wallArea;
    });

    // 2. Plafond et Sol (U ajusté pour sol)
    let U_floor = (zone.floorType === 'heavy') ? 1.5 : 0.8;
    const t_ceiling = getSurfaceTemp(zone.adj.ceiling, U_wall);
    const t_floor = getSurfaceTemp(zone.adj.floor, U_floor);
    
    sumAreaTemp += (t_ceiling * floorArea);
    totalArea += floorArea;
    sumAreaTemp += (t_floor * floorArea);
    totalArea += floorArea;
    
        // 3. Vitrages (Calcul des Déperditions ET Apports Solaires)
    if (zone.windows && zone.windows.length > 0) {
        
        // On vérifie s'il fait jour et s'il y a du soleil
        const now = new Date().getTime();
        const sunrise = parseInt(sessionStorage.getItem('sunriseTime')) || now - 1000;
        const sunset = parseInt(sessionStorage.getItem('sunsetTime')) || now + 1000;
        const isDaytime = (now > sunrise && now < sunset);
        const isSunny = sunshineStatus.toLowerCase().includes('clear');

        zone.windows.forEach(win => {
            const wArea = parseFloat(win.area) || 2;
            
            // A. DÉPERDITION : Qualité du vitrage
            let U_win = 1.5; // Double standard par défaut
            if (win.glass === 'single') U_win = 5.8; // Passoire thermique
            if (win.glass === 'triple') U_win = 0.8; // Très isolant
            if (win.glass === 'double_recent') U_win = 1.1;

            // Température de base de la vitre intérieure sans soleil
            let t_win = getSurfaceTemp('outside', U_win);

            // B. APPORTS SOLAIRES : L'effet "Radiateur"
            if (isDaytime && isSunny && win.mask !== 'heavy') {
                let solarBoost = 0; // Bonus de température en degrés
                
                // Puissance du soleil selon l'orientation
                if (win.orient === 'S') solarBoost = 4.0; // Plein Sud = Max de chaleur
                else if (win.orient === 'SE' || win.orient === 'SW') solarBoost = 2.5;
                else if (win.orient === 'E' || win.orient === 'W') solarBoost = 1.0;
                else if (win.orient === 'N') solarBoost = 0.0; // Aucun apport direct au Nord

                // Réduction si un arbre ou balcon fait de l'ombre
                if (win.mask === 'partial') solarBoost *= 0.5;

                // On ajoute cette chaleur gratuite à la température de la vitre
                t_win += solarBoost; 
            }

            // On retire la surface de mur équivalente, et on intègre notre vitre calculée
            sumAreaTemp -= (getSurfaceTemp('outside', U_wall) * wArea);
            sumAreaTemp += (t_win * wArea);
        });
    }
    

    // Température Rayonnante Moyenne (Tr)
    return sumAreaTemp / totalArea;
}

// ============================================================
// 3. GESTION MÉTÉO (API & GÉOLOCALISATION)
// ============================================================

// A. Méthode Manuelle (par nom de ville)
document.getElementById('getWeatherButton').addEventListener('click', () => {
    const city = document.getElementById('location').value.trim();
    if (!city) { alert("Veuillez entrer une ville."); return; }

    const searchBtn = document.getElementById('getWeatherButton');
    const originalText = searchBtn.textContent;
    searchBtn.textContent = "⏳..."; // Petit effet d'attente

    const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric&lang=fr`;
    
    // On appelle la fonction en lui passant le bouton pour qu'il s'anime
    fetchWeather(url, searchBtn, originalText); 

});

// B. Méthode Automatique (Géolocalisation GPS)
document.getElementById('geoLocateButton').addEventListener('click', () => {
    const geoBtn = document.getElementById('geoLocateButton');
    
    if ("geolocation" in navigator) {
        const originalText = geoBtn.textContent;
        geoBtn.textContent = "⏳ Recherche...";
        
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=fr`;
                
                fetchWeather(url, geoBtn, originalText);
            },
            (error) => {
                console.warn(error);
                alert("📍 Impossible d'accéder à votre position. Tapez la ville manuellement.");
                geoBtn.textContent = originalText;
            }
        );
    } else {
        alert("La géolocalisation n'est pas supportée par votre navigateur.");
    }
});

// C. Fonction commune de traitement des données Météo
function fetchWeather(url, btnElement = null, originalBtnText = "") {
    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error("Données introuvables");
            return res.json();
        })
        .then(data => {
            // 1. Mise à jour des variables globales
            outdoorTemp = data.main.temp;
            outdoorHumidity = data.main.humidity;
            outdoorPressure = data.main.pressure;
            outdoorWind = (data.wind.speed * 3.6); 
            sunshineStatus = data.weather[0].main;
// NOUVEAU : On capture les heures de lever/coucher (fournies en secondes, on passe en millisecondes pour le JS)
sessionStorage.setItem('sunriseTime', data.sys.sunrise * 1000);
sessionStorage.setItem('sunsetTime', data.sys.sunset * 1000);

            // 2. Auto-remplissage du champ ville avec le nom officiel renvoyé par l'API
            document.getElementById('location').value = data.name;

            // 3. Pré-remplir les champs intérieurs si vides
            if(document.getElementById('airTemp').value === '') document.getElementById('airTemp').value = outdoorTemp.toFixed(1);
            if(document.getElementById('relativeHumidity').value === '') document.getElementById('relativeHumidity').value = outdoorHumidity;

            // 4. Mettre à jour les calculs
            updateClothingDisplay();
            calculateAndDisplay();
            
            // 5. Retour visuel de SUCCÈS sur le bouton cliqué (Chercher ou Localiser)
            if (btnElement) {
                btnElement.textContent = "✅ Fait !";
                btnElement.style.backgroundColor = "#27ae60"; // Passe au vert
                btnElement.style.color = "white";
                btnElement.style.borderColor = "#27ae60";
                
                // Remet le bouton à son état normal après 2 secondes
                setTimeout(() => {
                    btnElement.textContent = originalBtnText;
                    btnElement.style.backgroundColor = ""; 
                    btnElement.style.color = "";
                    btnElement.style.borderColor = "";
                }, 2000);
            }
        })
        .catch(err => { 
            console.error(err); 
            alert("Erreur : Ville introuvable ou problème de connexion."); 
            if (btnElement) {
                btnElement.textContent = originalBtnText;
                btnElement.style.backgroundColor = "";
                btnElement.style.color = "";
                btnElement.style.borderColor = "";
            }
        });
}

// ============================================================
// 4. GESTION VÊTEMENTS ET MÉTABOLISME
// ============================================================
function adjustClothing(amount) { manualCloAdjustment += amount; calculateAndDisplay(); }
function resetClothing() { manualCloAdjustment = 0; calculateAndDisplay(); }

function getBaseCloAndMet() {
    let met = 1.0; // Métabolisme par défaut (assis au repos)
    let baseClo = 1.0; 

    // 1. Tenue de base de jour selon la météo
    if (outdoorTemp > 25) baseClo = 0.5; // Été (T-shirt)
    else if (outdoorTemp < 15) baseClo = 1.2; // Hiver (Pull)

    // 2. Adaptation selon l'USAGE de la zone
    const zoneId = document.getElementById('zoneSelect').value;
    if (zoneId && GLOBAL_HOUSE_CONFIG[zoneId]) {
        const usages = GLOBAL_HOUSE_CONFIG[zoneId].usages;
        
        // Zones actives
        if (usages.includes('gym') || usages.includes('kitchen')) {
            met = 1.6; // On bouge beaucoup
        } 
        else if (usages.includes('office')) {
            met = 1.2; // Activité de bureau
        }
        // Zone de sommeil (La gestion intelligente de la couette)
        else if (usages.includes('bedroom')) {
            met = 0.8; // Le métabolisme chute pendant le sommeil
            
            // --- NOUVELLE LOGIQUE : Couette saisonnière ---
            const currentMonth = new Date().getMonth(); // 0 = Janvier, 11 = Décembre
            
            // Hiver (Décembre, Janvier, Février)
            if (currentMonth === 11 || currentMonth === 0 || currentMonth === 1) {
                baseClo = 2.5; // Grosse couette d'hiver
            }
            // Été (Juin, Juillet, Août)
            else if (currentMonth >= 5 && currentMonth <= 7) {
                baseClo = 0.8; // Simple drap ou couette très d'été
            }
            // Mi-saison (Printemps: Mars-Mai / Automne: Sept-Nov)
            else {
                baseClo = 1.5; // Couette légère mi-saison
            }
        }
    }

    return { 
        met: met, 
        totalClo: Math.max(0.1, Math.min(4.0, baseClo + manualCloAdjustment))
    };
}

function updateClothingDisplay() {
    const config = getBaseCloAndMet();
    const cloSpan = document.getElementById('currentCloValue');
    if (cloSpan) cloSpan.textContent = config.totalClo.toFixed(1);
}

// ============================================================
// 5. CALCUL PMV ET AFFICHAGE
// ============================================================
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

function calculateAndDisplay() {
    const zoneId = document.getElementById('zoneSelect').value;
    const ta = parseFloat(document.getElementById('airTemp').value);
    const vel = parseFloat(document.getElementById('airVelocity').value) || 0.1;
    const rh = parseFloat(document.getElementById('relativeHumidity').value) || 50;
    
    let tr = ta; // Par défaut si aucune zone n'est sélectionnée

    // --- LE MOTEUR MAGIQUE ---
    if (zoneId && GLOBAL_HOUSE_CONFIG[zoneId] && !isNaN(ta)) {
        tr = calculateMeanRadiantTemp(GLOBAL_HOUSE_CONFIG[zoneId], ta);
    }

    const config = getBaseCloAndMet();
    updateClothingDisplay(); 

    if (!isNaN(ta)) {
        let pmv = calculatePMV(ta, tr, vel, rh, config.met, config.totalClo);
        pmv = Math.max(-3, Math.min(3, pmv)); 
        
        const top = (ta + tr) / 2; 
        document.getElementById('operativeTempValue').textContent = top.toFixed(1);
        
        const pmvEl = document.getElementById('pmvValue');
        pmvEl.textContent = pmv.toFixed(2);
        const statusEl = document.getElementById('comfortStatusText');
        
        if (pmv < -0.5) { pmvEl.style.color = "#007bff"; statusEl.textContent = "Sensation : FRAIS / FROID"; }
        else if (pmv > 0.5) { pmvEl.style.color = "#dc3545"; statusEl.textContent = "Sensation : CHAUD"; }
        else { pmvEl.style.color = "#28a745"; statusEl.textContent = "CONFORTABLE (Zone Neutre)"; }
    }
}

// ============================================================
// 6. NAVIGATION VERS PAGE 2
// ============================================================
document.getElementById('viewRecommendationsButton').addEventListener('click', () => {
    const zoneId = document.getElementById('zoneSelect').value;
    if (!zoneId) {
        alert("Veuillez sélectionner une zone avant de voir les recommandations.");
        return;
    }

    const opTemp = document.getElementById('operativeTempValue').textContent;
    const ta = document.getElementById('airTemp').value;

    if (opTemp !== '--' && ta !== '') {
        sessionStorage.setItem('currentZoneId', zoneId);
        
        // Traduction de la zone experte pour la Page 2
        const zone = GLOBAL_HOUSE_CONFIG[zoneId];
        sessionStorage.setItem('roomType', zone.usages[0] || 'living'); // On prend le 1er usage principal
        
        let insulationLvl = 'medium';
        if(zone.insulPos === 'NONE') insulationLvl = 'low';
        else if(zone.insulPos === 'ITE' || zone.insulPos === 'ITI') insulationLvl = 'high';
        sessionStorage.setItem('buildingInsulation', insulationLvl);

        // Sauvegarde résultats
        sessionStorage.setItem('calculatedOperativeTemp', opTemp);
        sessionStorage.setItem('calculatedPMV', document.getElementById('pmvValue').textContent);
        sessionStorage.setItem('calculatedClo', document.getElementById('currentCloValue').textContent);
        
        // Sauvegarde inputs
        sessionStorage.setItem('indoorAirTemp', ta);
        sessionStorage.setItem('indoorHumidity', document.getElementById('relativeHumidity').value);
        sessionStorage.setItem('airVelocity', document.getElementById('airVelocity').value);
        sessionStorage.setItem('location', document.getElementById('location').value);
        sessionStorage.setItem('manualCloAdjustment', manualCloAdjustment); 

        // Sauvegarde météo
        sessionStorage.setItem('outdoorTemp', outdoorTemp);
        sessionStorage.setItem('outdoorHumidity', outdoorHumidity);
        sessionStorage.setItem('outdoorPressure', outdoorPressure);
        sessionStorage.setItem('sunshineStatus', sunshineStatus);
        sessionStorage.setItem('outdoorWind', outdoorWind);

        window.location.href = 'page2.html';
    } else {
        alert("Veuillez saisir la température de l'air ambiant.");
    }
});

// Écouteurs de mise à jour temps réel
const inputs = document.querySelectorAll('input, select');
inputs.forEach(input => {
    input.addEventListener('input', calculateAndDisplay);
    input.addEventListener('change', calculateAndDisplay);

});


