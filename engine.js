// ============================================================
// SOLSTICE - MOTEUR DE CALCUL THERMIQUE ET DASHBOARD (ISO 7730)
// ============================================================

let outdoorTemp = 15, outdoorHumidity = 50, outdoorPressure = 1013, outdoorWind = 0, sunshineStatus = 'Clouds';
let manualCloAdjustment = 0; 
let includeBufferZones = localStorage.getItem('SOLSTICE_INCLUDE_BUFFER') !== 'false';
const apiKey = '4ec1eb2b0cc90a4b18a79008b17581a8'; 
let GLOBAL_HOUSE_CONFIG = {};
let DONNEES_HABITAT = {}; 
let SELECTION_PIECES = [];

let capteursMaison = {};
window.hourlyExtForecast = []; // Tableau des 24h de la journée (00h à 23h)

// Variables d'état pour le tri du tableau
let currentSortCol = null;
let currentSortAsc = true;

// ============================================================
// SOLSTICE STORE — GESTION DU STOCKAGE CENTRALISÉ
// ============================================================
window.SolsticeStore = {
    STORAGE_KEY: 'HOUSE_CONFIG',
    init() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            console.error("[Solstice] Erreur Storage :", e);
            return {};
        }
    },
    saveZone(zoneId, zoneData) {
        if (!zoneId) return false;
        const config = this.getZones();
        config[zoneId] = zoneData;
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(config));
            return true;
        } catch (e) {
            console.error("[Solstice] Échec sauvegarde :", e);
            return false;
        }
    },
    getZone(zoneId) { 
        const config = this.getZones();
        return config[zoneId] || null; 
    },
    getAllZones() { return this.getZones(); },
    getZones() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    },
    getScanData() {
        try {
            const cached = localStorage.getItem('SOLSTICE_DONNEES_HABITAT') || sessionStorage.getItem('SOLSTICE_DONNEES_HABITAT');
            return cached ? JSON.parse(cached) : {};
        } catch (e) {
            return {};
        }
    },
    getEnvData() {
        return {
            t_ext: parseFloat(localStorage.getItem('outdoorTemp')) || outdoorTemp,
            rh_ext: parseFloat(localStorage.getItem('outdoorHumidity')) || outdoorHumidity,
            sun_status: localStorage.getItem('sunshineStatus') || sunshineStatus
        };
    },
    getCheckedRecos() {
        try {
            const raw = localStorage.getItem('SOLSTICE_CHECKED_RECOS');
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    },
    saveCheckedRecos(data) {
        try {
            localStorage.setItem('SOLSTICE_CHECKED_RECOS', JSON.stringify(data));
            return true;
        } catch (e) {
            return false;
        }
    }
};

// ============================================================
// SOLSTICE ENGINE — MOTEUR THERMIQUE & RECOMMANDATIONS
// ============================================================
window.SolsticeEngine = {
    calculatePMV,
    calculateMeanRadiantTemp,
    calculateAirVelocity,
    getBaseCloAndMet
};

SolsticeEngine.ENERGY_COSTS = {
    elec_direct: { pricePerKwh: 0.2516, label: "Électricité (Tarif Réglementé)" },
    pac_air_eau: { pricePerKwh: 0.2516 / 3.2, label: "PAC Air/Eau (COP moyen 3,2)" },
    pac_air_air: { pricePerKwh: 0.2516 / 3.0, label: "PAC Air/Air (COP moyen 3,0)" },
    gaz_condens: { pricePerKwh: 0.1180, label: "Gaz Naturel" },
    granules:    { pricePerKwh: 0.0890, label: "Granulés / Pellets" },
    fioul:       { pricePerKwh: 0.1350, label: "Fioul Domestique" }
};

SolsticeEngine.PROFILES = {
    short_term: { label: "Court termiste", allowedLevels: [1], pmvThreshold: 0.5, maxDeltaPmv: 0.0 },
    mid_term:   { label: "Moyen termiste", allowedLevels: [1, 2], pmvThreshold: 0.5, maxDeltaPmv: 0.3 },
    long_term:  { label: "Long termiste", allowedLevels: [1, 2, 3], pmvThreshold: 0.5, maxDeltaPmv: 0.6 }
};

SolsticeEngine.evaluateSimulatedPMV = function(baseState, checkedActionKeys, envData) {
    let simTa = baseState.ta;
    let simTr = baseState.tr;
    let simVel = baseState.vel;
    let simRh = baseState.rh;

    if (checkedActionKeys.includes('shutter_close') || checkedActionKeys.includes('anticipate_sun')) {
        simTr -= 0.6;
        simTa -= 0.2;
    }
    if (checkedActionKeys.includes('free_cooling')) {
        simTa = Math.max(envData.t_ext, simTa - 0.5);
        simTr -= 0.4;
    }
    if (checkedActionKeys.includes('fan_on')) {
        simVel += 0.25;
    }
    if (checkedActionKeys.includes('vmc_boost') || checkedActionKeys.includes('open_win_humidity')) {
        simRh = Math.max(45, simRh - 6);
    }
    if (checkedActionKeys.includes('sun_heat')) {
        simTr += 0.6;
        simTa += 0.2;
    }

    const pmvSim = this.calculatePMV(simTa, simTr, simVel, simRh, baseState.met, baseState.clo);
    return { pmv: pmvSim, simTa, simTr, simVel, simRh };
};

function getClothingDescription(clo) {
    if (clo < 0.45) return "Maillot de bain / Short & débardeur léger";
    if (clo < 0.65) return "T-shirt, short / jupe légère & nu-pieds";
    if (clo < 0.85) return "Pantalon léger & t-shirt manches longues";
    if (clo < 1.05) return "Pantalon, chemise ou pull léger";
    if (clo < 1.25) return "Pull chaud, pantalon épais & chaussettes";
    return "Gros pull, veste d'intérieur & plaid";
}

function rafraichirCapteursDepuisConfig() {
    capteursMaison = {};
    Object.values(GLOBAL_HOUSE_CONFIG).forEach(zone => {
        if (zone.name && (zone.sensorId || zone.id)) {
            capteursMaison[zone.name] = zone.sensorId || zone.id;
        }
    });
}

function getZoneConfigByName(roomName) { 
    return Object.values(GLOBAL_HOUSE_CONFIG).find(z => z.name === roomName); 
}

function isOutdoorZone(nomPiece, zoneConfig) {
    if (nomPiece && (nomPiece.toLowerCase().includes('extér') || nomPiece.toLowerCase().includes('exter'))) {
        return true;
    }
    if (zoneConfig && Array.isArray(zoneConfig.usages) && zoneConfig.usages.includes('outdoor')) {
        return true;
    }
    return false;
}

function isBufferZone(nomPiece, zoneConfig) {
    if (isOutdoorZone(nomPiece, zoneConfig)) return false;
    if (zoneConfig) {
        if (zoneConfig.isBuffer === true) return true;
        if (Array.isArray(zoneConfig.usages) && (zoneConfig.usages.includes('buffer') || zoneConfig.usages.includes('unheated'))) return true;
        if (zoneConfig.category === 'buffer' || zoneConfig.type === 'buffer') return true;
    }
    const nameLower = (nomPiece || '').toLowerCase();
    return nameLower.includes('garage') || nameLower.includes('cave') || nameLower.includes('cellier') || nameLower.includes('grenier');
}

window.toggleIncludeBuffer = function(checked) {
    includeBufferZones = checked;
    localStorage.setItem('SOLSTICE_INCLUDE_BUFFER', checked ? 'true' : 'false');
    actualiserCockpitGlobal();
};

window.addEventListener('load', () => {
    const savedConfig = localStorage.getItem('HOUSE_CONFIG');
    if (savedConfig) { 
        GLOBAL_HOUSE_CONFIG = JSON.parse(savedConfig); 
        rafraichirCapteursDepuisConfig();
    } else { 
        alert("Veuillez paramétrer l'habitat dans l'espace Expert."); 
        window.location.href = 'setup.html'; 
        return; 
    }

    const savedSelection = localStorage.getItem('SOLSTICE_SELECTION_PIECES');
    if (savedSelection) {
        SELECTION_PIECES = JSON.parse(savedSelection);
    } else {
        SELECTION_PIECES = Object.keys(capteursMaison);
        localStorage.setItem('SOLSTICE_SELECTION_PIECES', JSON.stringify(SELECTION_PIECES));
    }

    const bufferCheckbox = document.getElementById('include-buffer-checkbox');
    if (bufferCheckbox) {
        bufferCheckbox.checked = includeBufferZones;
    }

    const cachedForecast = localStorage.getItem('SOLSTICE_HOURLY_FORECAST');
    if (cachedForecast) {
        try { window.hourlyExtForecast = JSON.parse(cachedForecast); } catch(e) {}
    }

    genererSelecteurPieces();
    initialiserDashboard(); 
    restoreSessionData();

    const savedLoc = localStorage.getItem('location') || 'Reims';
    const savedLat = localStorage.getItem('SOLSTICE_LAT');
    const savedLon = localStorage.getItem('SOLSTICE_LON');

    const locEl = document.getElementById('location');
    if (locEl) locEl.value = savedLoc;

    const summaryCityEl = document.getElementById('summary-city-name');
    if (summaryCityEl) summaryCityEl.textContent = savedLoc;

    if (savedLat && savedLon) {
        fetchOneCallWeather(parseFloat(savedLat), parseFloat(savedLon), savedLoc);
    } else {
        rechercherMeteoParNomVille(savedLoc);
    }

    const cachedHabitat = localStorage.getItem('SOLSTICE_DONNEES_HABITAT') || sessionStorage.getItem('SOLSTICE_DONNEES_HABITAT');
    if (cachedHabitat) {
        DONNEES_HABITAT = JSON.parse(cachedHabitat);
        recalculerToutLeDashboard();
        for (const nomPiece of SELECTION_PIECES) {
            const idCapteur = capteursMaison[nomPiece];
            if (DONNEES_HABITAT[nomPiece] && idCapteur) {
                const statusEl = document.getElementById('status-' + idCapteur);
                if (statusEl) {
                    statusEl.textContent = "En mémoire";
                    statusEl.style.color = "#10B981";
                }
            }
        }
    }
});

