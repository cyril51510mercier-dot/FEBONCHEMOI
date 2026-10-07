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
// CONFIGURATION ET CLIENT SUPABASE
// ============================================================
const SUPABASE_URL = 'https://hgmvwaehgedudklftltb.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhnbXZ3YWVoZ2VkdWRrbGZ0bHRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNTczMDEsImV4cCI6MjEwNTgzMzMwMX0.-w01Tc3baMZ0gCc4DMIH3VKI7P32m1wSifiWsruDKps';

let supabaseClient = null;
if (typeof supabase !== 'undefined') {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ------------------------------------------------------------
// HELPER : APPLICATION DU CONTEXTE GLOBAL (MÉTÉO & TAMPON)
// ------------------------------------------------------------
function applySharedEnvironment(data) {
    if (!data) return;
    
    if (data['__ENV__'] && (!window.hourlyExtForecast || window.hourlyExtForecast.length === 0)) {
        const env = data['__ENV__'];
        outdoorTemp = env.outdoorTemp ?? outdoorTemp;
        outdoorHumidity = env.outdoorHumidity ?? outdoorHumidity;
        outdoorWind = env.outdoorWind ?? outdoorWind;
        sunshineStatus = env.sunshineStatus ?? sunshineStatus;
        if (env.hourlyExtForecast) window.hourlyExtForecast = env.hourlyExtForecast;
        
        if (typeof updateWeatherUI === 'function') updateWeatherUI();
    }
    
    if (typeof data['__BUFFER_TOGGLE__'] === 'boolean') {
        includeBufferZones = data['__BUFFER_TOGGLE__'];
        const cb = document.getElementById('include-buffer-checkbox');
        if (cb && cb.checked !== includeBufferZones) cb.checked = includeBufferZones;
        localStorage.setItem('SOLSTICE_INCLUDE_BUFFER', includeBufferZones ? 'true' : 'false');
    }
}

// ============================================================
// SOLSTICE STORE — GESTION DU STOCKAGE CENTRALISÉ & CLOUD
// ============================================================
async function getConnectedHouseId() {
    if (!supabaseClient) return 'foyer_principal';
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) return 'foyer_principal';

        const { data } = await supabaseClient
            .from('house_members')
            .select('house_id')
            .eq('user_id', session.user.id)
            .maybeSingle();

        return data?.house_id || 'foyer_principal';
    } catch (e) {
        return 'foyer_principal';
    }
}

window.SolsticeStore = {
    STORAGE_KEY: 'HOUSE_CONFIG',
    
    async init() {
        const localConfig = this.getZones();
        const localScan = this.getScanData();
        const localRecos = this.getCheckedRecos();
        
        if (supabaseClient) {
            try {
                const houseId = await getConnectedHouseId();
                const { data, error } = await supabaseClient
                    .from('solstice_store')
                    .select('*')
                    .eq('house_id', houseId)
                    .maybeSingle();

                if (data) {
                    const remoteConfig = data.house_config || {};
                    const remoteScan = data.donnees_habitat || {};
                    const remoteRecos = data.checked_recos || {};

                    const mergedConfig = { ...localConfig, ...remoteConfig };
                    const mergedScan = { ...localScan, ...remoteScan };
                    const mergedRecos = { ...localRecos, ...remoteRecos };

                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(mergedConfig));
                    localStorage.setItem('SOLSTICE_DONNEES_HABITAT', JSON.stringify(mergedScan));
                    localStorage.setItem('SOLSTICE_CHECKED_RECOS', JSON.stringify(mergedRecos));

                    GLOBAL_HOUSE_CONFIG = mergedConfig;
                    DONNEES_HABITAT = mergedScan;

                    applySharedEnvironment(DONNEES_HABITAT);

                    rafraichirCapteursDepuisConfig();
                    recalculerToutLeDashboard();
                }
            } catch (e) {
                console.warn("[Solstice Store] Mode hors-ligne :", e);
            }
        }
        return this.getZones();
    },

    async syncAllToCloud() {
        if (!supabaseClient) return;
        try {
            const houseId = await getConnectedHouseId();
            const payload = {
                house_id: houseId,
                house_config: this.getZones(),
                donnees_habitat: this.getScanData(),
                checked_recos: this.getCheckedRecos(),
                updated_at: new Date().toISOString()
            };
            await supabaseClient.from('solstice_store').upsert(payload);
        } catch (e) {
            console.error("[Solstice Store] Échec synchro cloud :", e);
        }
    },

    saveZone(zoneId, zoneData) {
        if (!zoneId) return false;
        const config = this.getZones();
        config[zoneId] = zoneData;
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(config));
            this.syncAllToCloud();
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
        // Rechargement depuis le localStorage si l'objet mémoire 'config' est vide
        if (!this.config || Object.keys(this.config).length === 0) {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            this.config = raw ? JSON.parse(raw) : {};
        }
        return (this.config && Object.keys(this.config).length > 0) ? this.config : { global: {} };
    } catch (e) {
        console.error("[SolsticeStore] Erreur lecture getZones :", e);
        return { global: {} };
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

    saveScanData(data) {
        try {
            localStorage.setItem('SOLSTICE_DONNEES_HABITAT', JSON.stringify(data));
            sessionStorage.setItem('SOLSTICE_DONNEES_HABITAT', JSON.stringify(data));
            this.syncAllToCloud();
        } catch (e) {
            console.error("[Solstice] Erreur sauvegarde scan :", e);
        }
    },

    getEnvData() {
        try {
            const raw = localStorage.getItem('SOLSTICE_ENV_DATA');
            const data = raw ? JSON.parse(raw) : {};
            const envScan = (DONNEES_HABITAT && DONNEES_HABITAT['__ENV__']) || {};
            
            const tExt = typeof data.t_ext === 'number' ? data.t_ext : (typeof envScan.outdoorTemp === 'number' ? envScan.outdoorTemp : outdoorTemp);
            const rhExt = typeof data.rh_ext === 'number' ? data.rh_ext : (typeof envScan.outdoorHumidity === 'number' ? envScan.outdoorHumidity : outdoorHumidity);
            const sunStatus = data.sun_status || envScan.sunshineStatus || sunshineStatus || 'clear';

            return {
                t_ext: tExt,
                rh_ext: rhExt,
                sun_status: sunStatus,
                t_ext_max: typeof data.t_ext_max === 'number' ? data.t_ext_max : (tExt + 3),
                t_ext_min: typeof data.t_ext_min === 'number' ? data.t_ext_min : (tExt - 5)
            };
        } catch (e) {
            console.error("[SolsticeStore] Erreur lecture EnvData :", e);
            return { t_ext: outdoorTemp || 15, rh_ext: outdoorHumidity || 60, sun_status: sunshineStatus || 'clear', t_ext_max: 18, t_ext_min: 10 };
        }
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
            this.syncAllToCloud();
            return true;
        } catch (e) {
            return false;
        }
    }
};

// ============================================================
// HELPER ET COMPORTEMENTS DE L'APPLICATION
// ============================================================

