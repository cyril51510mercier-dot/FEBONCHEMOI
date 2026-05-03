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
    
    const fields = ['airTemp', 'relativeHumidity', 'location'];
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
// 2. MOTEUR PHYSIQUE : CALCUL DES TEMPÉRATURES DE PAROIS
// ============================================================
function calculateMeanRadiantTemp(zone, t_air) {
    if (!zone || !zone.adj) return t_air;

    // 1. Définition des performances thermiques (U en W/m².K) et de l'Inertie
    const insulation = zone.insulation || 'iti_recent'; 
    
    let U_wall = 0.3;  
    let U_roof = 0.2;
    let U_floor = 0.3;
    let inertia = 'light'; 

    if (insulation === 'iti_recent') {
        U_wall = 0.25; inertia = 'light'; 
    } 
    else if (insulation === 'ite_recent') {
        U_wall = 0.25; inertia = 'heavy'; 
    } 
    else if (insulation === 'iti_old') {
        U_wall = 0.8;  inertia = 'light';
        U_roof = 0.5;  U_floor = 0.8;
    } 
    else if (insulation === 'ite_old') {
        U_wall = 0.8;  inertia = 'heavy';
        U_roof = 0.5;  U_floor = 0.8;
    } 
    else if (insulation === 'low') {
        U_wall = 2.5;  inertia = 'heavy'; 
        U_roof = 2.0;  U_floor = 2.0;
    }

    sessionStorage.setItem('zoneInertia', inertia);

    const U_window = 1.5; 
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
        if (adjacency === 'unheated') {
            t_ext_adj = (t_air + outdoorTemp) / 2; 
        }
        
        return t_air - (U / hi) * (t_air - t_ext_adj);
    }

    // 1. Les 4 Murs
    const wallsAdj = [zone.adj.wall1, zone.adj.wall2, zone.adj.wall3, zone.adj.wall4];
    wallsAdj.forEach(adj => {
        const tsi = getSurfaceTemp(adj, U_wall);
        sumAreaTemp += (tsi * wallArea);
        totalArea += wallArea;
    });

    // 2. Plafond et Sol
    let U_floor_actual = (zone.floorType === 'heavy') ? 1.5 : 0.8;
    const t_ceiling = getSurfaceTemp(zone.adj.ceiling, U_roof);
    const t_floor = getSurfaceTemp(zone.adj.floor, U_floor_actual);
    
    sumAreaTemp += (t_ceiling * floorArea);
    totalArea += floorArea;
    sumAreaTemp += (t_floor * floorArea);
    totalArea += floorArea;
    
    // 3. Vitrages
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
                else if (win.orient === 'N') solarBoost = 0.0; 

                if (win.mask === 'partial') solarBoost *= 0.5;

                t_win += solarBoost; 
            }

            sumAreaTemp -= (getSurfaceTemp('outside', U_wall) * wArea);
            sumAreaTemp += (t_win * wArea);
        });
    }
    
    return sumAreaTemp / totalArea;
}