function genererSelecteurPieces() {
    const container = document.getElementById('room-checkboxes');
    if (!container) return;
    container.innerHTML = '';

    Object.keys(capteursMaison).forEach(nomPiece => {
        const isChecked = SELECTION_PIECES.includes(nomPiece);
        const label = document.createElement('label');
        label.style.cssText = `
            display: inline-flex; 
            align-items: center; 
            gap: 6px; 
            cursor: pointer; 
            background: ${isChecked ? '#FDF4F0' : '#F8FAFC'}; 
            padding: 5px 10px; 
            border-radius: 6px; 
            border: 1px solid ${isChecked ? '#D96B43' : '#CBD5E1'};
            font-size: 0.82em;
            color: #1E293B;
            font-weight: 500;
        `;
        label.innerHTML = `
            <input type="checkbox" value="${nomPiece}" ${isChecked ? 'checked' : ''} onchange="onRoomSelectionChange(this)">
            <span>${nomPiece}</span>
        `;
        container.appendChild(label);
    });
}

function initialiserDashboard() {
    const tableBody = document.getElementById('dashboard-table-body');
    const grid = document.getElementById('dashboard-grid');

    if (tableBody) {
        tableBody.innerHTML = '';
        if (SELECTION_PIECES.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: #7f8c8d; padding: 20px;">Aucune zone sélectionnée.</td></tr>`;
            return;
        }

        SELECTION_PIECES.forEach(nomPiece => {
            const zone = getZoneConfigByName(nomPiece) || {};
            const idCapteur = zone.sensorId || zone.id || capteursMaison[nomPiece];
            const tr = document.createElement('tr');
            tr.style.cssText = 'border-bottom: 1px solid #E2E8F0;';
            tr.setAttribute('data-room-name', nomPiece);
            const safeName = nomPiece.replace(/'/g, "\\'");

            tr.innerHTML = `
                <td style="padding: 12px 14px; font-weight: 600; color: #0F172A;">${nomPiece}</td>
                <td style="padding: 12px 10px; text-align: center;"><span id="status-${idCapteur}" style="background: #F1F5F9; color: #64748B; font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; font-weight: 600;">En attente</span></td>
                <td style="padding: 12px 10px; text-align: right; font-weight: 700; color: #0F172A;" id="temp-${idCapteur}">-- °C</td>
                <td style="padding: 12px 10px; text-align: right; font-weight: 600; color: #334155;" id="hum-${idCapteur}">-- %</td>
                <td style="padding: 12px 10px; text-align: right; font-weight: 600; color: #0284C7;" id="ah-${idCapteur}">-- g/m³</td>
                <td style="padding: 12px 10px; text-align: center;"><span id="pmv-badge-${idCapteur}" style="font-weight: 700; padding: 4px 8px; border-radius: 6px; font-size: 0.82rem;">--</span></td>
                <td style="padding: 12px 10px; text-align: right; font-weight: 600;" id="energy-${idCapteur}">-- kWh/j</td>
                <td style="padding: 12px 10px; text-align: right; font-weight: 600; color: #D97706;" id="tstruct-${idCapteur}">-- °C</td>
                <td style="padding: 12px 10px; text-align: center; font-weight: 600;" id="drying-${idCapteur}">--</td>
                <td style="padding: 12px 14px; text-align: center;">
                    <button onclick="voirRecommandations('${safeName}')" style="background: #F1F5F9; border: 1px solid #CBD5E1; border-radius: 6px; padding: 4px 10px; font-size: 0.8rem; font-weight: 600; cursor: pointer; color: #0F172A;">🔍 Diag</button>
                </td>
            `;
            tableBody.appendChild(tr);
        });

        setupTableSortHeaders();
        return;
    }

    if (grid) {
        grid.innerHTML = '';
        if (SELECTION_PIECES.length === 0) {
            grid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: #7f8c8d; padding: 20px;">Aucune zone sélectionnée.</p>`;
            return;
        }

        SELECTION_PIECES.forEach(nomPiece => {
            const zone = getZoneConfigByName(nomPiece) || {};
            const idCapteur = zone.sensorId || zone.id || capteursMaison[nomPiece];
            const safeName = nomPiece.replace(/'/g, "\\'");

            const tuile = document.createElement('div');
            tuile.style.cssText = 'background: white; border: 1px solid #e0e0e0; border-radius: 12px; padding: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.05);';
            tuile.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #eee; padding-bottom: 10px; margin-bottom: 15px;">
                    <div><h3 style="margin: 0; font-size: 1.2em; color: #2c3e50;">${nomPiece}</h3></div>
                    <span id="status-${idCapteur}" style="font-size: 0.75em; color: #7f8c8d; background: #f1f2f6; padding: 3px 8px; border-radius: 10px;">En attente</span>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 15px;">
                    <div style="text-align: center; flex: 1;"><div style="font-size: 0.85em; color: #95a5a6;">Temp.</div><div id="temp-${idCapteur}" style="font-size: 1.6em; font-weight: bold;">--°C</div></div>
                    <div style="text-align: center; flex: 1; border-left: 1px solid #eee;"><div style="font-size: 0.85em; color: #95a5a6;">Humidité</div><div id="hum-${idCapteur}" style="font-size: 1.6em; font-weight: bold;">--%</div></div>
                </div>
                <div id="pmv-box-${idCapteur}" style="text-align: center; margin-bottom: 15px; padding: 10px; background: #f8f9fa; border-radius: 8px;">
                    <span id="pmv-badge-${idCapteur}" style="font-size: 1.3em; font-weight: bold;">--</span>
                </div>
                <button onclick="voirRecommandations('${safeName}')" style="width: 100%; padding: 12px; background-color: #e67e22; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold;">🔍 Lancer le diagnostic</button>
            `;
            grid.appendChild(tuile);
        });
    }
}

// ============================================================
// SYSTEME DE TRI INTERACTIF DES COLONNES
// ============================================================

function getRoomMetric(nomPiece, colIndex) {
    const data = DONNEES_HABITAT[nomPiece];
    const zoneConfig = getZoneConfigByName(nomPiece);
    const isOutdoor = isOutdoorZone(nomPiece, zoneConfig);

    if (colIndex === 0) return nomPiece;
    
    const idCapteur = capteursMaison[nomPiece];
    const statusEl = document.getElementById('status-' + idCapteur);
    if (colIndex === 1) return statusEl ? statusEl.textContent : '';

    const ta = isOutdoor ? outdoorTemp : (data?.ta || 0);
    const rh = isOutdoor ? outdoorHumidity : (data?.rh || 0);

    if (colIndex === 2) return ta;
    if (colIndex === 3) return rh;
    if (colIndex === 4) return calculateAbsoluteHumidity(ta, rh);

    const vel = calculateAirVelocity(zoneConfig, nomPiece);
    const tr = calculateMeanRadiantTemp(zoneConfig, ta);
    const { met, totalClo } = getBaseCloAndMet(zoneConfig);

    if (colIndex === 5) return isOutdoor ? -999 : calculatePMV(ta, tr, vel, rh, met, totalClo);
    if (colIndex === 6) return isOutdoor ? -999 : calculateDailyThermalBalance(zoneConfig, ta).bilanNetkWh;
    if (colIndex === 7) return isOutdoor ? -999 : updateStructureTemperature(nomPiece, ta);
    if (colIndex === 8) return calculateDryingPotential(ta, rh, vel).dryingIndex;

    return 0;
}

window.sortDashboardTable = function(colIndex) {
    if (currentSortCol === colIndex) {
        currentSortAsc = !currentSortAsc;
    } else {
        currentSortCol = colIndex;
        currentSortAsc = true;
    }

    SELECTION_PIECES.sort((a, b) => {
        const valA = getRoomMetric(a, colIndex);
        const valB = getRoomMetric(b, colIndex);

        if (typeof valA === 'string') {
            return currentSortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return currentSortAsc ? (valA - valB) : (valB - valA);
    });

    const tableBody = document.getElementById('dashboard-table-body');
    if (tableBody) {
        const rows = Array.from(tableBody.querySelectorAll('tr[data-room-name]'));
        const rowMap = new Map();
        rows.forEach(r => rowMap.set(r.getAttribute('data-room-name'), r));

        SELECTION_PIECES.forEach(nomPiece => {
            const row = rowMap.get(nomPiece);
            if (row) tableBody.appendChild(row);
        });
    }

    setupTableSortHeaders();
};

function setupTableSortHeaders() {
    const tableBody = document.getElementById('dashboard-table-body');
    if (!tableBody) return;
    const table = tableBody.closest('table');
    if (!table) return;

    const ths = table.querySelectorAll('thead th');
    ths.forEach((th, index) => {
        if (index === 9) return;
        th.style.cursor = 'pointer';
        th.title = 'Cliquer pour trier cette colonne';
        th.onclick = () => sortDashboardTable(index);
        
        let baseText = th.getAttribute('data-base-text');
        if (!baseText) {
            baseText = th.textContent.replace(/[↕▲▼]/g, '').trim();
            th.setAttribute('data-base-text', baseText);
        }

        let icon = ' ↕';
        if (currentSortCol === index) {
            icon = currentSortAsc ? ' ▲' : ' ▼';
        }
        th.textContent = baseText + icon;
    });
}

window.onRoomSelectionChange = function(checkbox) {
    if (checkbox.checked) {
        if (!SELECTION_PIECES.includes(checkbox.value)) SELECTION_PIECES.push(checkbox.value);
    } else {
        SELECTION_PIECES = SELECTION_PIECES.filter(p => p !== checkbox.value);
    }
    localStorage.setItem('SOLSTICE_SELECTION_PIECES', JSON.stringify(SELECTION_PIECES));
    genererSelecteurPieces();
    initialiserDashboard();
    recalculerToutLeDashboard();
};

window.toggleAllRooms = function(selectState) {
    SELECTION_PIECES = selectState ? Object.keys(capteursMaison) : [];
    localStorage.setItem('SOLSTICE_SELECTION_PIECES', JSON.stringify(SELECTION_PIECES));
    genererSelecteurPieces();
    initialiserDashboard();
    recalculerToutLeDashboard();
};

function restoreSessionData() {
    if (localStorage.getItem('outdoorTemp')) {
        outdoorTemp = parseFloat(localStorage.getItem('outdoorTemp'));
        outdoorHumidity = parseFloat(localStorage.getItem('outdoorHumidity'));
        outdoorWind = parseFloat(localStorage.getItem('outdoorWind') || 0);
        sunshineStatus = localStorage.getItem('sunshineStatus') || 'Clouds';
    }
    if (localStorage.getItem('manualCloAdjustment')) {
        manualCloAdjustment = parseFloat(localStorage.getItem('manualCloAdjustment'));
    }
    updateClothingDisplay();
}

// ============================================================
// MATRICES ET OUTILS PHYSIQUES DU BÂTIMENT
// ============================================================

function extractAdjacency(adjValue) {
    if (Array.isArray(adjValue)) return adjValue.length > 0 ? adjValue[0] : 'heated';
    return adjValue || 'heated';
}

function getUValueParoi(typeParoi, materiau, isolation) {
    const mapInsulationR = { 'ite_recent': 3.8, 'iti_recent': 3.2, 'ite_old': 1.8, 'iti_old': 1.4, 'low': 0.6, 'none': 0.0 };
    const mapLambda = { 'cinderblock': 1.3, 'brick': 0.45, 'concrete': 1.7, 'stone': 2.3, 'wood': 0.13, 'leger': 0.15, 'lourd': 1.8 };

    const rIns = mapInsulationR[isolation] ?? 2.0;
    const lambda = mapLambda[materiau] ?? 1.0;
    const epaisseurMetre = 0.20;

    let rSurface = 0.17;
    if (typeParoi === 'ceiling') rSurface = 0.14;
    if (typeParoi === 'floor') rSurface = 0.21;

    return 1 / (rSurface + (epaisseurMetre / lambda) + rIns);
}

function getDailyOutdoorTemp() {
    if (Array.isArray(window.hourlyExtForecast) && window.hourlyExtForecast.length > 0) {
        const activeHours = window.hourlyExtForecast.filter(slot => slot.hour >= 7 && slot.hour <= 22);
        const listToUse = activeHours.length > 0 ? activeHours : window.hourlyExtForecast;
        const sumTemp = listToUse.reduce((acc, slot) => acc + slot.temp, 0);
        return sumTemp / listToUse.length;
    }
    return outdoorTemp;
}

function getBaseCloAndMet(zoneConfig) {
    let met = 1.2; 
    
    const tDay = getDailyOutdoorTemp();
    let baseClo = Math.max(0.35, Math.min(1.30, 1.20 - 0.035 * (tDay - 5)));

    if (zoneConfig && Array.isArray(zoneConfig.usages)) {
        if (zoneConfig.usages.includes('kitchen')) met = 1.6;
        else if (zoneConfig.usages.includes('office')) met = 1.1;
        else if (zoneConfig.usages.includes('bathroom') || zoneConfig.usages.includes('bath')) met = 1.3;
        else if (zoneConfig.usages.includes('bedroom')) {
            met = 0.9;
            const currentMonth = new Date().getMonth();
            if ([11, 0, 1].includes(currentMonth)) baseClo = 1.8;
            else if ([5, 6, 7].includes(currentMonth)) baseClo = 0.5;
            else baseClo = 1.1;
        }
    }

    const totalClo = Math.max(0.1, Math.min(4.0, baseClo + manualCloAdjustment));
    return { met, totalClo };
}

function calculateMeanRadiantTemp(zone, t_air) {
    if (!zone) return t_air;

    const area = parseFloat(zone.area) || 16;
    const h = parseFloat(zone.height) || 2.5;
    const side = Math.sqrt(area);
    const wallArea = side * h; 
    const floorArea = area;

    const uWall = getUValueParoi('wall', zone.wallMat, zone.insulation);
    const uCeiling = getUValueParoi('ceiling', zone.ceilingMat, zone.ceilingInsulation);
    const uFloor = getUValueParoi('floor', zone.floorMat, zone.floorInsulation);

    const hi = 7.7; 

    function getSurfaceTemp(adjRaw, U) {
        const adj = extractAdjacency(adjRaw);
        if (adj === 'heated') return t_air;
        let tExtEquivalent = outdoorTemp;
        if (adj === 'unheated') tExtEquivalent = (t_air + outdoorTemp) / 2;
        if (adj === 'ground') tExtEquivalent = 12.0; 
        return t_air - (U / hi) * (t_air - tExtEquivalent);
    }

    let totalArea = 0;
    let sumAreaTemp = 0;

    const wallsAdj = [zone.adj?.wall1, zone.adj?.wall2, zone.adj?.wall3, zone.adj?.wall4];
    wallsAdj.forEach(adj => {
        const tSurf = getSurfaceTemp(adj, uWall);
        sumAreaTemp += (tSurf * wallArea);
        totalArea += wallArea;
    });

    sumAreaTemp += (getSurfaceTemp(zone.adj?.ceiling, uCeiling) * floorArea);
    sumAreaTemp += (getSurfaceTemp(zone.adj?.floor, uFloor) * floorArea);
    totalArea += (floorArea * 2);

    if (Array.isArray(zone.windows) && zone.windows.length > 0) {
        const isSunny = sunshineStatus.toLowerCase().includes('clear') || sunshineStatus.toLowerCase().includes('sun');

        zone.windows.forEach(win => {
            const wArea = parseFloat(win.area) || 0;
            if (wArea <= 0) return;

            const glassProps = {
                'single': { U: 5.7, g: 0.85 },
                'double_old': { U: 2.8, g: 0.75 },
                'double_standard': { U: 1.5, g: 0.68 },
                'double_recent': { U: 1.2, g: 0.60 },
                'triple': { U: 0.7, g: 0.45 }
            };

            const spec = glassProps[win.glass] || glassProps['double_recent'];
            let tWin = getSurfaceTemp('outside', spec.U);
            const maskFactor = { 'none': 1.0, 'partial': 0.5, 'heavy': 0.1 }[win.mask] ?? 1.0;
            const shutterFactor = {
                'aucun': 1.0, 'store_banne': 0.25, 'store_interieur': 0.75, 'rideau_interieur': 0.80,
                'roulant_pvc': 0.10, 'roulant_metal': 0.15, 'battant_bois': 0.10, 'persienne': 0.30
            }[win.shutter] ?? 1.0;

            if (isSunny && maskFactor > 0.1) {
                const orientArr = Array.isArray(win.orient) ? win.orient : [win.orient || 'S'];
                const orientFactors = { 'S': 3.2, 'SE': 2.5, 'SW': 2.5, 'E': 1.8, 'W': 1.8, 'N': 0.6 };
                let sumOrientFactor = 0;
                orientArr.forEach(o => { sumOrientFactor += (orientFactors[o] || 1.5); });
                const orientFactor = orientArr.length > 0 ? (sumOrientFactor / orientArr.length) : 1.5;
                const tiltFactor = { 'verticale': 1.0, 'inclinee': 1.3, 'horizontale': 1.5 }[win.tilt] ?? 1.0;
                tWin += (spec.g * orientFactor * tiltFactor * maskFactor * shutterFactor * 5.0);
            }

            sumAreaTemp -= (getSurfaceTemp('outside', uWall) * wArea);
            sumAreaTemp += (tWin * wArea);
        });
    }

    return sumAreaTemp / totalArea;
}

function calculateAirVelocity(zoneConfig, nomPiece = '') {
    if (isOutdoorZone(nomPiece, zoneConfig)) {
        const windMetersPerSecond = outdoorWind / 3.6;
        return Math.max(0.1, windMetersPerSecond);
    }

    let vel = 0.08; 
    if (!zoneConfig) return vel;

    const fanSys = zoneConfig.equipment?.fanSystem;
    if (fanSys === 'plafond') vel += 0.65;
    else if (fanSys === 'mobile') vel += 0.35;

    const vmcSys = zoneConfig.equipment?.vmcSystem;
    if (vmcSys === 'double_flux' || vmcSys === 'hygro_b') vel += 0.04;

    if (outdoorWind > 25 && Array.isArray(zoneConfig.windows)) {
        const hasPermeableWindow = zoneConfig.windows.some(w => w.glass === 'single' || w.vent === 'partial');
        if (hasPermeableWindow) vel += 0.12;
    }

    return Math.min(1.5, vel); 
}

function calculatePMV(ta, tr, vel, rh, met, clo) {
    if (ta === undefined || ta === null || isNaN(ta)) return 0;

    const M = met * 58.15; 
    const W = 0; 
    const Icl = 0.155 * clo; 
    const fcl = (clo <= 0.5) ? (1.0 + 0.2 * clo) : (1.05 + 0.1 * clo);
    const pa = rh * 10 * Math.exp(16.6536 - 4030.183 / (ta + 235));

    let tcl = ta; 
    
    for (let i = 0; i < 30; i++) {
        const hcFree = 2.38 * Math.pow(Math.abs(tcl - ta), 0.25);
        const hcForced = 12.1 * Math.sqrt(Math.max(vel, 0.001));
        const hc = Math.max(hcFree, hcForced);
        
        const hr = 3.96e-8 * fcl * (Math.pow(tcl + 273.15, 2) + Math.pow(tr + 273.15, 2)) * (tcl + tr + 546.3);
        
        const top = (35.7 - 0.028 * (M - W)) / Icl + fcl * hr * tr + fcl * hc * ta;
        const bottom = 1 / Icl + fcl * hr + fcl * hc;
        const tclNext = top / bottom;
        
        if (Math.abs(tclNext - tcl) < 0.001) {
            tcl = tclNext;
            break;
        }
        tcl = 0.5 * tcl + 0.5 * tclNext;
    }

    const hcFree = 2.38 * Math.pow(Math.abs(tcl - ta), 0.25);
    const hcForced = 12.1 * Math.sqrt(Math.max(vel, 0.001));
    const hc = Math.max(hcFree, hcForced);

    const pVapeurPeau = 3.05 * 0.001 * (5733 - 6.99 * (M - W) - pa);
    const pSueur = (M - W > 58.15) ? 0.42 * ((M - W) - 58.15) : 0;
    const pRespLatente = 1.7e-5 * M * (5867 - pa);
    const pRespSensible = 0.0014 * M * (34 - ta);
    const pRayonnement = 3.96e-8 * fcl * (Math.pow(tcl + 273.15, 4) - Math.pow(tr + 273.15, 4));
    const pConvection = fcl * hc * (tcl - ta);

    const L = (M - W) - pVapeurPeau - pSueur - pRespLatente - pRespSensible - pRayonnement - pConvection;
    const ts = 0.303 * Math.exp(-0.036 * M) + 0.028;

    let pmv = ts * L;
    return Math.max(-3, Math.min(3, pmv));
}

function calculateAbsoluteHumidity(ta, rh) {
    if (ta === undefined || rh === undefined || isNaN(ta) || isNaN(rh)) return 0;
    const pSat_hPa = 6.112 * Math.exp((17.67 * ta) / (ta + 243.5)); 
    const pv_hPa = pSat_hPa * (rh / 100); 
    const ah = (216.7 * pv_hPa) / (ta + 273.15); 
    return parseFloat(ah.toFixed(1));
}

function calculateDryingPotential(ta, rh, vel = 0.1) {
    if (ta === undefined || rh === undefined || isNaN(ta) || isNaN(rh)) {
        return { vpdkPa: 0, dryingIndex: 0, scorePercent: 0, score10: "0.0", status: "Inconnu", color: "#94A3B8" };
    }

    const pSat = 611.2 * Math.exp((17.67 * ta) / (ta + 243.5)); 
    const vpd = (pSat * (1 - rh / 100)) / 1000; 

    const dryingIndex = vpd * (1 + 0.5 * vel);

    const scorePercent = Math.min(100, Math.max(0, Math.round((dryingIndex / 1.8) * 100)));
    const score10 = (scorePercent / 10).toFixed(1);

    let status = "Très Lent";
    let color = "#EF4444"; 

    if (scorePercent >= 80) { status = "Ultra Rapide"; color = "#059669"; }
    else if (scorePercent >= 60) { status = "Rapide"; color = "#10B981"; }
    else if (scorePercent >= 40) { status = "Modéré"; color = "#F59E0B"; }
    else if (scorePercent >= 20) { status = "Lent"; color = "#F97316"; }

    return {
        vpdkPa: parseFloat(vpd.toFixed(3)),
        dryingIndex: parseFloat(dryingIndex.toFixed(3)),
        scorePercent,
        score10,
        status,
        color
    };
}

// ============================================================
// BALANCEMENT THERMIQUE : INSTANTANÉ (kW) ET PROJECTION 24H (kWh)
// ============================================================

function calculateDailyThermalBalance(zoneConfig, ta) {
    if (!zoneConfig || (Array.isArray(zoneConfig.usages) && zoneConfig.usages.includes('outdoor'))) {
        return { hTotalWPerK: 0, deperditionskWh: 0, gainsConductionkWh: 0, gainsSolaireskWh: 0, gainsTotauxkWh: 0, bilanNetkWh: 0, depKw: 0, gainsConductionKw: 0, gainsSolairesKw: 0 };
    }

    const area = parseFloat(zoneConfig.area) || 15;
    const h = parseFloat(zoneConfig.height) || 2.5;
    const volume = area * h;
    const side = Math.sqrt(area);
    const wallArea = side * h;

    const uWall = getUValueParoi('wall', zoneConfig.wallMat || 'cinderblock', zoneConfig.insulation || 'iti_recent');
    const uCeiling = getUValueParoi('ceiling', zoneConfig.ceilingMat || 'leger', zoneConfig.ceilingInsulation || 'iti_recent');
    const uFloor = getUValueParoi('floor', zoneConfig.floorMat || 'lourd', zoneConfig.floorInsulation || 'iti_recent');

    const getBFactor = (adj) => {
        if (Array.isArray(adj)) {
            if (adj.includes('outside')) return 1.0;
            if (adj.includes('unheated')) return 0.5;
            return 0.0;
        }
        if (adj === 'outside') return 1.0;
        if (adj === 'unheated') return 0.5;
        return 0.0;
    };

    const bW1 = getBFactor(zoneConfig.adj?.wall1 || 'outside');
    const bW2 = getBFactor(zoneConfig.adj?.wall2 || 'heated');
    const bW3 = getBFactor(zoneConfig.adj?.wall3 || 'heated');
    const bW4 = getBFactor(zoneConfig.adj?.wall4 || 'heated');
    const bCeiling = getBFactor(zoneConfig.adj?.ceiling || ['heated']);
    const bFloor = getBFactor(zoneConfig.adj?.floor || ['heated']);

    const hWall = uWall * wallArea * (bW1 + bW2 + bW3 + bW4);
    const hCeiling = uCeiling * area * bCeiling;
    const hFloor = uFloor * area * bFloor;
    const hSurfacique = hWall + hCeiling + hFloor;

    let ach = 0.5;
    const vmc = zoneConfig.equipment?.vmcSystem;
    if (vmc === 'marche_forcee') ach = 1.0;
    else if (vmc === 'continue_non_pilotable') ach = 0.7;
    else if (vmc === 'trappe') ach = 0.5;
    else if (vmc === 'none') ach = 0.25;

    const hVentilation = 0.34 * volume * ach;
    const hTotal = hSurfacique + hVentilation;

    let depKw = 0;
    let gainsConductionKw = 0;

    if (ta > outdoorTemp) {
        depKw = (hTotal * (ta - outdoorTemp)) / 1000;
    } else {
        gainsConductionKw = (hTotal * (outdoorTemp - ta)) / 1000;
    }

    let gainsSolairesKw = 0;
    const isSunnyInstant = sunshineStatus.toLowerCase().includes('clear') || sunshineStatus.toLowerCase().includes('sun');

    const glassMap = { 'single': 0.85, 'double_old': 0.75, 'double_standard': 0.68, 'double_recent': 0.60, 'triple': 0.45 };
    const maskMap = { 'none': 1.0, 'partial': 0.5, 'heavy': 0.1 };
    const shutterMap = {
        'aucun': 1.0, 'store_interieur': 0.7, 'rideau_interieur': 0.8, 'store_banne': 0.3,
        'persienne': 0.3, 'roulant_pvc': 0.15, 'roulant_metal': 0.2, 'battant_bois': 0.15
    };
    const orientMap = { 'S': 3.2, 'SE': 2.5, 'SW': 2.5, 'E': 1.8, 'W': 1.8, 'N': 0.6 };

    if (Array.isArray(zoneConfig.windows) && isSunnyInstant) {
        zoneConfig.windows.forEach(win => {
            const wArea = parseFloat(win.area) || 0;
            if (wArea <= 0) return;

            const gFactor = glassMap[win.glass] ?? 0.60;
            const maskFactor = maskMap[win.mask] ?? 1.0;
            const shutterFactor = shutterMap[win.shutter] ?? 1.0;

            const orients = Array.isArray(win.orient) ? win.orient : [win.orient || 'S'];
            let sumI = 0;
            orients.forEach(o => { sumI += (orientMap[o] || 1.5); });
            let iSolar = orients.length > 0 ? (sumI / orients.length) : 1.5;

            gainsSolairesKw += (wArea * gFactor * maskFactor * shutterFactor * (iSolar / 12));
        });
    }

    let deperditionskWh = 0;
    let gainsConductionkWh = 0;
    let gainsSolaireskWh = 0;

    if (Array.isArray(window.hourlyExtForecast) && window.hourlyExtForecast.length === 24) {
        window.hourlyExtForecast.forEach(slot => {
            const tExtHour = slot.temp;
            if (ta > tExtHour) {
                deperditionskWh += (hTotal * (ta - tExtHour)) / 1000;
            } else {
                gainsConductionkWh += (hTotal * (tExtHour - ta)) / 1000;
            }

            if (slot.isSunny && Array.isArray(zoneConfig.windows)) {
                zoneConfig.windows.forEach(win => {
                    const wArea = parseFloat(win.area) || 0;
                    if (wArea <= 0) return;

                    const gFactor = glassMap[win.glass] ?? 0.60;
                    const maskFactor = maskMap[win.mask] ?? 1.0;
                    const shutterFactor = shutterMap[win.shutter] ?? 1.0;

                    const orients = Array.isArray(win.orient) ? win.orient : [win.orient || 'S'];
                    let sumI = 0;
                    orients.forEach(o => { sumI += (orientMap[o] || 1.5); });
                    let iSolar = orients.length > 0 ? (sumI / orients.length) : 1.5;

                    gainsSolaireskWh += (wArea * gFactor * maskFactor * shutterFactor * (iSolar / 12));
                });
            }
        });
    } else {
        deperditionskWh = depKw * 24;
        gainsConductionkWh = gainsConductionKw * 24;
        gainsSolaireskWh = gainsSolairesKw * 24;
    }

    const gainsTotauxkWh = gainsSolaireskWh + gainsConductionkWh;
    const bilanNetkWh = gainsTotauxkWh - deperditionskWh;

    return {
        hTotalWPerK: parseFloat(hTotal.toFixed(1)),
        depKw: parseFloat(depKw.toFixed(2)),
        gainsConductionKw: parseFloat(gainsConductionKw.toFixed(2)),
        gainsSolairesKw: parseFloat(gainsSolairesKw.toFixed(2)),
        deperditionskWh: parseFloat(deperditionskWh.toFixed(2)),
        gainsConductionkWh: parseFloat(gainsConductionkWh.toFixed(2)),
        gainsSolaireskWh: parseFloat(gainsSolaireskWh.toFixed(2)),
        gainsTotauxkWh: parseFloat(gainsTotauxkWh.toFixed(2)),
        bilanNetkWh: parseFloat(bilanNetkWh.toFixed(2))
    };
}

// ============================================================
// MODÈLE D'INERTIE ET RÉSERVE THERMIQUE (LISSAGE PASSE-BAS)
// ============================================================

function updateStructureTemperature(nomPiece, currentTa) {
    const storageKey = `SOLSTICE_TSTRUCT_${nomPiece}`;
    const lastDataRaw = localStorage.getItem(storageKey);
    const now = Date.now();

    if (!lastDataRaw) {
        const initialData = { tStruct: currentTa, lastTimestamp: now };
        localStorage.setItem(storageKey, JSON.stringify(initialData));
        return currentTa;
    }

    const lastData = JSON.parse(lastDataRaw);
    const dtHours = (now - lastData.lastTimestamp) / (1000 * 3600);

    if (dtHours < 0.016) return lastData.tStruct;

    const tau = 18.0;
    const alpha = 1 - Math.exp(-dtHours / tau);
    const newTstruct = lastData.tStruct + alpha * (currentTa - lastData.tStruct);

    localStorage.setItem(storageKey, JSON.stringify({
        tStruct: parseFloat(newTstruct.toFixed(2)),
        lastTimestamp: now
    }));

    return newTstruct;
}

function calculateStructureReserve(tStruct, tAir, tConfort = 21.0) {
    const deltaConfort = tStruct - tConfort;

    const rawPercent = ((deltaConfort + 3.0) / 6.0) * 100;
    const chargePercent = Math.max(0, Math.min(100, Math.round(rawPercent)));

    const deltaFlux = tStruct - tAir;
    const diffAbs = Math.abs(deltaFlux).toFixed(1);
    
    let fluxDirection = "";
    let fluxIcon = "";

    if (deltaFlux > 0.3) {
        fluxDirection = `La structure réchauffe l'air (+${diffAbs} °C)`;
        fluxIcon = "🔥 Restitution";
    } else if (deltaFlux < -0.3) {
        fluxDirection = `La structure absorbe la chaleur (-${diffAbs} °C)`;
        fluxIcon = "❄️ Imbibition";
    } else {
        fluxDirection = `Équilibre thermique air / parois`;
        fluxIcon = "⚖️ Stabile";
    }

    let qualification = "Neutre";
    if (deltaConfort >= 1.5) qualification = "Fortement chargée en chaleur";
    else if (deltaConfort >= 0.5) qualification = "Modérément chaude";
    else if (deltaConfort <= -1.5) qualification = "Fortement chargée en fraîcheur";
    else if (deltaConfort <= -0.5) qualification = "Modérément fraîche";

    return {
        tStruct: parseFloat(tStruct.toFixed(1)),
        chargePercent: chargePercent,
        qualification: qualification,
        fluxIcon: fluxIcon,
        fluxDirection: fluxDirection
    };
}

// ============================================================
// INDICATEURS GLOBAUX DE L'HABITAT (PONDÉRATION VOLUMIQUE)
// ============================================================
function calculateGlobalHabitatMetrics() {
    let totalVolume = 0;
    let weightedTemp = 0;
    let weightedRH = 0;
    let weightedAH = 0;
    let weightedPMV = 0;
    let weightedTStruct = 0;
    let weightedChargePct = 0;

    let totalDeperditionsKw = 0;
    let totalGainsConductionKw = 0;
    let totalGainsSolairesKw = 0;
    let totalBilanNetKwh = 0;

    for (const [nomPiece, data] of Object.entries(DONNEES_HABITAT)) {
        if (!data || isNaN(data.ta) || isNaN(data.rh)) continue;
        if (!SELECTION_PIECES.includes(nomPiece)) continue;

        const zoneConfig = getZoneConfigByName(nomPiece) || { area: 15, height: 2.5 };

        if (isOutdoorZone(nomPiece, zoneConfig)) continue;
        if (!includeBufferZones && isBufferZone(nomPiece, zoneConfig)) continue;

        const area = parseFloat(zoneConfig.area) || 15;
        const height = parseFloat(zoneConfig.height) || 2.5;
        const volume = area * height;

        const ah = calculateAbsoluteHumidity(data.ta, data.rh);
        const vel = calculateAirVelocity(zoneConfig, nomPiece);
        const tr = calculateMeanRadiantTemp(zoneConfig, data.ta);
        const { met, totalClo } = getBaseCloAndMet(zoneConfig);
        const pmv = calculatePMV(data.ta, tr, vel, data.rh, met, totalClo);
        const energy = calculateDailyThermalBalance(zoneConfig, data.ta);

        const tStruct = updateStructureTemperature(nomPiece, data.ta);
        const reserve = calculateStructureReserve(tStruct, data.ta);

        totalVolume += volume;
        weightedTemp += data.ta * volume;
        weightedRH += data.rh * volume;
        weightedAH += ah * volume;
        weightedPMV += pmv * volume;
        weightedTStruct += tStruct * volume;
        weightedChargePct += reserve.chargePercent * volume;

        totalDeperditionsKw += energy.depKw;
        totalGainsConductionKw += energy.gainsConductionKw;
        totalGainsSolairesKw += energy.gainsSolairesKw;
        totalBilanNetKwh += energy.bilanNetkWh;
    }

    if (totalVolume === 0) return null;

    return {
        avgTemp: parseFloat((weightedTemp / totalVolume).toFixed(1)),
        avgRH: parseFloat((weightedRH / totalVolume).toFixed(0)),
        avgAH: parseFloat((weightedAH / totalVolume).toFixed(2)),
        avgPMV: parseFloat((weightedPMV / totalVolume).toFixed(2)),
        avgTStruct: parseFloat((weightedTStruct / totalVolume).toFixed(1)),
        avgChargePct: Math.round(weightedChargePct / totalVolume),
        totalDeperditionsKw: parseFloat(totalDeperditionsKw.toFixed(2)),
        totalGainsConductionKw: parseFloat(totalGainsConductionKw.toFixed(2)),
        totalGainsSolairesKw: parseFloat(totalGainsSolairesKw.toFixed(2)),
        totalBilanNetKwh: parseFloat(totalBilanNetKwh.toFixed(2)),
        totalVolumeM3: parseFloat(totalVolume.toFixed(1))
    };
}

function mettreAJourTuile(nomPiece) {
    if (!SELECTION_PIECES.includes(nomPiece)) return;

    const data = DONNEES_HABITAT[nomPiece];
    const idCapteur = capteursMaison[nomPiece];
    if (!idCapteur) return;

    const tempEl = document.getElementById('temp-' + idCapteur);
    const humEl = document.getElementById('hum-' + idCapteur);

    const zoneConfig = getZoneConfigByName(nomPiece) || {
        name: nomPiece,
        area: 15,
        height: 2.5,
        wallMat: 'cinderblock',
        insulation: 'iti_recent',
        ceilingMat: 'concrete',
        ceilingInsulation: 'iti_recent',
        floorMat: 'concrete',
        floorInsulation: 'low',
        usages: ['kitchen']
    };

    const isOutdoor = isOutdoorZone(nomPiece, zoneConfig);

    const currentTa = isOutdoor ? outdoorTemp : (data?.ta || 0);
    const currentRh = isOutdoor ? outdoorHumidity : (data?.rh || 0);

    if (tempEl) tempEl.textContent = currentTa.toFixed(1) + " °C";
    if (humEl) humEl.textContent = currentRh.toFixed(0) + " %";

    const ahEl = document.getElementById('ah-' + idCapteur);
    const dryingEl = document.getElementById('drying-' + idCapteur);
    const energyEl = document.getElementById('energy-' + idCapteur);
    const tStructEl = document.getElementById('tstruct-' + idCapteur);
    const pmvBadge = document.getElementById('pmv-badge-' + idCapteur);

    if (ahEl) {
        const ah = calculateAbsoluteHumidity(currentTa, currentRh);
        ahEl.textContent = ah.toFixed(1) + " g/m³";
    }

    if (isOutdoor) {
        if (energyEl) { energyEl.textContent = "—"; energyEl.style.color = "#94A3B8"; }
        if (tStructEl) { tStructEl.textContent = "—"; tStructEl.style.color = "#94A3B8"; }
        if (pmvBadge) {
            pmvBadge.textContent = "Extérieur";
            pmvBadge.style.backgroundColor = "#F1F5F9";
            pmvBadge.style.color = "#64748B";
        }

        const velExt = outdoorWind / 3.6;
        const dryingExt = calculateDryingPotential(outdoorTemp, outdoorHumidity, velExt);
        if (dryingEl) {
            dryingEl.innerHTML = `
                <div style="display: inline-flex; align-items: center; justify-content: center; gap: 6px;">
                    <span style="font-weight: 700; color: ${dryingExt.color};">${dryingExt.score10}/10</span>
                    <div style="width: 36px; height: 6px; background: #E2E8F0; border-radius: 3px; overflow: hidden; display: inline-block;">
                        <div style="width: ${dryingExt.scorePercent}%; height: 100%; background: ${dryingExt.color}; border-radius: 3px;"></div>
                    </div>
                </div>
            `;
            dryingEl.title = `${dryingExt.status} (${dryingExt.scorePercent}%) - VPD: ${dryingExt.vpdkPa} kPa`;
        }
        return;
    }

    if (!data) return;

    const vel = calculateAirVelocity(zoneConfig, nomPiece);
    const tr = calculateMeanRadiantTemp(zoneConfig, data.ta);
    const { met, totalClo } = getBaseCloAndMet(zoneConfig);

    const drying = calculateDryingPotential(data.ta, data.rh, vel);
    const energyBalance = calculateDailyThermalBalance(zoneConfig, data.ta);
    const tStruct = updateStructureTemperature(nomPiece, data.ta);
    let pmv = calculatePMV(data.ta, tr, vel, data.rh, met, totalClo);

    if (dryingEl) {
        dryingEl.innerHTML = `
            <div style="display: inline-flex; align-items: center; justify-content: center; gap: 6px;">
                <span style="font-weight: 700; color: ${drying.color};">${drying.score10}/10</span>
                <div style="width: 36px; height: 6px; background: #E2E8F0; border-radius: 3px; overflow: hidden; display: inline-block;">
                    <div style="width: ${drying.scorePercent}%; height: 100%; background: ${drying.color}; border-radius: 3px;"></div>
                </div>
            </div>
        `;
        dryingEl.title = `${drying.status} (${drying.scorePercent}%) - VPD: ${drying.vpdkPa} kPa`;
    }

    if (energyEl) {
        const netVal = energyBalance.bilanNetkWh;
        const prefix = netVal > 0 ? "+" : "";
        energyEl.textContent = `${prefix}${netVal.toFixed(2)} kWh/j`;
        energyEl.style.color = netVal >= 0 ? "#10B981" : "#EF4444";
    }

    if (tStructEl) tStructEl.textContent = tStruct.toFixed(1) + " °C";

    if (pmvBadge) {
        pmvBadge.textContent = (pmv > 0 ? "+" : "") + pmv.toFixed(2);
        if (pmv < -0.75) { 
            pmvBadge.style.backgroundColor = "#E0F2FE"; pmvBadge.style.color = "#0369A1";
        } else if (pmv < -0.2) {
            pmvBadge.style.backgroundColor = "#F0F9FF"; pmvBadge.style.color = "#0284C7";
        } else if (pmv > 0.75) { 
            pmvBadge.style.backgroundColor = "#FEE2E2"; pmvBadge.style.color = "#B91C1C";
        } else if (pmv > 0.2) {
            pmvBadge.style.backgroundColor = "#FEF3C7"; pmvBadge.style.color = "#B45309";
        } else { 
            pmvBadge.style.backgroundColor = "#D1FAE5"; pmvBadge.style.color = "#047857";
        }
    }
}

// ============================================================
// DÉTECTION ET AFFICHAGE STATUT SAISON DE CHAUFFE
// ============================================================

function isHeatingSeasonActive() {
    const raw = localStorage.getItem('HOUSE_CONFIG');
    const houseConfig = raw ? JSON.parse(raw) : {};
    const forcedSeason = houseConfig.global?.forcedSeason || localStorage.getItem('SOLSTICE_HEATING_MODE') || 'auto';

    if (forcedSeason === 'heating' || forcedSeason === 'ON') return true;
    if (forcedSeason === 'off' || forcedSeason === 'OFF') return false;

    // Mode AUTO : bascule si la température extérieure moyenne du jour est < 15.5 °C
    const tDay = getDailyOutdoorTemp();
    return tDay < 15.5;
}

function updateHeatingSeasonDisplay() {
    const badgeEl = document.getElementById('heating-season-badge');
    if (!badgeEl) return;

    const raw = localStorage.getItem('HOUSE_CONFIG');
    const houseConfig = raw ? JSON.parse(raw) : {};
    const forcedSeason = houseConfig.global?.forcedSeason || localStorage.getItem('SOLSTICE_HEATING_MODE') || 'auto';

    const isActive = isHeatingSeasonActive();
    const tagAuto = forcedSeason.toLowerCase() === 'auto' ? ' (Auto)' : '';

    if (isActive) {
        badgeEl.innerHTML = `🔥 Saison de chauffe active${tagAuto}`;
        badgeEl.style.backgroundColor = '#FEE2E2';
        badgeEl.style.color = '#991B1B';
        badgeEl.style.border = '1px solid #FCA5A5';
        badgeEl.title = "La température extérieure du jour ou la configuration Expert maintient la saison de chauffe active.";
    } else {
        badgeEl.innerHTML = `🌱 Hors saison de chauffe${tagAuto}`;
        badgeEl.style.backgroundColor = '#E0F2FE';
        badgeEl.style.color = '#075985';
        badgeEl.style.border = '1px solid #7DD3FC';
        badgeEl.title = "Les apports thermiques naturels sont suffisants.";
    }
}

function actualiserCockpitGlobal() {
    const metrics = calculateGlobalHabitatMetrics();

    if (!metrics) {
        if (document.getElementById('global-volume-badge')) document.getElementById('global-volume-badge').textContent = "Volume : -- m³";
        if (document.getElementById('global-avg-temp')) document.getElementById('global-avg-temp').textContent = "-- °C";
        if (document.getElementById('global-avg-rh')) document.getElementById('global-avg-rh').textContent = "-- %";
        if (document.getElementById('global-avg-ah')) document.getElementById('global-avg-ah').textContent = "-- g/m³";
        if (document.getElementById('global-pmv-val')) document.getElementById('global-pmv-val').textContent = "--";
        if (document.getElementById('global-gains-ext')) document.getElementById('global-gains-ext').textContent = "-- kW";
        if (document.getElementById('global-dep')) document.getElementById('global-dep').textContent = "-- kW";
        if (document.getElementById('global-gains-sol')) document.getElementById('global-gains-sol').textContent = "-- kW";
        if (document.getElementById('global-net')) document.getElementById('global-net').textContent = "-- kWh/j";
        if (document.getElementById('global-tstruct')) document.getElementById('global-tstruct').textContent = "-- °C";
        if (document.getElementById('global-reserve-pct')) document.getElementById('global-reserve-pct').textContent = "-- %";
        if (document.getElementById('global-flux-status')) document.getElementById('global-flux-status').textContent = "--";
        return;
    }

    if (document.getElementById('global-volume-badge')) document.getElementById('global-volume-badge').textContent = `Volume : ${metrics.totalVolumeM3} m³`;
    if (document.getElementById('global-avg-temp')) document.getElementById('global-avg-temp').textContent = `${metrics.avgTemp} °C`;
    if (document.getElementById('global-avg-rh')) document.getElementById('global-avg-rh').textContent = `${metrics.avgRH} %`;
    if (document.getElementById('global-avg-ah')) document.getElementById('global-avg-ah').textContent = `${metrics.avgAH} g/m³`;

    const pmvValEl = document.getElementById('global-pmv-val');
    const pmvStatusEl = document.getElementById('global-pmv-status');
    if (pmvValEl) pmvValEl.textContent = (metrics.avgPMV > 0 ? "+" : "") + metrics.avgPMV.toFixed(2);
    
    if (pmvStatusEl) {
        if (metrics.avgPMV >= -0.5 && metrics.avgPMV <= 0.5) {
            pmvStatusEl.textContent = "Confort Optimal";
            pmvStatusEl.style.background = "#059669";
            pmvStatusEl.style.color = "#FFFFFF";
        } else if (metrics.avgPMV < -0.5) {
            pmvStatusEl.textContent = "Frais Global";
            pmvStatusEl.style.background = "#D97706";
            pmvStatusEl.style.color = "#FFFFFF";
        } else {
            pmvStatusEl.textContent = "Chaud Global";
            pmvStatusEl.style.background = "#DC2626";
            pmvStatusEl.style.color = "#FFFFFF";
        }
    }

    if (document.getElementById('global-gains-ext')) document.getElementById('global-gains-ext').textContent = `+${metrics.totalGainsConductionKw} kW`;
    if (document.getElementById('global-dep')) document.getElementById('global-dep').textContent = `-${metrics.totalDeperditionsKw} kW`;
    if (document.getElementById('global-gains-sol')) document.getElementById('global-gains-sol').textContent = `+${metrics.totalGainsSolairesKw} kW`;
    
    const netEl = document.getElementById('global-net');
    if (netEl) {
        netEl.textContent = `${metrics.totalBilanNetKwh > 0 ? '+' : ''}${metrics.totalBilanNetKwh} kWh/j`;
        netEl.style.color = metrics.totalBilanNetKwh >= 0 ? "#4ADE80" : "#F87171";
    }

    if (document.getElementById('global-tstruct')) document.getElementById('global-tstruct').textContent = `${metrics.avgTStruct} °C`;
    if (document.getElementById('global-reserve-pct')) document.getElementById('global-reserve-pct').textContent = `${metrics.avgChargePct} %`;

    const globalFluxEl = document.getElementById('global-flux-status');
    if (globalFluxEl) {
        const diffGlobal = metrics.avgTStruct - metrics.avgTemp;
        if (diffGlobal > 0.3) {
            globalFluxEl.textContent = "🔥 Restitution";
            globalFluxEl.style.color = "#FDBA74";
        } else if (diffGlobal < -0.3) {
            globalFluxEl.textContent = "❄️ Imbibition";
            globalFluxEl.style.color = "#38BDF8";
        } else {
            globalFluxEl.textContent = "⚖️ Stabile";
            globalFluxEl.style.color = "#4ADE80";
        }
    }
}

function recalculerToutLeDashboard() { 
    for (const nomPiece of SELECTION_PIECES) { 
        mettreAJourTuile(nomPiece); 
    } 
    actualiserCockpitGlobal();
    updateHeatingSeasonDisplay();
}

window.adjustClothing = function(amount) { 
    manualCloAdjustment += amount; 
    localStorage.setItem('manualCloAdjustment', manualCloAdjustment);
    updateClothingDisplay(); 
    recalculerToutLeDashboard(); 
};

window.resetClothing = function() { 
    manualCloAdjustment = 0; 
    localStorage.setItem('manualCloAdjustment', 0);
    updateClothingDisplay(); 
    recalculerToutLeDashboard(); 
};

function updateClothingDisplay() { 
    const currentCloEl = document.getElementById('currentCloValue');
    const currentCloDescEl = document.getElementById('currentCloDesc');
    const totalClo = getBaseCloAndMet(null).totalClo;

    if (currentCloEl) currentCloEl.textContent = totalClo.toFixed(2); 
    if (currentCloDescEl) currentCloDescEl.textContent = getClothingDescription(totalClo);
}

// ============================================================
// FLUX MÉTÉO ET RENDER STATUT (API ONE CALL 3.0 / 4.0)
// ============================================================

window.rechercherMeteo = function() {
    const city = document.getElementById('location')?.value.trim();
    if (!city) return;
    rechercherMeteoParNomVille(city);
};

window.geolocaliserMeteo = function() {
    if ("geolocation" in navigator) {
        const summaryEl = document.getElementById('weatherSummary');
        if (summaryEl) summaryEl.innerHTML = '<span class="muted-text">📍 Géolocalisation...</span>';
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lon = pos.coords.longitude;
                localStorage.setItem('SOLSTICE_LAT', lat);
                localStorage.setItem('SOLSTICE_LON', lon);
                fetchOneCallWeather(lat, lon, "Ma position");
            },
            () => updateWeatherUI(false, true, "Accès GPS refusé")
        );
    }
};

function rechercherMeteoParNomVille(city) {
    if (!city || city === "Ma position") {
        const savedLat = localStorage.getItem('SOLSTICE_LAT');
        const savedLon = localStorage.getItem('SOLSTICE_LON');
        if (savedLat && savedLon) {
            fetchOneCallWeather(parseFloat(savedLat), parseFloat(savedLon), localStorage.getItem('location') || 'Ma position');
            return;
        }
    }

    const geoUrl = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${apiKey}`;
    
    fetch(geoUrl)
        .then(res => {
            if (!res.ok) throw new Error("Erreur géocodage");
            return res.json();
        })
        .then(geoData => {
            if (!geoData || geoData.length === 0) throw new Error("Ville introuvable");
            const { lat, lon, name } = geoData[0];
            localStorage.setItem('SOLSTICE_LAT', lat);
            localStorage.setItem('SOLSTICE_LON', lon);
            fetchOneCallWeather(lat, lon, name);
        })
        .catch(err => {
            console.error("Erreur géocodage ville:", err);
            updateWeatherUI(false, true, err.message);
        });
}

function processOneCallHourlyForecast(hourlyList) {
    const hourly = [];
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime() / 1000;

    for (let h = 0; h < 24; h++) {
        const targetTs = startOfDay + (h * 3600);
        
        let closest = hourlyList[0];
        let minDiff = Math.abs(hourlyList[0].dt - targetTs);

        for (let i = 1; i < hourlyList.length; i++) {
            const diff = Math.abs(hourlyList[i].dt - targetTs);
            if (diff < minDiff) {
                minDiff = diff;
                closest = hourlyList[i];
            }
        }

        const isDaytime = (h >= 7 && h <= 19);
        const weatherMain = closest.weather[0]?.main || 'Clouds';
        const isSunny = isDaytime && (weatherMain.toLowerCase().includes('clear') || weatherMain.toLowerCase().includes('sun'));

        hourly.push({
            hour: h,
            temp: closest.temp,
            humidity: closest.humidity,
            isSunny: isSunny
        });
    }

    return hourly;
}

function fetchOneCallWeather(lat, lon, cityName = 'Reims') {
    const summaryEl = document.getElementById('weatherSummary');
    if (summaryEl) summaryEl.innerHTML = '<span class="muted-text">⏳ Chargement de la météo (One Call)...</span>';

    const oneCallUrl = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=fr`;

    fetch(oneCallUrl)
        .then(res => {
            if (!res.ok) throw new Error("Erreur One Call API");
            return res.json();
        })
        .then(data => {
            outdoorTemp = data.current.temp; 
            outdoorHumidity = data.current.humidity;
            outdoorWind = (data.current.wind_speed * 3.6); 
            sunshineStatus = data.current.weather[0]?.main || 'Clouds'; 
            
            if (Array.isArray(data.hourly)) {
                window.hourlyExtForecast = processOneCallHourlyForecast(data.hourly);
                localStorage.setItem('SOLSTICE_HOURLY_FORECAST', JSON.stringify(window.hourlyExtForecast));
            }

            const locInput = document.getElementById('location');
            if (locInput) locInput.value = cityName;

            const summaryCityEl = document.getElementById('summary-city-name');
            if (summaryCityEl) summaryCityEl.textContent = cityName;

            localStorage.setItem('location', cityName);
            localStorage.setItem('outdoorTemp', outdoorTemp);
            localStorage.setItem('outdoorHumidity', outdoorHumidity);
            localStorage.setItem('outdoorWind', outdoorWind);
            localStorage.setItem('sunshineStatus', sunshineStatus);

            updateWeatherUI();
            updateClothingDisplay(); 
            recalculerToutLeDashboard(); 
        })
        .catch(err => {
            console.error("Erreur One Call:", err);
            updateWeatherUI(false, true, err.message);
        });
}

function updateWeatherUI(loading = false, error = false, errorMsg = "") {
    const summaryEl = document.getElementById('weatherSummary');
    if (!summaryEl) return;

    if (loading) {
        summaryEl.innerHTML = '<span style="color: #64748B;">⏳ Chargement météo...</span>';
        return;
    }
    if (error) {
        summaryEl.innerHTML = `<span style="color: #EF4444; font-weight: bold;">❌ ${errorMsg || "Météo indisponible"}</span>`;
        return;
    }

    summaryEl.innerHTML = `
        <span>
            🌡️ ${outdoorTemp.toFixed(1)} °C &nbsp;|&nbsp; 💧 ${outdoorHumidity}% HR &nbsp;|&nbsp; 💨 ${outdoorWind.toFixed(0)} km/h (${sunshineStatus})
        </span>
    `;
}

// ============================================================
// SUPER SCAN MAKE.COM
// ============================================================

window.synchroniserTouteLaMaison = async function(event) {
    if (event && event.target) {
        const btn = document.getElementById('btn-sync-all');
        if (btn && !btn.contains(event.target) && event.target !== btn) {
            return;
        }
    }

    if (SELECTION_PIECES.length === 0) {
        alert("⚠️ Sélectionnez au moins une pièce à scanner !");
        return;
    }

    const btn = document.getElementById('btn-sync-all');
    if (btn) {
        btn.innerHTML = "⏳ Scan Global en cours...";
        btn.style.backgroundColor = "#475569";
    }

    try {
        const response = await fetch('https://hook.eu1.make.com/0jz9xnz6phk3nmn5pdwkijlylowdxosd');
        if (!response.ok) throw new Error("Erreur Serveur Make");
        
        const dataPack = await response.json();
        for (const capteur of dataPack) {
            const idCapteur = capteur.id;
            
            const zone = Object.values(GLOBAL_HOUSE_CONFIG).find(z => z.sensorId === idCapteur || z.id === idCapteur);
            const nomPiece = zone ? zone.name : null;
            
            if (nomPiece && capteur.temperature !== null && capteur.humidity !== null) {
                DONNEES_HABITAT[nomPiece] = { 
                    ta: parseFloat(capteur.temperature), 
                    rh: parseFloat(capteur.humidity) 
                };

                if (SELECTION_PIECES.includes(nomPiece)) {
                    mettreAJourTuile(nomPiece);
                    
                    const statusEl = document.getElementById('status-' + idCapteur);
                    if (statusEl) {
                        const now = new Date();
                        statusEl.textContent = "Actuel (" + now.getHours() + "h" + (now.getMinutes() < 10 ? '0' : '') + now.getMinutes() + ")";
                        statusEl.style.color = "#10B981";
                    }
                }
            }
        }

        localStorage.setItem('SOLSTICE_DONNEES_HABITAT', JSON.stringify(DONNEES_HABITAT));
        sessionStorage.setItem('SOLSTICE_DONNEES_HABITAT', JSON.stringify(DONNEES_HABITAT));
        actualiserCockpitGlobal();
        
    } catch (error) { 
        console.error("Erreur Bulk Scan:", error); 
        alert("❌ Erreur lors du scan des capteurs."); 
    }

    if (btn) {
        btn.innerHTML = "⚡ Interroger les capteurs (Super-Scan)";
        btn.style.backgroundColor = "#D96B43";
    }
};

window.voirRecommandations = function(nomPiece) {
    const zoneConfig = getZoneConfigByName(nomPiece);
    if (isOutdoorZone(nomPiece, zoneConfig)) {
        alert("⚠️ Les pièces extérieures ne disposent pas de plan d'action d'aéraulique ou de confort intérieur.");
        return;
    }

    if (!DONNEES_HABITAT[nomPiece]) { 
        alert("Actualisez d'abord les capteurs !"); 
        return; 
    }

    const zoneKey = Object.keys(GLOBAL_HOUSE_CONFIG).find(key => GLOBAL_HOUSE_CONFIG[key].name === nomPiece) || nomPiece;
    const idCapteur = capteursMaison[nomPiece];
    const pmv = document.getElementById('pmv-badge-' + idCapteur)?.textContent || "0";

    sessionStorage.setItem('currentZoneId', zoneKey); 
    sessionStorage.setItem('calculatedPMV', pmv);
    sessionStorage.setItem('indoorAirTemp', DONNEES_HABITAT[nomPiece].ta);
    sessionStorage.setItem('indoorHumidity', DONNEES_HABITAT[nomPiece].rh);
    sessionStorage.setItem('outdoorTemp', outdoorTemp);
    sessionStorage.setItem('sunshineStatus', sunshineStatus);

    window.location.href = `reco.html?zone=${encodeURIComponent(zoneKey)}`;
};

// ============================================================
// SIMULATEUR DE CONSEILS ET RECOMMANDATIONS
// ============================================================

SolsticeEngine.generateRecommendations = function(zone, zoneId, roomData, envData) {
    const recs = [];
    const zoneName = zone ? (zone.name || zoneId) : zoneId;

    if (isOutdoorZone(zoneName, zone)) return recs;

    const ta = roomData.ta || 20;
    const rh = roomData.rh || 50;

    const tr = this.calculateMeanRadiantTemp(zone, ta);
    const vel = this.calculateAirVelocity(zone, zoneName);
    const { met, totalClo } = this.getBaseCloAndMet(zone);

    const roomPmv = this.calculatePMV(ta, tr, vel, rh, met, totalClo);
    const needsHeat = roomPmv < -0.4;
    const needsCooling = roomPmv > 0.4;
    const isSunny = envData.sun_status.toLowerCase().includes('clear') || envData.sun_status.toLowerCase().includes('sun');

    const hasWindows = !zone || !zone.windows || zone.windows.length === 0 || zone.windows.some(w => w.vent !== 'fixed' && w.vent !== 'fixe');
    const hasShutters = !zone || !zone.windows || zone.windows.some(w => !w.shutter || w.shutter !== 'aucun');

    if (rh > 65) {
        if (zone?.equipment?.vmcSystem === 'marche_forcee' || zone?.equipment?.vmcSystem === 'continue_non_pilotable') {
            recs.push({
                id: `${zoneId}_vmc_boost`,
                actionKey: 'vmc_boost',
                zoneId, zoneName, timing: 'immediate', type: 'type-air',
                title: 'Activer la VMC en mode renforcé',
                text: `L'humidité atteint ${rh} %. Basculez la ventilation en vitesse rapide.`,
                impactWeight: 15
            });
        } else if (hasWindows) {
            recs.push({
                id: `${zoneId}_open_win_humidity`,
                actionKey: 'open_win_humidity',
                zoneId, zoneName, timing: 'immediate', type: 'type-air',
                title: 'Aération flash ciblée',
                text: `Ouvrez la fenêtre pendant 5 minutes pour évacuer l'humidité accumulée.`,
                impactWeight: 12
            });
        }
    }

    if (needsCooling) {
        if (envData.t_ext < ta && hasWindows) {
            recs.push({
                id: `${zoneId}_free_cooling`,
                actionKey: 'free_cooling',
                zoneId, zoneName, timing: 'immediate', type: 'type-cool',
                title: 'Ventilation traversante (Free-cooling)',
                text: `Il fait plus frais dehors (${envData.t_ext} °C). Ouvrez pour décharger la chaleur.`,
                impactWeight: 20
            });
        }

        if (isSunny && hasShutters) {
            recs.push({
                id: `${zoneId}_shutter_close`,
                actionKey: 'shutter_close',
                zoneId, zoneName, timing: 'immediate', type: 'type-sun',
                title: 'Fermer les occultations extérieures',
                text: `Baissez les volets ou stores pour bloquer le rayonnement solaire direct.`,
                impactWeight: 25
            });
        }
    }

    if (needsHeat) {
        if (isSunny && envData.t_ext < ta) {
            recs.push({
                id: `${zoneId}_sun_heat`,
                actionKey: 'sun_heat',
                zoneId, zoneName, timing: 'immediate', type: 'type-sun',
                title: 'Ouvrir les protections solaires',
                text: `Laissez pénétrer les rayons du soleil pour réchauffer les parois.`,
                impactWeight: 20
            });
        }
    }

    return recs;
};