function getClothingDescription(clo) {
    if (clo < 0.45) return "Short & débardeur léger";
    if (clo < 0.55) return "T-shirt, short / jupe légère & nu-pieds";
    if (clo < 0.75) return "Pantalon léger & T-shirt / chemisette";
    if (clo < 0.95) return "Pantalon & T-shirt manches longues / chemise";
    if (clo < 1.15) return "Pantalon, chemise & pull léger";
    if (clo < 1.35) return "Pull chaud, pantalon épais & chaussettes";
    return "Gros pull, veste d'intérieur & plaid";
}

function rafraichirCapteursDepuisConfig() {
    capteursMaison = {};
    const configToUse = GLOBAL_HOUSE_CONFIG.zones || GLOBAL_HOUSE_CONFIG;
    Object.entries(configToUse).forEach(([key, zone]) => {
        if (zone && typeof zone === 'object') {
            const roomName = zone.name || zone.nom || zone.title;
            if (roomName) {
                capteursMaison[roomName] = zone.sensorId || zone.id || key;
            }
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
    
    DONNEES_HABITAT['__BUFFER_TOGGLE__'] = checked;
    if (window.SolsticeStore && window.SolsticeStore.saveScanData) {
        window.SolsticeStore.saveScanData(DONNEES_HABITAT);
    }
    
    actualiserCockpitGlobal();
};

window.addEventListener('load', async () => {
    if (window.SolsticeStore && window.SolsticeStore.init) {
        await window.SolsticeStore.init();
    }

    const savedConfig = localStorage.getItem('HOUSE_CONFIG');
    if (savedConfig && Object.keys(JSON.parse(savedConfig)).length > 0) { 
        GLOBAL_HOUSE_CONFIG = JSON.parse(savedConfig); 
        rafraichirCapteursDepuisConfig();
    } else { 
        alert("Aucune configuration trouvée. Veuillez paramétrer l'habitat."); 
        window.location.href = 'setup.html'; 
        return; 
    }

    const savedSelection = localStorage.getItem('SOLSTICE_SELECTION_PIECES');
    if (savedSelection) {
        try { SELECTION_PIECES = JSON.parse(savedSelection); } catch(e) {}
    }
    if (!SELECTION_PIECES || SELECTION_PIECES.length === 0 || !SELECTION_PIECES.some(p => Object.keys(capteursMaison).includes(p))) {
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
        applySharedEnvironment(DONNEES_HABITAT);
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

    const ta = (data && data.ta !== undefined) ? data.ta : (isOutdoor ? outdoorTemp : 0);
    const rh = (data && data.rh !== undefined) ? data.rh : (isOutdoor ? outdoorHumidity : 0);

    if (colIndex === 2) return ta;
    if (colIndex === 3) return rh;
    if (colIndex === 4) return calculateAbsoluteHumidity(ta, rh);

    const vel = calculateAirVelocity(zoneConfig, nomPiece);
    const tr = calculateMeanRadiantTemp(zoneConfig, ta);
    const { met, totalClo } = getBaseCloAndMet(zoneConfig);

    if (colIndex === 5) return isOutdoor ? -999 : calculatePMV(ta, tr, vel, rh, met, totalClo);
    if (colIndex === 6) return isOutdoor ? -999 : calculateDailyThermalBalance(zoneConfig, ta).bilanNetkWh;
    if (colIndex === 7) return isOutdoor ? -999 : ta;
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
    const currentHour = new Date().getHours();
    
    let tRefClo = outdoorTemp;
    if (currentHour >= 11 && currentHour < 18) {
        if (Array.isArray(window.hourlyExtForecast) && window.hourlyExtForecast.length > 0) {
            tRefClo = Math.max(...window.hourlyExtForecast.map(s => s.temp));
        }
    }

    let baseClo = Math.max(0.35, Math.min(1.30, 1.20 - 0.035 * (tRefClo - 5)));

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
        return { hTotalWPerK: 0, deperditionskWh: 0, gainsConductionkWh: 0, gainsSolaireskWh: 0, gainsTotauxkWh: 0, bilanNetkWh: 0, bilanDiurnekWh: 0, bilanNocturnekWh: 0, depKw: 0, gainsConductionKw: 0, gainsSolairesKw: 0 };
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

    const puissanceNetteKw = (gainsConductionKw + gainsSolairesKw) - depKw;

    let deperditionskWh = 0;
    let gainsConductionkWh = 0;
    let gainsSolaireskWh = 0;
    
    let bilanDiurnekWh = 0;
    let bilanNocturnekWh = 0;
    let bilanPasseKwh = 0;
    let bilanFuturKwh = 0;

    const currentHour = new Date().getHours();
    const sunriseH = window.solsticeEphemeris?.sunriseHour || 7;
    const sunsetH = window.solsticeEphemeris?.sunsetHour || 19;

    // Fixation de la température intérieure de référence à 20°C pour stabiliser la projection
    const tIntRef = 20.0; 

    if (Array.isArray(window.hourlyExtForecast) && window.hourlyExtForecast.length === 24) {
        window.hourlyExtForecast.forEach(slot => {
            const tExtHour = slot.temp;
            let depHour = 0;
            let gainsCondHour = 0;
            let gainsSolHour = 0;

            if (tIntRef > tExtHour) {
                depHour = (hTotal * (tIntRef - tExtHour)) / 1000;
            } else {
                gainsCondHour = (hTotal * (tExtHour - tIntRef)) / 1000;
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

                    gainsSolHour += (wArea * gFactor * maskFactor * shutterFactor * (iSolar / 12));
                });
            }

            deperditionskWh += depHour;
            gainsConductionkWh += gainsCondHour;
            gainsSolaireskWh += gainsSolHour;

            const netHour = (gainsCondHour + gainsSolHour) - depHour;
            
            if (slot.hour >= sunriseH && slot.hour < sunsetH) {
                bilanDiurnekWh += netHour;
            } else {
                bilanNocturnekWh += netHour;
            }

            // Progression temporelle au cours de la journée
            if (slot.hour < currentHour) {
                bilanPasseKwh += netHour;
            } else {
                bilanFuturKwh += netHour;
            }
        });
    } else {
        deperditionskWh = depKw * 24;
        gainsConductionkWh = gainsConductionKw * 24;
        gainsSolaireskWh = gainsSolairesKw * 24;
        bilanDiurnekWh = (gainsConductionKw + gainsSolairesKw - depKw) * 12;
        bilanNocturnekWh = (gainsConductionKw - depKw) * 12;

        const fractionPassee = Math.min(24, Math.max(0, currentHour)) / 24;
        const totalNetJour = (gainsConductionKw + gainsSolairesKw - depKw) * 24;
        bilanPasseKwh = totalNetJour * fractionPassee;
        bilanFuturKwh = totalNetJour * (1 - fractionPassee);
    }

    const gainsTotauxkWh = gainsSolaireskWh + gainsConductionkWh;
    const bilanNetkWh = gainsTotauxkWh - deperditionskWh;

    return {
        hTotalWPerK: parseFloat(hTotal.toFixed(1)),
        depKw: parseFloat(depKw.toFixed(2)),
        gainsConductionKw: parseFloat(gainsConductionKw.toFixed(2)),
        gainsSolairesKw: parseFloat(gainsSolairesKw.toFixed(2)),
        puissanceNetteKw: parseFloat(puissanceNetteKw.toFixed(2)),
        deperditionskWh: parseFloat(deperditionskWh.toFixed(2)),
        gainsConductionkWh: parseFloat(gainsConductionkWh.toFixed(2)),
        gainsSolaireskWh: parseFloat(gainsSolaireskWh.toFixed(2)),
        gainsTotauxkWh: parseFloat(gainsTotauxkWh.toFixed(2)),
        bilanNetkWh: parseFloat(bilanNetkWh.toFixed(2)),
        bilanPasseKwh: parseFloat(bilanPasseKwh.toFixed(2)),
        bilanFuturKwh: parseFloat(bilanFuturKwh.toFixed(2)),
        bilanDiurnekWh: parseFloat(bilanDiurnekWh.toFixed(2)),
        bilanNocturnekWh: parseFloat(bilanNocturnekWh.toFixed(2)),
        currentHour
    };
}

// ============================================================
// MODÈLE D'INERTIE ET RÉSERVE THERMIQUE AVANCÉ (BEM & RATTRAPAGE)
// ============================================================

function calculateDynamicTau(zoneConfig) {
    if (!zoneConfig) return 20.0;

    // Capacité thermique surfacique efficace Cm (Wh / (m²·K)) selon ISO 13790
    const wallMat = zoneConfig.wallMat || 'cinderblock';
    const ins = zoneConfig.insulation || 'iti_recent';
    const floorMat = zoneConfig.floorMat || 'lourd';
    const ceilingMat = zoneConfig.ceilingMat || 'leger';

    let cmPerM2 = 45; // Base inertie moyenne (parpaing + plâtre intérieur)

    // Impact matériau des murs
    if (['concrete', 'stone'].includes(wallMat)) {
        cmPerM2 += 35; // Forte masse minérale
    } else if (wallMat === 'wood' || wallMat === 'brique_creuse') {
        cmPerM2 -= 15; // Inertie plus faible
    }

    // Impact position de l'isolation (l'ITE permet de mobiliser toute la masse des murs)
    if (ins.startsWith('ite')) {
        cmPerM2 += 30; // Murs lourds inclus dans le volume chauffé
    } else if (ins.startsWith('iti')) {
        cmPerM2 -= 15; // L'isolation intérieure coupe l'inertie du mur porteur
    }

    if (floorMat === 'lourd') cmPerM2 += 15; // Dalle béton
    if (ceilingMat === 'lourd') cmPerM2 += 10; // Dalle / plafond béton

    // Estimation de la résistance thermique moyenne
    let rMoyen = 2.2;
    if (ins.includes('recent') || ins.includes('heavy')) rMoyen = 3.6;
    else if (ins.includes('old')) rMoyen = 1.8;
    else if (ins === 'none') rMoyen = 0.6;

    // Constante de temps tau = R * C (heures)
    const tauEstime = (cmPerM2 * rMoyen) / 4.0;
    return Math.max(8.0, Math.min(72.0, parseFloat(tauEstime.toFixed(1))));
}

function calculateEquilibriumTstruct(zoneConfig, tOp, tExt24h) {
    if (!zoneConfig) return tOp;

    const ins = zoneConfig.insulation || 'iti_recent';
    let rInt = 0.13;
    let rExt = 0.04;

    if (ins === 'iti_recent') { rInt += 3.2; rExt += 0.2; }
    else if (ins === 'iti_old') { rInt += 1.4; rExt += 0.2; }
    else if (ins === 'ite_heavy') { rInt += 0.2; rExt += 3.8; }
    else if (ins === 'ite_old') { rInt += 0.2; rExt += 1.8; }
    else { rInt += 0.1; rExt += 0.1; }

    return (rExt * tOp + rInt * tExt24h) / (rInt + rExt);
}

function updateStructureTemperature(nomPiece, currentTa) {
    const now = Date.now();
    const zoneConfig = getZoneConfigByName(nomPiece);
    const tMr = calculateMeanRadiantTemp(zoneConfig, currentTa);
    const currentTop = (currentTa + tMr) / 2;
    const tExt24h = getDailyOutdoorTemp();
    const tau = calculateDynamicTau(zoneConfig);

    if (!DONNEES_HABITAT[nomPiece]) {
        DONNEES_HABITAT[nomPiece] = {};
    }
    const roomData = DONNEES_HABITAT[nomPiece];

    let lastTstruct = roomData.tStruct;
    let lastTop = roomData.lastTop;
    let lastTimestamp = roomData.lastTimestamp;

    if (lastTstruct === undefined) {
        const lastDataRaw = localStorage.getItem(`SOLSTICE_TSTRUCT_${nomPiece}`);
        if (lastDataRaw) {
            try {
                const parsed = JSON.parse(lastDataRaw);
                lastTstruct = parsed.tStruct;
                lastTop = parsed.lastTop;
                lastTimestamp = parsed.lastTimestamp;
            } catch (e) {}
        }
    }

    if (lastTstruct === undefined || !lastTimestamp) {
        const initialTstruct = calculateEquilibriumTstruct(zoneConfig, currentTop, tExt24h);
        roomData.tStruct = parseFloat(initialTstruct.toFixed(2));
        roomData.lastTop = parseFloat(currentTop.toFixed(2));
        roomData.lastTimestamp = now;
        return roomData.tStruct;
    }

    const dtHours = (now - lastTimestamp) / (1000 * 3600);
    if (dtHours < 0.016) return roomData.tStruct;

    let newTstruct = lastTstruct;
    const prevTop = lastTop !== undefined ? lastTop : currentTop;

    if (dtHours > 24) {
        newTstruct = calculateEquilibriumTstruct(zoneConfig, currentTop, tExt24h);
    } else if (dtHours > 2) {
        const steps = Math.floor(dtHours);
        const alphaStep = 1 - Math.exp(-1 / tau);
        const tTopStep = (currentTop - prevTop) / steps;

        for (let i = 1; i <= steps; i++) {
            const interpolatedTop = prevTop + (tTopStep * i);
            newTstruct = newTstruct + alphaStep * (interpolatedTop - newTstruct);
        }

        const remainder = dtHours - steps;
        if (remainder > 0.01) {
            const alphaRem = 1 - Math.exp(-remainder / tau);
            newTstruct = newTstruct + alphaRem * (currentTop - newTstruct);
        }
    } else {
        const alpha = 1 - Math.exp(-dtHours / tau);
        newTstruct = lastTstruct + alpha * (currentTop - lastTstruct);
    }

    roomData.tStruct = parseFloat(newTstruct.toFixed(2));
    roomData.lastTop = parseFloat(currentTop.toFixed(2));
    roomData.lastTimestamp = now;

    return roomData.tStruct;
}

function calculateStructureReserve(tStruct, tAir, totalVolumeM3 = 100, tauReel = 18.0, options = {}) {
    const deltaFlux = tStruct - tAir;
    // Conductance volumique surfacique d'échange convectif & radiatif intérieur h_i * S_parois / V
    // En résidentiel standard : h_i ~ 7.7 W/(m²K), ratio S_parois/V ~ 2.2 m²/m³ => ~ 17 W/(K·m³)
    const fluxPowerKw = (totalVolumeM3 * 17 * deltaFlux) / 1000;
    const absPowerKw = Math.abs(fluxPowerKw).toFixed(2);

    let fluxStatusText = "";
    let fluxColor = "#4ADE80";

    if (deltaFlux > 0.3) {
        fluxStatusText = `🔥 Restitution (+${absPowerKw} kW)`;
        fluxColor = "#FDBA74";
    } else if (deltaFlux < -0.3) {
        fluxStatusText = `❄️ Absorption (-${absPowerKw} kW)`;
        fluxColor = "#38BDF8";
    } else {
        fluxStatusText = "⚖️ Équilibre (0 kW)";
        fluxColor = "#4ADE80";
    }

    // --- CALCUL THERMODYNAMIQUE DE L'AUTONOMIE T_STRUCT -> 19°C ---
    // En régime libre sans chauffage, le bâtiment tend vers sa température d'équilibre libre :
    // T_eq = T_ext + (Apports_internes + Apports_solaires) / H_total
    const tExtMoy = (options.tExt !== undefined) ? options.tExt : getDailyOutdoorTemp(); 
    const tCible = 19.0;

    // Détermination de H_total (W/K) et des apports gratuits (W)
    const hTotalWPerK = (options.hTotalWPerK && options.hTotalWPerK > 0)
        ? options.hTotalWPerK
        : (totalVolumeM3 * 0.6); // Estimation de sécurité ~0.6 W/(K·m³)

    // Apports internes moyens (~1.5 W/m³ de présence et équipements)
    const internalGainsW = (options.internalGainsKw !== undefined)
        ? (options.internalGainsKw * 1000)
        : (totalVolumeM3 * 1.5);

    // Apports solaires moyens
    const solarGainsW = (options.gainsSolairesKw !== undefined)
        ? (options.gainsSolairesKw * 1000)
        : 0;

    const totalFreeGainsW = internalGainsW + solarGainsW;
    const deltaTeq = totalFreeGainsW / Math.max(10, hTotalWPerK);
    const tEquilibre = tExtMoy + deltaTeq;

    let autonomyText = "";
    let hoursTo19 = 0;

    if (tStruct <= tCible) {
        autonomyText = "Parois ≤ 19°C (0 h)";
    } else if (tEquilibre >= tCible) {
        // La température asymptotique d'équilibre libre est supérieure à 19°C :
        // L'habitat reste naturellement au-dessus de 19°C sans chauffage grâce aux apports gratuits !
        autonomyText = "Illimitée (Équilibre ≥ 19°C)";
    } else {
        // Décroissance exponentielle vers T_eq :
        // T(t) = T_eq + (T_struct - T_eq) * exp(-t / tau)
        // t_19 = tau * ln( (T_struct - T_eq) / (19 - T_eq) )
        const denom = tCible - tEquilibre;
        const num = tStruct - tEquilibre;

        if (denom <= 0.05) {
            autonomyText = "> 5 jours";
        } else {
            const ratio = num / denom;
            if (ratio <= 1.0) {
                autonomyText = "Parois ≤ 19°C (0 h)";
            } else {
                hoursTo19 = tauReel * Math.log(ratio);

                if (hoursTo19 >= 120) {
                    autonomyText = "> 5 jours";
                } else if (hoursTo19 >= 48) {
                    const days = (hoursTo19 / 24).toFixed(1);
                    autonomyText = `~${days} jours`;
                } else {
                    autonomyText = `~${hoursTo19.toFixed(1)} h`;
                }
            }
        }
    }

    // --- ANALYSE FIABILISÉE DES CONSEILS D'INERTIE ---
    const rawConfig = localStorage.getItem('HOUSE_CONFIG');
    const houseConfig = rawConfig ? JSON.parse(rawConfig) : {};
    
    const profileKey = houseConfig.profile 
                    || houseConfig.global?.profile 
                    || houseConfig.global?.userProfile 
                    || localStorage.getItem('SOLSTICE_PROFILE') 
                    || 'long_term';

    let tMaxPrevue = outdoorTemp;
    let tMinPrevue = outdoorTemp - 8.0; // Fallback cohérent si prévisions indisponibles

    if (Array.isArray(window.hourlyExtForecast) && window.hourlyExtForecast.length > 0) {
        const tempsMeteo = window.hourlyExtForecast.map(s => s.temp);
        tMaxPrevue = Math.max(...tempsMeteo);
        tMinPrevue = Math.min(...tempsMeteo);
    }

    // Conditions strictes de décharge :
    // 1. Surchauffe avérée (parois >= 24.0°C ou air >= 24.0°C)
    const surchauffeInterieure = (tStruct >= 24.0 || tAir >= 24.0);
    // 2. Chaleur extérieure durable (moyenne 24h >= 20°C et nuit >= 17°C)
    const vraieSurchauffeExterieure = (tExtMoy >= 20.0 && tMinPrevue >= 17.0);
    // 3. Présence de nuits fraîches ou d'intersaison
    const nuitsFraichesOuIntersaison = (tMinPrevue < 16.0 || tExtMoy < 19.0 || isHeatingSeasonActive());

    let actionText = "";

    if (surchauffeInterieure && vraieSurchauffeExterieure && !nuitsFraichesOuIntersaison) {
        actionText = "🌙 Décharger chaleur";
    } else if (nuitsFraichesOuIntersaison || !surchauffeInterieure) {
        if (tStruct < 22.0) {
            actionText = (profileKey === 'short_term') ? "☀️ Stocker chaleur" : "☀️ Anticiper & stocker";
        } else {
            actionText = "🛡️ Conserver chaleur";
        }
    } else {
        actionText = "⚖️️ Maintenir équilibre";
    }
    
    let actionColor = "#F8FAFC";
    if (actionText.includes("Stocker") || actionText.includes("Conserver")) actionColor = "#4ADE80";
    if (actionText.includes("Décharger")) actionColor = "#38BDF8";
    if (actionText.includes("équilibre")) actionColor = "#94A3B8";

    return {
        tStruct: parseFloat(tStruct.toFixed(1)),
        tEquilibre: parseFloat(tEquilibre.toFixed(1)),
        deltaTeq: parseFloat(deltaTeq.toFixed(1)),
        fluxPowerKw: parseFloat(fluxPowerKw.toFixed(2)),
        fluxStatusText,
        fluxColor,
        actionColor,
        autonomyText,
        hoursTo19: parseFloat(hoursTo19.toFixed(1)),
        actionText
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
    let weightedDryingIndex = 0;
    let weightedTau = 0;

    let totalDeperditionsKw = 0;
    let totalGainsConductionKw = 0;
    let totalGainsSolairesKw = 0;
    let totalPuissanceNetteKw = 0;
    let totalBilanNetKwh = 0;
    let totalBilanPasseKwh = 0;
    let totalBilanFuturKwh = 0;

    let totalBilanDiurnekWh = 0;
    let totalBilanNocturnekWh = 0;
    let totalHTotalWPerK = 0;

    for (const [nomPiece, data] of Object.entries(DONNEES_HABITAT)) {
        if (nomPiece === '__ENV__' || nomPiece === '__BUFFER_TOGGLE__') continue;
        if (!data || isNaN(data.ta) || isNaN(data.rh)) continue;

        const zoneConfig = getZoneConfigByName(nomPiece) || { area: 15, height: 2.5 };
        if (isOutdoorZone(nomPiece, zoneConfig)) continue;
        if (!includeBufferZones && isBufferZone(nomPiece, zoneConfig)) continue;

        const area = parseFloat(zoneConfig.area) || 15;
        const height = parseFloat(zoneConfig.height) || 2.5;
        const volume = area * height;

        const tauPiece = calculateDynamicTau(zoneConfig);

        const ah = calculateAbsoluteHumidity(data.ta, data.rh);
        const vel = calculateAirVelocity(zoneConfig, nomPiece);
        const tr = calculateMeanRadiantTemp(zoneConfig, data.ta);
        const { met, totalClo } = getBaseCloAndMet(zoneConfig);
        const pmv = calculatePMV(data.ta, tr, vel, data.rh, met, totalClo);
        
        const drying = calculateDryingPotential(data.ta, data.rh, vel);
        const energy = calculateDailyThermalBalance(zoneConfig, data.ta);
        const tStruct = updateStructureTemperature(nomPiece, data.ta);

        totalVolume += volume;
        weightedTau += tauPiece * volume;
        weightedTemp += data.ta * volume;
        weightedRH += data.rh * volume;
        weightedAH += ah * volume;
        weightedPMV += pmv * volume;
        weightedTStruct += tStruct * volume;
        weightedDryingIndex += drying.dryingIndex * volume;

        totalDeperditionsKw += energy.depKw;
        totalGainsConductionKw += energy.gainsConductionKw;
        totalGainsSolairesKw += energy.gainsSolairesKw;
        totalPuissanceNetteKw += energy.puissanceNetteKw;
        totalBilanNetKwh += energy.bilanNetkWh;
        totalBilanPasseKwh += energy.bilanPasseKwh;
        totalBilanFuturKwh += energy.bilanFuturKwh;

        totalBilanDiurnekWh += energy.bilanDiurnekWh;
        totalBilanNocturnekWh += energy.bilanNocturnekWh;
        totalHTotalWPerK += energy.hTotalWPerK;
    }

    if (totalVolume === 0) return null;
    const avgTau = weightedTau / totalVolume;

    const velExt = (outdoorWind || 0) / 3.6;
    const dryingOutdoor = calculateDryingPotential(outdoorTemp, outdoorHumidity, velExt);

    const avgDryingIndoorIndex = weightedDryingIndex / totalVolume;
    const indoorDryingScore10 = (Math.min(100, Math.max(0, Math.round((avgDryingIndoorIndex / 1.8) * 100))) / 10).toFixed(1);

    return {
        avgTemp: parseFloat((weightedTemp / totalVolume).toFixed(1)),
        avgRH: parseFloat((weightedRH / totalVolume).toFixed(0)),
        avgAH: parseFloat((weightedAH / totalVolume).toFixed(2)),
        avgPMV: parseFloat((weightedPMV / totalVolume).toFixed(2)),
        avgTStruct: parseFloat((weightedTStruct / totalVolume).toFixed(1)),
        avgTau: parseFloat(avgTau.toFixed(1)),
        indoorDryingScore10: indoorDryingScore10,
        outdoorDryingScore10: dryingOutdoor.score10,
        totalDeperditionsKw: parseFloat(totalDeperditionsKw.toFixed(2)),
        totalGainsConductionKw: parseFloat(totalGainsConductionKw.toFixed(2)),
        totalGainsSolairesKw: parseFloat(totalGainsSolairesKw.toFixed(2)),
        totalPuissanceNetteKw: parseFloat(totalPuissanceNetteKw.toFixed(2)),
        totalBilanNetKwh: parseFloat(totalBilanNetKwh.toFixed(2)),
        totalBilanPasseKwh: parseFloat(totalBilanPasseKwh.toFixed(2)),
        totalBilanFuturKwh: parseFloat(totalBilanFuturKwh.toFixed(2)),
        totalBilanDiurnekWh: parseFloat(totalBilanDiurnekWh.toFixed(2)),
        totalBilanNocturnekWh: parseFloat(totalBilanNocturnekWh.toFixed(2)),
        totalHTotalWPerK: parseFloat(totalHTotalWPerK.toFixed(1)),
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

    const currentTa = (data && data.ta !== undefined) ? data.ta : (isOutdoor ? outdoorTemp : 0);
    const currentRh = (data && data.rh !== undefined) ? data.rh : (isOutdoor ? outdoorHumidity : 0);

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
        const dryingExt = calculateDryingPotential(currentTa, currentRh, velExt);
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
        energyEl.title = `Bilan cumulé (${energyBalance.currentHour}h) : ${energyBalance.bilanPasseKwh > 0 ? '+' : ''}${energyBalance.bilanPasseKwh} kWh | Flux direct : ${energyBalance.puissanceNetteKw > 0 ? '+' : ''}${energyBalance.puissanceNetteKw} kW`;
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
    if (!metrics) return;

    const now = new Date();
    const currentH = now.getHours();

    // ============================================================
    // 1. EXTÉRIEUR (Données réelles et Ciel SVG)
    // ============================================================
    const extTemp = outdoorTemp;
    const extRh = outdoorHumidity;
    const extAh = calculateAbsoluteHumidity(extTemp, extRh);
    const extDrying = metrics.outdoorDryingScore10;

    const sunriseH = window.solsticeEphemeris?.sunriseHour || 7;
    const sunsetH = window.solsticeEphemeris?.sunsetHour || 19;
    const isNight = currentH < sunriseH || currentH >= sunsetH;
    const isSunny = (sunshineStatus || '').toLowerCase().includes('clear') || (sunshineStatus || '').toLowerCase().includes('sun');

    let extEmoji = isNight ? '🌙' : (isSunny ? '☀️' : '⛅');
    let extLabel = isNight ? 'Nuit' : (isSunny ? 'Ensoleillé' : (sunshineStatus || 'Variable'));
    if ((sunshineStatus || '').toLowerCase().includes('rain')) { extEmoji = '🌧️'; extLabel = 'Pluie'; }
    if ((sunshineStatus || '').toLowerCase().includes('snow')) { extEmoji = '❄️'; extLabel = 'Neige'; }

    // Rendu Carte Extérieur
    const txtExtTemp = document.getElementById('txt-ext-temp');
    if (txtExtTemp) txtExtTemp.textContent = `${extTemp.toFixed(1)} °C`;
    const txtExtRh = document.getElementById('txt-ext-rh');
    if (txtExtRh) txtExtRh.textContent = `${extRh}%`;
    const txtExtAh = document.getElementById('txt-ext-ah');
    if (txtExtAh) txtExtAh.textContent = `${extAh.toFixed(1)} g/m³`;
    const txtExtDrying = document.getElementById('txt-ext-drying');
    if (txtExtDrying) txtExtDrying.textContent = `${extDrying}/10`;
    const txtExtEmoji = document.getElementById('txt-ext-emoji');
    if (txtExtEmoji) txtExtEmoji.textContent = extEmoji;
    const txtExtLabel = document.getElementById('txt-ext-label');
    if (txtExtLabel) txtExtLabel.textContent = extLabel;

    // Rendu SVG Astre Céleste (Soleil / Lune / Nuages)
    const svgSkyCore = document.getElementById('svg-sky-core');
    const svgSkyCorona = document.getElementById('svg-sky-corona');
    const svgCone = document.getElementById('volumetric-cone');
    if (svgSkyCore) {
        if (isNight) {
            svgSkyCore.setAttribute('fill', '#38BDF8');
            if (svgSkyCorona) svgSkyCorona.setAttribute('stop-opacity', '0.20');
            if (svgCone) svgCone.setAttribute('fill-opacity', '0');
        } else if (isSunny) {
            svgSkyCore.setAttribute('fill', '#F59E0B');
            if (svgSkyCorona) svgSkyCorona.setAttribute('stop-opacity', '0.95');
            if (svgCone) svgCone.setAttribute('fill-opacity', '0.22');
        } else {
            svgSkyCore.setAttribute('fill', '#94A3B8');
            if (svgSkyCorona) svgSkyCorona.setAttribute('stop-opacity', '0.35');
            if (svgCone) svgCone.setAttribute('fill-opacity', '0.06');
        }
    }

    // ============================================================
    // 2. BATTERIE DES MURS & AUTONOMIE
    // ============================================================
    const globalReserve = calculateStructureReserve(
        metrics.avgTStruct, 
        metrics.avgTemp, 
        metrics.totalVolumeM3, 
        metrics.avgTau,
        {
            hTotalWPerK: metrics.totalHTotalWPerK,
            gainsSolairesKw: metrics.totalGainsSolairesKw,
            tExt: outdoorTemp
        }
    );

    const txtWallTemp = document.getElementById('txt-wall-temp');
    if (txtWallTemp) txtWallTemp.textContent = `${metrics.avgTStruct.toFixed(1)} °C`;
    const txtAutonomyVal = document.getElementById('txt-autonomy-val');
    if (txtAutonomyVal) txtAutonomyVal.textContent = globalReserve.autonomyText;
    
    const txtAutonomyBar = document.getElementById('txt-autonomy-bar');
    if (txtAutonomyBar) {
        let barPct = 50;
        if (globalReserve.hoursTo19 !== undefined && !isNaN(globalReserve.hoursTo19)) {
            barPct = Math.min(100, Math.max(5, Math.round((globalReserve.hoursTo19 / 36) * 100)));
        } else if (globalReserve.autonomyText.includes('Illimitée')) {
            barPct = 100;
        } else if (globalReserve.autonomyText.includes('≤ 19°C')) {
            barPct = 0;
        }
        txtAutonomyBar.style.width = `${barPct}%`;
    }

    // ============================================================
    // 3. AIR INTÉRIEUR
    // ============================================================
    const txtInTemp = document.getElementById('txt-in-temp');
    if (txtInTemp) txtInTemp.textContent = `${metrics.avgTemp.toFixed(1)} °C`;
    const txtInRh = document.getElementById('txt-in-rh');
    if (txtInRh) txtInRh.textContent = `${metrics.avgRH} %`;
    const txtInAh = document.getElementById('txt-in-ah');
    if (txtInAh) txtInAh.textContent = `${metrics.avgAH.toFixed(1)} g/m³`;
    const txtInDrying = document.getElementById('txt-in-drying');
    if (txtInDrying) txtInDrying.textContent = `${metrics.indoorDryingScore10}/10`;

    const txtPmvBadge = document.getElementById('txt-pmv-badge');
    let pmvLabel = "Confort Idéal";
    let pmvClass = "bg-emerald-950/80 border-emerald-400/50 text-emerald-200";
    if (metrics.avgPMV > 0.75) {
        pmvLabel = "Inconfort Chaud";
        pmvClass = "bg-red-950/80 border-red-400/50 text-red-200";
    } else if (metrics.avgPMV > 0.2) {
        pmvLabel = "Légère Chaleur";
        pmvClass = "bg-amber-950/80 border-amber-400/50 text-amber-200";
    } else if (metrics.avgPMV < -0.75) {
        pmvLabel = "Inconfort Frais";
        pmvClass = "bg-blue-950/80 border-blue-400/50 text-blue-200";
    } else if (metrics.avgPMV < -0.2) {
        pmvLabel = "Légère Fraîcheur";
        pmvClass = "bg-sky-950/80 border-sky-400/50 text-sky-200";
    }
    const signPmv = metrics.avgPMV > 0 ? "+" : "";
    if (txtPmvBadge) {
        txtPmvBadge.textContent = `${pmvLabel} (${signPmv}${metrics.avgPMV.toFixed(2)})`;
        txtPmvBadge.className = `text-[10px] font-extrabold px-2 py-0.5 rounded-full border text-crisp ${pmvClass}`;
    }

    // ============================================================
    // 4. FLUX THERMIQUES LASER COURT (Fenêtre & Mur)
    // ============================================================
    // Flux Extérieur (fenêtre/enveloppe)
    const netExtKw = (metrics.totalGainsSolairesKw + metrics.totalGainsConductionKw) - metrics.totalDeperditionsKw;
    const txtFluxExtTag = document.getElementById('txt-flux-ext-tag');
    const txtFluxExtVal = document.getElementById('txt-flux-ext-val');
    const lineExt = document.getElementById('flux-laser-ext-line');
    const haloExt = document.getElementById('flux-laser-ext-halo');

    if (txtFluxExtTag && txtFluxExtVal && lineExt && haloExt) {
        if (netExtKw > 0.15) {
            txtFluxExtTag.textContent = isSunny ? "☀️ Gain Solaire" : "🌡️ Apport Extérieur";
            txtFluxExtVal.textContent = `+${netExtKw.toFixed(2)} kW`;
            txtFluxExtVal.style.color = "#F59E0B";
            lineExt.setAttribute('d', "M 310 220 L 440 220");
            lineExt.setAttribute('stroke', "#F59E0B");
            lineExt.setAttribute('class', "flow-laser laser-orange");
            lineExt.setAttribute('marker-end', "url(#mk-laser-orange)");
            haloExt.setAttribute('d', "M 310 220 L 440 220");
            haloExt.setAttribute('stroke', "#F59E0B");
        } else if (netExtKw < -0.15) {
            txtFluxExtTag.textContent = "❄️ Pertes Extérieur";
            txtFluxExtVal.textContent = `${netExtKw.toFixed(2)} kW`;
            txtFluxExtVal.style.color = "#38BDF8";
            lineExt.setAttribute('d', "M 440 220 L 310 220");
            lineExt.setAttribute('stroke', "#38BDF8");
            lineExt.setAttribute('class', "flow-laser laser-blue");
            lineExt.setAttribute('marker-end', "url(#mk-laser-blue)");
            haloExt.setAttribute('d', "M 440 220 L 310 220");
            haloExt.setAttribute('stroke', "#38BDF8");
        } else {
            txtFluxExtTag.textContent = "⚖️ Équilibre Ext.";
            txtFluxExtVal.textContent = "0.00 kW";
            txtFluxExtVal.style.color = "#10B981";
            lineExt.setAttribute('d', "M 310 220 L 440 220");
            lineExt.setAttribute('stroke', "#10B981");
            lineExt.setAttribute('class', "flow-laser");
            lineExt.setAttribute('marker-end', "");
            haloExt.setAttribute('d', "M 310 220 L 440 220");
            haloExt.setAttribute('stroke', "#10B981");
        }
    }

    // Flux Murs (Batterie thermique)
    const fluxWallKw = globalReserve.fluxPowerKw;
    const txtFluxWallTag = document.getElementById('txt-flux-wall-tag');
    const txtFluxWallVal = document.getElementById('txt-flux-wall-val');
    const lineWall = document.getElementById('flux-laser-wall-line');
    const haloWall = document.getElementById('flux-laser-wall-halo');

    if (txtFluxWallTag && txtFluxWallVal && lineWall && haloWall) {
        if (fluxWallKw > 0.15) {
            txtFluxWallTag.textContent = "🔥 Restitution";
            txtFluxWallVal.textContent = `+${fluxWallKw.toFixed(2)} kW`;
            txtFluxWallVal.style.color = "#F59E0B";
            lineWall.setAttribute('d', "M 948 220 L 830 220");
            lineWall.setAttribute('stroke', "#F59E0B");
            lineWall.setAttribute('class', "flow-laser laser-orange");
            lineWall.setAttribute('marker-end', "url(#mk-laser-orange)");
            haloWall.setAttribute('d', "M 948 220 L 830 220");
            haloWall.setAttribute('stroke', "#F59E0B");
        } else if (fluxWallKw < -0.15) {
            txtFluxWallTag.textContent = "🧱 Absorption Murs";
            txtFluxWallVal.textContent = `${fluxWallKw.toFixed(2)} kW`;
            txtFluxWallVal.style.color = "#38BDF8";
            lineWall.setAttribute('d', "M 830 220 L 948 220");
            lineWall.setAttribute('stroke', "#38BDF8");
            lineWall.setAttribute('class', "flow-laser laser-blue");
            lineWall.setAttribute('marker-end', "url(#mk-laser-blue)");
            haloWall.setAttribute('d', "M 830 220 L 948 220");
            haloWall.setAttribute('stroke', "#38BDF8");
        } else {
            txtFluxWallTag.textContent = "⚖️ Équilibre Murs";
            txtFluxWallVal.textContent = "0.00 kW";
            txtFluxWallVal.style.color = "#10B981";
            lineWall.setAttribute('d', "M 948 220 L 830 220");
            lineWall.setAttribute('stroke', "#10B981");
            lineWall.setAttribute('class', "flow-laser");
            lineWall.setAttribute('marker-end', "");
            haloWall.setAttribute('d', "M 948 220 L 830 220");
            haloWall.setAttribute('stroke', "#10B981");
        }
    }

    // Couleur d'accent de la structure de la maison
    const archColor = metrics.avgTemp > 24 ? "#F43F5E" : (isNight || extTemp < 8 ? "#38BDF8" : "#F59E0B");
    ['roof-structure', 'wall-tl', 'wall-bl', 'wall-heavy-r', 'floor-heavy'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.setAttribute('stroke', archColor);
    });

    // ============================================================
    // 5. BILAN PROGRESSIF EN 3 TEMPS
    // ============================================================
    const txtKwhPassed = document.getElementById('txt-kwh-passed');
    if (txtKwhPassed) {
        const valPasse = metrics.totalBilanPasseKwh;
        const sign = valPasse > 0 ? '+' : '';
        txtKwhPassed.textContent = `${sign}${valPasse.toFixed(2)} kWh`;
        txtKwhPassed.className = `text-sm sm:text-base font-black ${valPasse >= 0 ? 'text-emerald-400' : 'text-red-400'}`;
    }

    const txtKwFlux = document.getElementById('txt-kw-flux');
    if (txtKwFlux) {
        const valFlux = metrics.totalPuissanceNetteKw;
        const sign = valFlux > 0 ? '+' : '';
        txtKwFlux.textContent = `${sign}${valFlux.toFixed(2)} kW`;
        txtKwFlux.className = `text-sm sm:text-base font-black ${valFlux >= 0 ? 'text-amber-400' : 'text-sky-400'}`;
    }

    const txtKwhFinal = document.getElementById('txt-kwh-final');
    if (txtKwhFinal) {
        const valFinal = metrics.totalBilanNetKwh;
        const sign = valFinal > 0 ? '+' : '';
        txtKwhFinal.textContent = `${sign}${valFinal.toFixed(2)} kWh`;
        txtKwhFinal.className = `text-sm sm:text-base font-black ${valFinal >= 0 ? 'text-white' : 'text-slate-300'}`;
    }

    // ============================================================
    // 6. SYNTHÈSE EN MOTS SIMPLES (Dynamique et humaine)
    // ============================================================
    const txtSummary = document.getElementById('txt-summary');
    if (txtSummary) {
        let synthese = "";
        const tAir = metrics.avgTemp.toFixed(1);
        const tExt = outdoorTemp.toFixed(1);

        if (fluxWallKw > 0.15) {
            synthese = `Dehors il fait ${tExt}°C, et votre intérieur est à ${tAir}°C (${pmvLabel.toLowerCase()}). Vos murs restituent leur chaleur (+${Math.abs(fluxWallKw).toFixed(2)} kW) : vous avez ${globalReserve.autonomyText} d'autonomie sans chauffage.`;
        } else if (fluxWallKw < -0.15) {
            synthese = `Dehors il fait ${tExt}°C, votre intérieur est à ${tAir}°C. Vos parois massives absorbent activement la chaleur (${fluxWallKw.toFixed(2)} kW) pour préserver votre fraîcheur.`;
        } else {
            synthese = `Dehors il fait ${tExt}°C, votre intérieur est à ${tAir}°C au confort stable. Les échanges thermiques entre l'air et les murs sont équilibrés.`;
        }
        txtSummary.textContent = synthese;
    }

    // Horodatage du calcul
    const timeEl = document.getElementById('global-calc-timestamp');
    if (timeEl) {
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        timeEl.textContent = `(Calculé à ${timeStr})`;
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
            
            if (data.current.sunrise && data.current.sunset) {
                const formatTime = (ts) => {
                    const d = new Date(ts * 1000);
                    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                };
                window.solsticeEphemeris = {
                    sunriseStr: formatTime(data.current.sunrise),
                    sunsetStr: formatTime(data.current.sunset),
                    sunriseHour: new Date(data.current.sunrise * 1000).getHours(),
                    sunsetHour: new Date(data.current.sunset * 1000).getHours()
                };
            }

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
            
            if (typeof DONNEES_HABITAT === 'object') {
                DONNEES_HABITAT['__ENV__'] = {
                    outdoorTemp,
                    outdoorHumidity,
                    outdoorWind,
                    sunshineStatus,
                    hourlyExtForecast: window.hourlyExtForecast
                };
                if (window.SolsticeStore && window.SolsticeStore.saveScanData) {
                    window.SolsticeStore.saveScanData(DONNEES_HABITAT);
                }
            }

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
    const inlineEl = document.getElementById('summary-weather-inline');

    if (loading) {
        if (summaryEl) summaryEl.innerHTML = '<span style="color: #94A3B8;">⏳ Chargement météo...</span>';
        if (inlineEl) inlineEl.textContent = '⏳ Chargement...';
        return;
    }
    if (error) {
        if (summaryEl) summaryEl.innerHTML = `<span style="color: #F87171; font-weight: bold;">❌ ${errorMsg || "Météo indisponible"}</span>`;
        if (inlineEl) inlineEl.textContent = '❌ Indisponible';
        return;
    }

    if (inlineEl) {
        inlineEl.innerHTML = `🌡️ ${outdoorTemp.toFixed(1)} °C &nbsp;|&nbsp; 💧 ${outdoorHumidity}% HR &nbsp;|&nbsp; 💨 ${outdoorWind.toFixed(0)} km/h`;
    }

    if (summaryEl) {
        summaryEl.style.color = "#F8FAFC";
        summaryEl.innerHTML = `
            <span style="color: #F8FAFC;">
                🌡️ ${outdoorTemp.toFixed(1)} °C &nbsp;|&nbsp; 💧 ${outdoorHumidity}% HR &nbsp;|&nbsp; 💨 ${outdoorWind.toFixed(0)} km/h (${sunshineStatus})
            </span>
        `;
    }
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
                if (!DONNEES_HABITAT[nomPiece]) DONNEES_HABITAT[nomPiece] = {};
                
                DONNEES_HABITAT[nomPiece].ta = parseFloat(capteur.temperature);
                DONNEES_HABITAT[nomPiece].rh = parseFloat(capteur.humidity);

                updateStructureTemperature(nomPiece, DONNEES_HABITAT[nomPiece].ta);

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

        DONNEES_HABITAT['__ENV__'] = {
            outdoorTemp, outdoorHumidity, outdoorWind, sunshineStatus, hourlyExtForecast: window.hourlyExtForecast
        };
        DONNEES_HABITAT['__BUFFER_TOGGLE__'] = includeBufferZones;

        if (window.SolsticeStore && window.SolsticeStore.saveScanData) {
            window.SolsticeStore.saveScanData(DONNEES_HABITAT);
        }

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
// OBJET SOLSTICE ENGINE — DECLARATION ET METHODES
// ============================================================

window.SolsticeEngine = {
    ENERGY_COSTS: {
        elec_direct: { pricePerKwh: 0.2516, label: "Électricité (Tarif Réglementé)" },
        pac_air_eau: { pricePerKwh: 0.2516 / 3.2, label: "PAC Air/Eau (COP moyen 3,2)" },
        pac_air_air: { pricePerKwh: 0.2516 / 3.0, label: "PAC Air/Air (COP moyen 3,0)" },
        gaz_condens: { pricePerKwh: 0.1180, label: "Gaz Naturel" },
        granules:    { pricePerKwh: 0.0890, label: "Granulés / Pellets" },
        fioul:       { pricePerKwh: 0.1350, label: "Fioul Domestique" }
    },

    PROFILES: {
        short_term: { label: "Court termiste", allowedLevels: [1], pmvThreshold: 0.5, maxDeltaPmv: 0.0 },
        mid_term:   { label: "Moyen termiste", allowedLevels: [1, 2], pmvThreshold: 0.5, maxDeltaPmv: 0.3 },
        long_term:  { label: "Long termiste", allowedLevels: [1, 2, 3], pmvThreshold: 0.5, maxDeltaPmv: 0.6 }
    },

    isOutdoorZone: typeof isOutdoorZone !== 'undefined' ? isOutdoorZone : null,
    isBufferZone: typeof isBufferZone !== 'undefined' ? isBufferZone : null,
    getZoneConfigByName: typeof getZoneConfigByName !== 'undefined' ? getZoneConfigByName : null,
    calculateGlobalHabitatMetrics: typeof calculateGlobalHabitatMetrics !== 'undefined' ? calculateGlobalHabitatMetrics : null,
    calculatePMV: typeof calculatePMV !== 'undefined' ? calculatePMV : null,
    calculateMeanRadiantTemp: typeof calculateMeanRadiantTemp !== 'undefined' ? calculateMeanRadiantTemp : null,
    calculateAirVelocity: typeof calculateAirVelocity !== 'undefined' ? calculateAirVelocity : null,
    getBaseCloAndMet: typeof getBaseCloAndMet !== 'undefined' ? getBaseCloAndMet : null,
    evaluateSimulatedPMV: typeof evaluateSimulatedPMV !== 'undefined' ? evaluateSimulatedPMV : null,
    getBaseCloAndMet: typeof getBaseCloAndMet !== 'undefined' ? getBaseCloAndMet : null,

    evaluateSimulatedPMV(baseState, checkedActionKeys, envData) {
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
    },

    generateRecommendations(zone, zoneId, roomData, envData) {
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
    }
};

document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && window.SolsticeStore) {
        await window.SolsticeStore.init();
        recalculerToutLeDashboard();
    }
});

if (typeof supabaseClient !== 'undefined' && supabaseClient) {
    getConnectedHouseId().then(houseId => {
        supabaseClient
            .channel('solstice_realtime_sync')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'solstice_store',
                filter: `house_id=eq.${houseId}`
            }, payload => {
                if (payload.new && payload.new.donnees_habitat) {
                    DONNEES_HABITAT = payload.new.donnees_habitat;
                    localStorage.setItem('SOLSTICE_DONNEES_HABITAT', JSON.stringify(DONNEES_HABITAT));
                    applySharedEnvironment(DONNEES_HABITAT);
                    recalculerToutLeDashboard();
                }
            })
            .subscribe();
    });
}