// ============================================================
// 3. GESTION MÉTÉO (API & GÉOLOCALISATION)
// ============================================================
document.getElementById('getWeatherButton').addEventListener('click', () => {
    const city = document.getElementById('location').value.trim();
    if (!city) { alert("Veuillez entrer une ville."); return; }

    const searchBtn = document.getElementById('getWeatherButton');
    const originalText = searchBtn.textContent;
    searchBtn.textContent = "⏳..."; 

    const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric&lang=fr`;
    fetchWeather(url, searchBtn, originalText); 
});

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

function fetchWeather(url, btnElement = null, originalBtnText = "") {
    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error("Données introuvables");
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

            if(document.getElementById('airTemp').value === '') document.getElementById('airTemp').value = outdoorTemp.toFixed(1);
            if(document.getElementById('relativeHumidity').value === '') document.getElementById('relativeHumidity').value = outdoorHumidity;

            updateClothingDisplay();
            calculateAndDisplay();
            
            if (btnElement) {
                btnElement.textContent = "✅ Fait !";
                btnElement.style.backgroundColor = "#27ae60"; 
                btnElement.style.color = "white";
                btnElement.style.borderColor = "#27ae60";
                
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
    let met = 1.0; 
    let baseClo = 1.0; 

    if (outdoorTemp > 25) baseClo = 0.5; 
    else if (outdoorTemp < 15) baseClo = 1.2; 

    const zoneId = document.getElementById('zoneSelect').value;
    if (zoneId && GLOBAL_HOUSE_CONFIG[zoneId]) {
        const usages = GLOBAL_HOUSE_CONFIG[zoneId].usages;
        
        if (usages.includes('gym') || usages.includes('kitchen')) {
            met = 1.6; 
        } 
        else if (usages.includes('office')) {
            met = 1.2; 
        }
        else if (usages.includes('bedroom')) {
            met = 0.8; 
            
            const currentMonth = new Date().getMonth(); 
            
            if (currentMonth === 11 || currentMonth === 0 || currentMonth === 1) {
                baseClo = 2.5; 
            }
            else if (currentMonth >= 5 && currentMonth <= 7) {
                baseClo = 0.8; 
            }
            else {
                baseClo = 1.5; 
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
    let vel = 0.1; 

    if (zoneId && GLOBAL_HOUSE_CONFIG[zoneId]) {
        const zone = GLOBAL_HOUSE_CONFIG[zoneId];
        
        let hasOldWindows = false;
        if (zone.windows) {
            zone.windows.forEach(win => {
                if (win.glass === 'single' || win.glass === 'double_old') {
                    hasOldWindows = true;
                }
            });
        }

        if (hasOldWindows && outdoorWind > 20) {
            vel = 0.25; 
        }
    }
    
    const rh = parseFloat(document.getElementById('relativeHumidity').value) || 50;
    let tr = ta; 

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
        
        const zone = GLOBAL_HOUSE_CONFIG[zoneId];
        sessionStorage.setItem('roomType', zone.usages[0] || 'living'); 
        
        let insulationLvl = 'medium';
        if(zone.insulation === 'low') insulationLvl = 'low';
        else if(zone.insulation === 'ite_recent' || zone.insulation === 'iti_recent') insulationLvl = 'high';
        sessionStorage.setItem('buildingInsulation', insulationLvl);

        sessionStorage.setItem('calculatedOperativeTemp', opTemp);
        sessionStorage.setItem('calculatedPMV', document.getElementById('pmvValue').textContent);
        sessionStorage.setItem('calculatedClo', document.getElementById('currentCloValue').textContent);
        
        sessionStorage.setItem('indoorAirTemp', ta);
        sessionStorage.setItem('indoorHumidity', document.getElementById('relativeHumidity').value);
        sessionStorage.setItem('location', document.getElementById('location').value);
        sessionStorage.setItem('manualCloAdjustment', manualCloAdjustment); 

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

const inputs = document.querySelectorAll('input, select');
inputs.forEach(input => {
    input.addEventListener('input', calculateAndDisplay);
    input.addEventListener('change', calculateAndDisplay);
});

// ============================================================
// 7. CONNEXION IOT : API NETATMO (THERMOSTAT)
// ============================================================
window.lancerNetatmo = async function() {
    const btn = document.getElementById('btnNetatmo');
    const originalText = btn.textContent;
    
    // Test visuel pour prouver que le clic fonctionne bien
    btn.textContent = "⏳ Initialisation...";
    btn.style.backgroundColor = "#f39c12";

    try {
        const clientId = localStorage.getItem('NETATMO_CLIENT_ID');
        const clientSecret = localStorage.getItem('NETATMO_CLIENT_SECRET');
        const refreshToken = localStorage.getItem('NETATMO_REFRESH_TOKEN');

        if (!clientId || !clientSecret || !refreshToken) {
            alert("🔒 Les clés Netatmo ne sont pas configurées.\nVeuillez vous rendre dans l'Espace Expert pour les saisir.");
            btn.textContent = originalText;
            btn.style.backgroundColor = "#e67e22";
            return;
        }

        btn.textContent = "⏳ Auth Netatmo...";

        // Étape 1 : Obtenir un jeton d'accès frais (Access Token)
        const tokenResponse = await fetch('https://api.netatmo.com/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                client_id: clientId,
                client_secret: clientSecret
            })
        });

        if (!tokenResponse.ok) {
            throw new Error("Authentification refusée (Code " + tokenResponse.status + ")");
        }
        
        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;
        
        // Sauvegarde du nouveau refresh token
        localStorage.setItem('NETATMO_REFRESH_TOKEN', tokenData.refresh_token);

        // Étape 2 : Récupérer l'ID de la maison
        btn.textContent = "⏳ Lecture Maison...";
        const homesResponse = await fetch('https://api.netatmo.com/api/homesdata', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const homesData = await homesResponse.json();
        const homeId = homesData.body.homes[0].id;

        // Étape 3 : Récupérer les températures
        btn.textContent = "⏳ Lecture Capteurs...";
        const statusResponse = await fetch(`https://api.netatmo.com/api/homestatus?home_id=${homeId}`, {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        const statusData = await statusResponse.json();
        
        let foundTemp = null;
        const rooms = statusData.body.home.rooms;
        for (let room of rooms) {
            if (room.therm_measured_temperature) {
                foundTemp = room.therm_measured_temperature;
                break; 
            }
        }

        if (foundTemp !== null) {
            document.getElementById('airTemp').value = foundTemp;
            calculateAndDisplay(); // On relance le moteur Fanger
            
            btn.textContent = "✅ " + foundTemp + "°C";
            btn.style.backgroundColor = "#27ae60";
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.backgroundColor = "#e67e22";
            }, 4000);
        } else {
            throw new Error("Thermostat introuvable dans cette maison.");
        }

    } catch (error) {
        console.error("Erreur Netatmo:", error);
        
        // Alerte détaillée pour le diagnostic
        if (error.message.includes("Failed to fetch")) {
            alert("❌ Erreur réseau ou blocage de sécurité (CORS) par Netatmo.");
        } else {
            alert("❌ Erreur : " + error.message);
        }
        
        btn.textContent = originalText;
        btn.style.backgroundColor = "#e67e22";
    }
};