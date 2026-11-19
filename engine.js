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
window.futureHourlyForecast = []; // Chronique prospective des 48h à venir (heure par heure)

// Préchargement synchrone immédiat depuis le cache local (évite tout état transitoire vide)
try {
    const rawCfg = localStorage.getItem('HOUSE_CONFIG');
    if (rawCfg) GLOBAL_HOUSE_CONFIG = JSON.parse(rawCfg);
    const rawScan = localStorage.getItem('SOLSTICE_DONNEES_HABITAT') || sessionStorage.getItem('SOLSTICE_DONNEES_HABITAT');
    if (rawScan) DONNEES_HABITAT = JSON.parse(rawScan);
    if (localStorage.getItem('outdoorTemp')) outdoorTemp = parseFloat(localStorage.getItem('outdoorTemp'));
    if (localStorage.getItem('outdoorHumidity')) outdoorHumidity = parseFloat(localStorage.getItem('outdoorHumidity'));
    if (localStorage.getItem('outdoorWind')) outdoorWind = parseFloat(localStorage.getItem('outdoorWind'));
    if (localStorage.getItem('sunshineStatus')) sunshineStatus = localStorage.getItem('sunshineStatus');
    const rawEnv = localStorage.getItem('SOLSTICE_ENV_DATA');
    if (rawEnv) {
        const pEnv = JSON.parse(rawEnv);
        if (typeof pEnv.t_ext === 'number') outdoorTemp = pEnv.t_ext;
        if (typeof pEnv.rh_ext === 'number') outdoorHumidity = pEnv.rh_ext;
        if (pEnv.sun_status) sunshineStatus = pEnv.sun_status;
    }
} catch (e) {
    console.warn("[Solstice Engine] Pré-chargement synchrone initial:", e);
}

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
        if (env.futureHourlyForecast) window.futureHourlyForecast = env.futureHourlyForecast;
        
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
    if (nomPiece) {
        const low = nomPiece.toLowerCase();
        if (low.includes('extér') || low.includes('exter') || low.includes('jardin') || low.includes('rue') || low.includes('goutti') || low.includes('appui')) {
            return true;
        }
    }
    if (zoneConfig && Array.isArray(zoneConfig.usages) && zoneConfig.usages.includes('outdoor')) {
        return true;
    }
    return false;
}

// ------------------------------------------------------------
// CAPTEURS EXTÉRIEURS IN SITU : JARDIN (OMBREGÉ/AIR) & RUE (ENSOLEILLÉ)
// ------------------------------------------------------------
function getOutdoorGardenSensor() {
    for (const [nom, data] of Object.entries(DONNEES_HABITAT || {})) {
        if (nom === '__ENV__' || nom === '__BUFFER_TOGGLE__') continue;
        const low = nom.toLowerCase();
        if ((low.includes('jardin') || low.includes('gouttiere') || low.includes('gouttière')) && data && typeof data.ta === 'number' && !isNaN(data.ta)) {
            return { name: nom, ta: data.ta, rh: data.rh, data };
        }
    }
    const cfg = GLOBAL_HOUSE_CONFIG.zones || GLOBAL_HOUSE_CONFIG || {};
    for (const [k, z] of Object.entries(cfg)) {
        if (!z) continue;
        const low = ((z.name || '') + ' ' + (z.id || '') + ' ' + (z.sensorName || '')).toLowerCase();
        if (low.includes('jardin') || low.includes('gouttiere') || low.includes('gouttière')) {
            const roomName = z.name || z.nom || k;
            const data = DONNEES_HABITAT[roomName];
            if (data && typeof data.ta === 'number' && !isNaN(data.ta)) {
                return { name: roomName, ta: data.ta, rh: data.rh, data };
            }
        }
    }
    for (const [nom, data] of Object.entries(DONNEES_HABITAT || {})) {
        if (nom === '__ENV__' || nom === '__BUFFER_TOGGLE__') continue;
        const low = nom.toLowerCase();
        if ((low.includes('extér') || low.includes('exter')) && !low.includes('rue') && !low.includes('appui') && data && typeof data.ta === 'number' && !isNaN(data.ta)) {
            return { name: nom, ta: data.ta, rh: data.rh, data };
        }
    }
    return null;
}

function getOutdoorStreetSensor() {
    for (const [nom, data] of Object.entries(DONNEES_HABITAT || {})) {
        if (nom === '__ENV__' || nom === '__BUFFER_TOGGLE__') continue;
        const low = nom.toLowerCase();
        if ((low.includes('rue') || low.includes('appui') || low.includes('fenetre rue') || low.includes('fenêtre rue')) && data && typeof data.ta === 'number' && !isNaN(data.ta)) {
            return { name: nom, ta: data.ta, rh: data.rh, data };
        }
    }
    const cfg = GLOBAL_HOUSE_CONFIG.zones || GLOBAL_HOUSE_CONFIG || {};
    for (const [k, z] of Object.entries(cfg)) {
        if (!z) continue;
        const low = ((z.name || '') + ' ' + (z.id || '') + ' ' + (z.sensorName || '')).toLowerCase();
        if (low.includes('rue') || low.includes('appui') || low.includes('fenetre rue') || low.includes('fenêtre rue')) {
            const roomName = z.name || z.nom || k;
            const data = DONNEES_HABITAT[roomName];
            if (data && typeof data.ta === 'number' && !isNaN(data.ta)) {
                return { name: roomName, ta: data.ta, rh: data.rh, data };
            }
        }
    }
    return null;
}

function getEffectiveOutdoorAir() {
    const garden = getOutdoorGardenSensor();
    const street = getOutdoorStreetSensor();

    const tAir = (garden && typeof garden.ta === 'number') ? garden.ta : outdoorTemp;
    const rhAir = (garden && typeof garden.rh === 'number') ? garden.rh : outdoorHumidity;
    const ahAir = calculateAbsoluteHumidity(tAir, rhAir);

    const deltaSun = (street && garden) ? parseFloat((street.ta - garden.ta).toFixed(1)) : 0;
    
    // Qualification physique de l'éclairage selon l'écart Rue - Jardin :
    // - Faible (< 2.0 °C) : Ciel couvert / nuages denses / nuit
    // - Modéré (2.0 à 3.9 °C) : Éclairage diffus / ciel voilé / soleil rasant
    // - Fort (>= 4.0 °C) : Soleil direct franc non ambigu
    let sunNature = 'couvert';
    let sunFactor = 0.15;
    if (deltaSun >= 4.0) {
        sunNature = 'direct';
        sunFactor = 1.0;
    } else if (deltaSun >= 2.0) {
        sunNature = 'diffus';
        sunFactor = 0.45;
    } else {
        const isSunnyApi = (sunshineStatus || '').toLowerCase().includes('clear') || (sunshineStatus || '').toLowerCase().includes('sun');
        if (isSunnyApi) {
            sunNature = 'diffus';
            sunFactor = 0.40;
        }
    }

    const hasDirectSun = sunNature === 'direct';
    const hasDiffuseSun = sunNature === 'diffus' || sunNature === 'direct';

    return {
        tAir,
        rhAir,
        ahAir,
        gardenSensor: garden,
        streetSensor: street,
        deltaSun,
        sunNature,
        sunFactor,
        hasDirectSun,
        hasDiffuseSun,
        source: garden ? 'in_situ' : 'api'
    };
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
    const cachedFuture = localStorage.getItem('SOLSTICE_FUTURE_FORECAST');
    if (cachedFuture) {
        try { window.futureHourlyForecast = JSON.parse(cachedFuture); } catch(e) {}
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
                <td data-label="Pièce" style="padding: 12px 14px; font-weight: 700; color: #0F172A;">${nomPiece}</td>
                <td data-label="Statut" style="padding: 12px 10px; text-align: center;"><span id="status-${idCapteur}" style="background: #F1F5F9; color: #64748B; font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; font-weight: 600;">En attente</span></td>
                <td data-label="Température" style="padding: 12px 10px; text-align: right; font-weight: 700; color: #0F172A;" id="temp-${idCapteur}">-- °C</td>
                <td data-label="Humidité Rel." style="padding: 12px 10px; text-align: right; font-weight: 600; color: #334155;" id="hum-${idCapteur}">-- %</td>
                <td data-label="Humidité Abs." style="padding: 12px 10px; text-align: right; font-weight: 600; color: #0284C7;" id="ah-${idCapteur}">-- g/m³</td>
                <td data-label="PMV (Confort)" style="padding: 12px 10px; text-align: center;"><span id="pmv-badge-${idCapteur}" style="font-weight: 700; padding: 4px 8px; border-radius: 6px; font-size: 0.82rem;">--</span></td>
                <td data-label="Bilan Net (24h)" style="padding: 12px 10px; text-align: right; font-weight: 600;" id="energy-${idCapteur}">-- kWh/j</td>
                <td data-label="T° Parois" style="padding: 12px 10px; text-align: right; font-weight: 600; color: #D97706;" id="tstruct-${idCapteur}">-- °C</td>
                <td data-label="Séchage Linge" style="padding: 12px 10px; text-align: center; font-weight: 600;" id="drying-${idCapteur}">--</td>
                <td data-label="Action" style="padding: 10px 12px; text-align: center;" id="action-${idCapteur}">
                    <button onclick="voirRecommandations('${safeName}')" style="background: #F1F5F9; border: 1px solid #CBD5E1; border-radius: 6px; padding: 5px 12px; font-size: 0.8rem; font-weight: 700; cursor: pointer; color: #0F172A;">🔍 Diag</button>
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

    const tStruct = isOutdoor ? ta : updateStructureTemperature(nomPiece, ta);
    const vel = calculateAirVelocity(zoneConfig, nomPiece);
    const tr = calculateMeanRadiantTemp(zoneConfig, ta, tStruct);
    const { met, totalClo } = getBaseCloAndMet(zoneConfig);

    if (colIndex === 5) return isOutdoor ? -999 : calculatePMV(ta, tr, vel, rh, met, totalClo);
    if (colIndex === 6) return isOutdoor ? -999 : calculateDailyThermalBalance(zoneConfig, ta, tStruct).bilanNetkWh;
    if (colIndex === 7) return isOutdoor ? -999 : tStruct;
    if (colIndex === 8) {
        const effectiveVel = isOutdoor ? ((outdoorWind || 0) / 3.6) : vel;
        return parseFloat(calculateDryingPotential(ta, rh, effectiveVel, { isOutdoor }).score10);
    }

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

function getUValueParoi(typeParoi, materiau, isolation, epaisseurCm = 20, customU = null) {
    if (typeParoi === 'wall' && customU !== null && customU !== undefined && customU !== '' && !isNaN(parseFloat(customU)) && parseFloat(customU) > 0) {
        return parseFloat(customU);
    }
    const mapInsulationR = { 'ite_heavy': 4.2, 'ite_recent': 3.8, 'iti_recent': 3.2, 'ite_old': 1.8, 'iti_old': 1.4, 'low': 0.6, 'none': 0.0 };
    const mapLambda = { 'cinderblock': 1.3, 'brick': 0.45, 'concrete': 1.7, 'stone': 2.3, 'wood': 0.13, 'leger': 0.15, 'lourd': 1.8 };

    const rIns = mapInsulationR[isolation] ?? 2.0;
    const lambda = mapLambda[materiau] ?? 1.0;
    const epaisseurMetre = (epaisseurCm && !isNaN(parseFloat(epaisseurCm)) && parseFloat(epaisseurCm) > 0)
        ? (parseFloat(epaisseurCm) / 100)
        : 0.20;

    let rSurface = 0.17;
    if (typeParoi === 'ceiling') rSurface = 0.14;
    if (typeParoi === 'floor') rSurface = 0.21;

    return 1 / (rSurface + (epaisseurMetre / lambda) + rIns);
}

function getDailyOutdoorTemp() {
    if (Array.isArray(window.hourlyExtForecast) && window.hourlyExtForecast.length > 0) {
        const sumTemp = window.hourlyExtForecast.reduce((acc, slot) => acc + slot.temp, 0);
        return sumTemp / window.hourlyExtForecast.length;
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

function calculateMeanRadiantTemp(zone, t_air, t_masse_opt = null) {
    if (!zone) return t_air;

    const area = parseFloat(zone.area) || 16;
    const h = parseFloat(zone.height) || 2.5;
    const side = Math.sqrt(area);
    const wallArea = side * h; 
    const floorArea = area;

    const uWall = getUValueParoi('wall', zone.wallMat, zone.insulation, zone.wallThick, zone.uWall);
    const uCeiling = getUValueParoi('ceiling', zone.ceilingMat, zone.ceilingInsulation);
    const uFloor = getUValueParoi('floor', zone.floorMat, zone.floorInsulation);

    const hi = 7.7; 
    const effOutdoor = (typeof getEffectiveOutdoorAir === 'function') ? getEffectiveOutdoorAir() : { tAir: outdoorTemp, hasDiffuseSun: false, sunFactor: 0 };
    const tExtNow = effOutdoor.tAir ?? outdoorTemp;

    // Récupération de la température dynamique du nœud Masse (Tm) du modèle 2R2C si disponible
    let tMasse = t_masse_opt;
    if ((tMasse === null || tMasse === undefined || isNaN(tMasse)) && zone.name && DONNEES_HABITAT[zone.name]?.tStruct !== undefined) {
        tMasse = DONNEES_HABITAT[zone.name].tStruct;
    }

    function getStaticSurfaceTemp(adjRaw, U) {
        const adj = extractAdjacency(adjRaw);
        if (adj === 'heated') return t_air;
        let tExtEquivalent = tExtNow;
        if (adj === 'unheated') tExtEquivalent = (t_air + tExtNow) / 2;
        if (adj === 'ground') tExtEquivalent = 12.0; 
        return t_air - (U / hi) * (t_air - tExtEquivalent);
    }

    let totalArea = 0;
    let sumOpaqueArea = 0;
    let sumStaticOpaqueTempArea = 0;

    const wallsAdj = [zone.adj?.wall1, zone.adj?.wall2, zone.adj?.wall3, zone.adj?.wall4];
    wallsAdj.forEach(adj => {
        const tSurf = getStaticSurfaceTemp(adj, uWall);
        sumStaticOpaqueTempArea += (tSurf * wallArea);
        sumOpaqueArea += wallArea;
        totalArea += wallArea;
    });

    sumStaticOpaqueTempArea += (getStaticSurfaceTemp(zone.adj?.ceiling, uCeiling) * floorArea);
    sumStaticOpaqueTempArea += (getStaticSurfaceTemp(zone.adj?.floor, uFloor) * floorArea);
    sumOpaqueArea += (floorArea * 2);
    totalArea += (floorArea * 2);

    let totalWindowArea = 0;
    let sumWindowTempArea = 0;

    if (Array.isArray(zone.windows) && zone.windows.length > 0) {
        const isSunny = effOutdoor.hasDiffuseSun || (sunshineStatus || '').toLowerCase().includes('clear') || (sunshineStatus || '').toLowerCase().includes('sun');
        const sunMod = (effOutdoor.sunFactor !== undefined && effOutdoor.sunFactor > 0) ? effOutdoor.sunFactor : (isSunny ? 0.65 : 0);

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
            // Le vitrage n'a aucune inertie : sa surface intérieure réagit instantanément à (T_air - T_ext) et au rayonnement solaire
            let tWin = getStaticSurfaceTemp('outside', spec.U);
            const maskFactor = { 'none': 1.0, 'partial': 0.5, 'heavy': 0.1 }[win.mask] ?? 1.0;
            const shutterFactor = {
                'aucun': 1.0, 'store_banne': 0.25, 'store_interieur': 0.75, 'rideau_interieur': 0.80,
                'roulant_pvc': 0.10, 'roulant_metal': 0.15, 'battant_bois': 0.10, 'persienne': 0.30
            }[win.shutter] ?? 1.0;

            if (isSunny && maskFactor > 0.1 && sunMod > 0) {
                const orientArr = Array.isArray(win.orient) ? win.orient : [win.orient || 'S'];
                const orientFactors = { 'S': 3.2, 'SE': 2.5, 'SW': 2.5, 'E': 1.8, 'W': 1.8, 'N': 0.6 };
                let sumOrientFactor = 0;
                orientArr.forEach(o => { sumOrientFactor += (orientFactors[o] || 1.5); });
                const orientFactor = orientArr.length > 0 ? (sumOrientFactor / orientArr.length) : 1.5;
                const tiltFactor = { 'verticale': 1.0, 'inclinee': 1.3, 'horizontale': 1.5 }[win.tilt] ?? 1.0;
                tWin += (spec.g * orientFactor * tiltFactor * maskFactor * shutterFactor * 5.0 * sunMod);
            }

            totalWindowArea += wArea;
            sumWindowTempArea += (tWin * wArea);
            sumStaticOpaqueTempArea -= (getStaticSurfaceTemp('outside', uWall) * wArea);
            sumOpaqueArea -= wArea;
        });
    }

    const netOpaqueArea = Math.max(1.0, sumOpaqueArea);
    // Si le nœud Masse dynamique 2R2C (tMasse) est connu, les parois opaques (murs, dalle, plafond) rayonnent à tMasse
    const effectiveOpaqueTemp = (tMasse !== null && tMasse !== undefined && !isNaN(tMasse))
        ? tMasse
        : (sumStaticOpaqueTempArea / netOpaqueArea);

    const totalRadiantArea = netOpaqueArea + totalWindowArea;
    return ((effectiveOpaqueTemp * netOpaqueArea) + sumWindowTempArea) / Math.max(1.0, totalRadiantArea);
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

function calculateDryingPotential(ta, rh, vel = 0.1, options = {}) {
    if (ta === undefined || rh === undefined || isNaN(ta) || isNaN(rh)) {
        return { vpdkPa: 0, dryingIndex: 0, scorePercent: 0, score10: "0.0", status: "Inconnu", color: "#94A3B8" };
    }

    const pSat = 611.2 * Math.exp((17.67 * ta) / (ta + 243.5)); 
    const vpd = (pSat * (1 - rh / 100)) / 1000; 

    // Le vent accélère l'évaporation uniquement si l'air n'est pas saturé d'humidité (plafonné à 4 m/s ~ 15 km/h d'effet utile)
    const effectiveVel = Math.min(4.0, Math.max(0.05, vel));
    const drynessWindEfficiency = Math.max(0.15, Math.min(1.0, (90 - rh) / 40));
    let dryingIndex = vpd * (1 + 0.45 * effectiveVel * drynessWindEfficiency);

    let timeNote = "";
    if (options && options.isOutdoor) {
        const nowH = new Date().getHours();
        const sunriseH = window.solsticeEphemeris?.sunriseHour || 7;
        const sunsetH = window.solsticeEphemeris?.sunsetHour || 19;
        const isNightNow = (nowH >= sunsetH || nowH < sunriseH);
        const isDuskFalling = (!isNightNow && nowH >= (sunsetH - 2));
        const weatherStr = (typeof sunshineStatus === 'string' ? sunshineStatus : '').toLowerCase();
        const isWetWeather = weatherStr.includes('rain') || weatherStr.includes('drizzle') || weatherStr.includes('snow') || weatherStr.includes('fog') || weatherStr.includes('mist');

        if (isWetWeather) {
            dryingIndex = 0;
            timeNote = " (Pluie/Humidité)";
        } else if (isNightNow) {
            // La nuit : absence d'apport solaire + refroidissement radiatif du linge vers le ciel froid + rosée nocturne
            dryingIndex *= 0.18;
            timeNote = " (Nuit / Rosée)";
        } else if (isDuskFalling) {
            // Fin d'après-midi (< 2h avant le coucher du soleil) : chute thermique et remontée d'HR imminentes
            dryingIndex *= 0.42;
            timeNote = " (Nuit imminente)";
        }

        // Pénalité supplémentaire si humidité relative extérieure élevée (>= 80% : proximité du point de rosée sur textile froid)
        if (rh >= 80) {
            dryingIndex *= Math.max(0.15, (95 - rh) / 20);
        }
    }

    const scorePercent = Math.min(100, Math.max(0, Math.round((dryingIndex / 1.8) * 100)));
    const score10 = (scorePercent / 10).toFixed(1);

    let status = "Très Lent" + timeNote;
    let color = "#EF4444"; 

    if (scorePercent >= 80) { status = "Ultra Rapide" + timeNote; color = "#059669"; }
    else if (scorePercent >= 60) { status = "Rapide" + timeNote; color = "#10B981"; }
    else if (scorePercent >= 40) { status = "Modéré" + timeNote; color = "#F59E0B"; }
    else if (scorePercent >= 20) { status = "Lent" + timeNote; color = "#F97316"; }

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
// AÉRATION DIFFÉRENTIELLE & GESTION INTELLIGENTE DE L'HUMIDITÉ
// (Magnus-Tetens, ISO 7730 & Préservation de l'Inertie)
// ============================================================

function hasOpenableWindows(zoneConfig) {
    if (!zoneConfig || !Array.isArray(zoneConfig.windows) || zoneConfig.windows.length === 0) return false;
    return zoneConfig.windows.some(w => {
        if (!w || !w.vent) return false;
        const v = String(w.vent).toLowerCase().trim();
        return v === 'total' || v === 'battante' || v === 'partial' || v === 'oscillo_battante' || v === 'oscillante' || v === 'coulissante';
    });
}

function calculateDifferentialVentilation(zoneConfig, roomData, envData) {
    const ta = (roomData && roomData.ta !== undefined) ? roomData.ta : 20;
    const rh = (roomData && roomData.rh !== undefined) ? roomData.rh : 50;

    const effOutdoor = getEffectiveOutdoorAir();
    const tExt = (envData && typeof envData.t_ext === 'number') ? envData.t_ext : effOutdoor.tAir;
    const rhExt = (envData && typeof envData.rh_ext === 'number') ? envData.rh_ext : effOutdoor.rhAir;

    const ahInt = calculateAbsoluteHumidity(ta, rh);
    const ahExt = calculateAbsoluteHumidity(tExt, rhExt);
    const deltaAh = parseFloat((ahInt - ahExt).toFixed(2)); // > 0 = ext plus sec (asséchant)

    const area = parseFloat(zoneConfig?.area) || 15;
    const height = parseFloat(zoneConfig?.height) || 2.5;
    const volume = area * height;

    // Masse d'eau potentiellement extraite par 1 renouvellement d'air complet
    const waterMassGrams = Math.max(0, Math.round(deltaAh * volume));
    const nbVerres = Math.max(1, Math.round(waterMassGrams / 150)); // 1 verre ≈ 150 ml
    const verresTxt = `~${nbVerres} verre${nbVerres > 1 ? 's' : ''} d'eau`;

    const isWetRoom = Array.isArray(zoneConfig?.usages) && (zoneConfig.usages.includes('kitchen') || zoneConfig.usages.includes('bath'));
    const winType = zoneConfig?.windows?.find(w => w.vent && w.vent !== 'fixe' && w.vent !== 'fixed')?.vent || 'battante';
    const isOscillo = (winType === 'oscillante' || winType === 'oscillo_battante' || winType === 'partial');
    const optimalDurationMin = isOscillo ? 12 : 6;
    const canOpenWin = hasOpenableWindows(zoneConfig);
    const hasVmc = zoneConfig?.equipment?.vmcSystem === 'marche_forcee' || zoneConfig?.equipment?.vmcSystem === 'trappe';

    let status = 'comfort'; // 'urgent_dry', 'recommended_dry', 'blocked_humid', 'comfort', 'dry_air'
    let canVentilate = false;
    let title = "Hygrométrie saine";
    let detail = `Humidité saine (${rh}%). Pas d'action corrective requise.`;

    // 1. Humidité très élevée (> 68 %)
    if (rh > 68) {
        if (deltaAh >= 0.4 && ahExt < ahInt) {
            status = 'urgent_dry';
            canVentilate = true;
            if (canOpenWin) {
                title = `Aération flash requise (${verresTxt})`;
                detail = `Humidité très élevée (${rh}%). Ouvrez en grand ${optimalDurationMin} min : évacuez ${verresTxt} sans refroidir vos parois.`;
            } else if (hasVmc) {
                title = `Boost VMC anti-humidité requis`;
                detail = `Humidité très élevée (${rh}%). Enclenchez la VMC en vitesse rapide pour extraire la vapeur d'eau (pièce sans fenêtre ouvrable).`;
            } else {
                canVentilate = false;
                status = 'comfort';
                title = `Hygrométrie élevée (Sans ouvrant ni VMC)`;
                detail = `Humidité élevée (${rh}%), aucun équipement d'extraction direct configuré dans cette pièce.`;
            }
        } else if (ahExt >= ahInt) {
            status = 'blocked_humid';
            canVentilate = false;
            title = "🛡️ Air extérieur saturé";
            detail = `L'air extérieur est plus humide (${ahExt.toFixed(1)} g/m³ ≥ ${ahInt.toFixed(1)} g/m³). Ne pas ouvrir : risque d'imprégner vos parois massives.`;
        } else {
            status = 'comfort';
            canVentilate = false;
            title = "Potentiel d'assèchement insuffisant";
            detail = `Humidité ${rh}%, mais l'air extérieur n'est pas assez sec (écart < 0.4 g/m³) pour évacuer efficacement la vapeur d'eau.`;
        }
    } 
    // 2. Humidité au-delà de la zone de confort (> 60 %)
    else if (rh > 60) {
        if (deltaAh >= 0.4 && ahExt < ahInt) {
            status = 'recommended_dry';
            canVentilate = true;
            if (canOpenWin) {
                title = `Aération flash conseillée (${verresTxt})`;
                detail = `Ouvrez en grand ${optimalDurationMin} min pour renouveler l'air et chasser ${verresTxt} sans impacter la masse des murs.`;
            } else if (hasVmc) {
                title = `Boost VMC conseillé`;
                detail = `Humidité élevée (${rh}%). Activez la vitesse rapide de la VMC pour assainir l'air (pièce sans fenêtre ouvrable).`;
            } else {
                canVentilate = false;
                status = 'comfort';
                title = `Hygrométrie modérément élevée`;
                detail = `Humidité à ${rh}% (aucun ouvrant direct ni VMC pilotable configuré dans cette pièce).`;
            }
        } else if (ahExt >= ahInt) {
            status = 'blocked_humid';
            canVentilate = false;
            title = "🛡️ Air extérieur saturé";
            detail = `L'air extérieur est plus humide (${ahExt.toFixed(1)} g/m³ ≥ ${ahInt.toFixed(1)} g/m³). Maintenez les ouvertures fermées.`;
        } else {
            status = 'comfort';
            canVentilate = false;
            title = "Potentiel d'assèchement trop faible";
            detail = `Humidité ${rh}%, mais l'air extérieur n'est que très légèrement plus sec (écart < 0.4 g/m³). Inutile d'ouvrir en grand.`;
        }
    } 
    // 3. Air sec (< 38 %)
    else if (rh < 38) {
        status = 'dry_air';
        title = "Air intérieur sec";
        detail = `Humidité basse (${rh}%). Aérer brièvement pour l'oxygène uniquement.`;
    }

    return {
        ahInt,
        ahExt,
        deltaAh,
        volume,
        waterMassGrams,
        nbVerres,
        verresTxt,
        glassesOfWater: nbVerres,
        optimalDurationMin,
        status,
        canVentilate,
        title,
        detail
    };
}

// ============================================================
// NUDGE D'ACTION COMPORTEMENTALE INSTANTANÉ (Pour Tableau & Tuile)
// ============================================================

function getRoomActionNudge(nomPiece, zoneConfig, roomData, envData) {
    const isOutdoor = isOutdoorZone(nomPiece, zoneConfig);
    if (isOutdoor) {
        return {
            actionKey: 'outdoor',
            badgeText: 'Extérieur',
            tooltip: "Zone extérieure de référence",
            html: `<span style="color: #94A3B8; font-size: 0.75rem; font-weight: 500;">Extérieur</span>`
        };
    }

    const safeName = nomPiece.replace(/'/g, "\\'");
    const vent = calculateDifferentialVentilation(zoneConfig, roomData, envData);
    const ta = (roomData && roomData.ta !== undefined) ? roomData.ta : 20;
    const rh = (roomData && roomData.rh !== undefined) ? roomData.rh : 50;

    const vel = calculateAirVelocity(zoneConfig, nomPiece);
    const tr = calculateMeanRadiantTemp(zoneConfig, ta);
    const { met, totalClo } = getBaseCloAndMet(zoneConfig);
    const pmv = calculatePMV(ta, tr, vel, rh, met, totalClo);

    const isSunny = (envData?.sun_status || sunshineStatus || '').toLowerCase().includes('clear') || (envData?.sun_status || sunshineStatus || '').toLowerCase().includes('sun');
    const now = new Date();
    const currentH = now.getHours();
    const sunriseH = window.solsticeEphemeris?.sunriseHour || 7;
    const sunsetH = window.solsticeEphemeris?.sunsetHour || 19;
    const isNight = currentH < sunriseH || currentH >= sunsetH;
    const hasShutters = !zoneConfig?.windows || zoneConfig.windows.length === 0 || zoneConfig.windows.some(w => !w.shutter || w.shutter !== 'aucun');
    const canOpenWin = hasOpenableWindows(zoneConfig);
    const hasVmcSys = zoneConfig?.equipment?.vmcSystem === 'marche_forcee' || zoneConfig?.equipment?.vmcSystem === 'trappe';

    let badgeIcon = "✨";
    let badgeLabel = "Rien à faire";
    let badgeStyle = "background: #F1F5F9; border: 1px solid #CBD5E1; color: #334155;";
    let tooltip = vent.detail || "Conditions thermiques et hygrométriques satisfaisantes. Aucun geste requis.";
    let actionKey = 'comfort';

    // Règle 1 : Humidité & Aération flash prioritaire (avec test ouvrant expert)
    if (vent.status === 'urgent_dry' || vent.status === 'recommended_dry') {
        if (canOpenWin) {
            badgeIcon = "🪟";
            badgeLabel = `Aérer ${vent.optimalDurationMin} min`;
            badgeStyle = "background: #ECFDF5; border: 1px solid #6EE7B7; color: #065F46; font-weight: 700;";
            tooltip = `💧 Évacuer ${vent.verresTxt} sans refroidir vos parois.`;
            actionKey = 'open_win_humidity';
        } else if (hasVmcSys) {
            badgeIcon = "🌀";
            badgeLabel = "Boost VMC";
            badgeStyle = "background: #ECFDF5; border: 1px solid #6EE7B7; color: #065F46; font-weight: 700;";
            tooltip = `💧 Extraire l'humidité via la VMC (pièce sans fenêtre ouvrable).`;
            actionKey = 'vmc_boost';
        }
    } 
    // Règle 2 : Air extérieur saturé (fenêtres réputées fermées de base)
    else if (vent.status === 'blocked_humid') {
        if (hasVmcSys && rh > 60) {
            badgeIcon = "🌀";
            badgeLabel = "Boost VMC";
            badgeStyle = "background: #ECFDF5; border: 1px solid #6EE7B7; color: #065F46; font-weight: 700;";
            tooltip = `⚠️ Air extérieur trop humide (${vent.ahExt} g/m³ ≥ ${vent.ahInt} g/m³). La VMC extrait l'humidité sans ouvrir vers l'extérieur.`;
            actionKey = 'vmc_boost';
        } else {
            // Fenêtres fermées de base : ambiance protégée, aucun geste requis
            badgeIcon = "✨";
            badgeLabel = "Rien à faire";
            badgeStyle = "background: #F8FAFC; border: 1px solid #E2E8F0; color: #64748B; font-weight: 600;";
            tooltip = `Air extérieur saturé (${vent.ahExt} g/m³ ≥ ${vent.ahInt} g/m³). Fenêtres fermées : aucun geste requis.`;
            actionKey = 'comfort';
        }
    }
    // Règle 3 : Surchauffe avec ensoleillement direct (Bouclier solaire)
    else if (pmv > 0.4 && isSunny && hasShutters) {
        badgeIcon = "🛡️";
        badgeLabel = "Baisser volets";
        badgeStyle = "background: #FEF3C7; border: 1px solid #F59E0B; color: #B45309; font-weight: 700;";
        tooltip = "☀️ Bloquer le rayonnement direct avant le vitrage pour stopper la surchauffe.";
        actionKey = 'shutter_close';
    }
    // Règle 4 : Surchauffe avec fraîcheur extérieure (Free cooling - nécessite fenêtres ouvrables)
    else if (pmv > 0.4 && (envData?.t_ext ?? outdoorTemp) < ta - 1.5 && canOpenWin) {
        badgeIcon = "💨";
        badgeLabel = "Surventiler";
        badgeStyle = "background: #E0F2FE; border: 1px solid #38BDF8; color: #0369A1; font-weight: 700;";
        tooltip = `❄️ L'air extérieur est plus frais (${(envData?.t_ext ?? outdoorTemp).toFixed(1)}°C). Décharger l'air chaud en créant un courant d'air.`;
        actionKey = 'free_cooling';
    }
    // Règle 5 : Fraîcheur avec ensoleillement (Apport solaire gratuit)
    else if (pmv < -0.4 && isSunny) {
        badgeIcon = "☀️";
        badgeLabel = "Apport solaire";
        badgeStyle = "background: #FEF9C3; border: 1px solid #FACC15; color: #854D0E; font-weight: 700;";
        tooltip = "🔥 Ouvrir les protections pour laisser le soleil chauffer gratuitement les masses intérieures.";
        actionKey = 'sun_heat';
    }
    // Règle 6 : Fraîcheur nocturne en hiver (Bouclier isolant nocturne)
    else if (pmv < -0.4 && isNight && hasShutters) {
        badgeIcon = "🌙";
        badgeLabel = "Volets fermés";
        badgeStyle = "background: #EEF2FF; border: 1px solid #A5B4FC; color: #3730A3; font-weight: 700;";
        tooltip = "🛡️ Fermer volets et rideaux dès la tombée du jour pour créer une lame d'air isolante protectrice.";
        actionKey = 'shutter_close';
    }

    // Vérifier si l'action prioritaire a déjà été réalisée aujourd'hui dans le plan d'action
    try {
        const rawLifecycle = localStorage.getItem('SOLSTICE_RECO_LIFECYCLE');
        if (rawLifecycle && actionKey !== 'comfort') {
            const lState = JSON.parse(rawLifecycle);
            const todayStr = new Date().toISOString().slice(0, 10);
            if (lState.lastDate === todayStr && lState.recos) {
                const zoneKey = Object.keys(GLOBAL_HOUSE_CONFIG || {}).find(k => GLOBAL_HOUSE_CONFIG[k]?.name === nomPiece) 
                             || nomPiece.toLowerCase().replace(/[^a-z0-9]/g, '_');
                
                const isDone = Object.values(lState.recos).some(item => {
                    if (item.status !== 'completed') return false;
                    const iId = (item.id || '').toLowerCase();
                    const matchesZone = iId.startsWith(zoneKey.toLowerCase() + '_') || iId.startsWith(nomPiece.toLowerCase() + '_');
                    if (!matchesZone) return false;
                    if (actionKey === 'open_win_humidity' && (iId.includes('open_win') || iId.includes('humidity'))) return true;
                    if (actionKey === 'open_door_humidity' && (iId.includes('door') || iId.includes('open_door'))) return true;
                    if (actionKey === 'vmc_boost' && iId.includes('vmc_boost')) return true;
                    if (actionKey === 'shutter_close' && (iId.includes('shutter') || iId.includes('shield'))) return true;
                    if (actionKey === 'free_cooling' && iId.includes('cooling')) return true;
                    if (actionKey === 'sun_heat' && iId.includes('sun_heat')) return true;
                    return false;
                });

                const hasPendingOccurrence = Object.values(lState.recos).some(item => {
                    if (item.status !== 'active') return false;
                    const iId = (item.id || '').toLowerCase();
                    const matchesZone = iId.startsWith(zoneKey.toLowerCase() + '_') || iId.startsWith(nomPiece.toLowerCase() + '_');
                    if (!matchesZone) return false;
                    if (actionKey === 'open_win_humidity' && (iId.includes('open_win') || iId.includes('humidity'))) return true;
                    if (actionKey === 'open_door_humidity' && (iId.includes('door') || iId.includes('open_door'))) return true;
                    if (actionKey === 'vmc_boost' && iId.includes('vmc_boost')) return true;
                    if (actionKey === 'shutter_close' && (iId.includes('shutter') || iId.includes('shield'))) return true;
                    if (actionKey === 'free_cooling' && iId.includes('cooling')) return true;
                    if (actionKey === 'sun_heat' && iId.includes('sun_heat')) return true;
                    return false;
                });

                if (isDone && !hasPendingOccurrence) {
                    badgeIcon = "✅";
                    badgeLabel = "Fait";
                    badgeStyle = "background: #F0FDF4; border: 1px solid #86EFAC; color: #166534; font-weight: 700;";
                    tooltip = `✅ Action recommandée déjà effectuée aujourd'hui dans cette pièce. Confort préservé !`;
                }
            }
        }
    } catch (e) {}

    const html = `<button onclick="voirRecommandations('${safeName}')" title="${tooltip}" style="${badgeStyle} padding: 4px 10px; border-radius: 6px; font-size: 0.78rem; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; box-shadow: 0 1px 2px rgba(0,0,0,0.05); transition: transform 0.15s ease;" onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'"><span>${badgeIcon}</span><span>${badgeLabel}</span></button>`;

    return {
        actionKey,
        badgeIcon,
        badgeLabel,
        tooltip,
        html
    };
}

// ============================================================
// SCORE DE MAÎTRISE DU CONFORT DE L'HABITAT (SUR 100)
// Confort PMV (40 pts max) + Résilience/Autonomie (30 pts max) + Gestes (30 pts max)
// ============================================================

function calculateHabitatAccordageScore(metrics, completedRatio = 0.0) {
    if (!metrics) {
        metrics = { avgPMV: 0, avgRH: 50, avgTau: 20, totalBilanNetKwh: 0 };
    }

    // 1. Confort hygrothermique (40 pts max)
    const pmvDev = Math.abs(metrics.avgPMV || 0);
    let pmvPts = 25;
    if (pmvDev <= 0.2) pmvPts = 25;
    else if (pmvDev <= 0.5) pmvPts = 20;
    else if (pmvDev <= 0.8) pmvPts = 12;
    else pmvPts = 5;

    const avgRh = metrics.avgRH || 50;
    let rhPts = 15;
    if (avgRh >= 45 && avgRh <= 60) rhPts = 15;
    else if (avgRh >= 40 && avgRh <= 65) rhPts = 10;
    else rhPts = 4;

    const hygrothermalPts = pmvPts + rhPts; // max 40

    // 2. Résilience thermique & Autonomie (30 pts max)
    let resiliencePts = 20;
    const bilanKwh = metrics.totalBilanNetKwh || 0;
    if (bilanKwh >= 0) {
        resiliencePts = 30; // Positif ou autosuffisant
    } else {
        const tau = metrics.avgTau || 20;
        if (tau >= 24) resiliencePts = 25;
        else if (tau >= 15) resiliencePts = 20;
        else resiliencePts = 12;
    }

    const baseScore = hygrothermalPts + resiliencePts; // Max 70 pts

    // 3. Comportement & Prise en main (30 pts max - 100% réversible)
    const validRatio = (completedRatio !== undefined && !isNaN(completedRatio)) ? Math.max(0, Math.min(1, completedRatio)) : 0.0;
    const behaviorPts = Math.round(validRatio * 30);

    const totalScore = Math.min(100, Math.max(0, baseScore + behaviorPts));

    let badge = "Maîtrise Optimale";
    let color = "#10B981";
    if (totalScore >= 85) {
        badge = "Maîtrise Optimale";
        color = "#10B981";
    } else if (totalScore >= 70) {
        badge = "Confort Bien Préservé";
        color = "#06B6D4";
    } else if (totalScore >= 50) {
        badge = "Actions Recommandées";
        color = "#F59E0B";
    } else {
        badge = "Inconfort à Corriger";
        color = "#EF4444";
    }

    return {
        score: totalScore,
        baseScore,
        hygrothermalPts,
        resiliencePts,
        behaviorPts,
        badge,
        color
    };
}

const calculateHabitatHarmonyScore = calculateHabitatAccordageScore;

// ============================================================
// MODÉLISATION DYNAMIQUE 2R2C (NŒUD AIR Ta & NŒUD MASSE Tm)
// Conforme EN ISO 52016-1 : Séparation Flux Rapides / Masse Tampon
// ============================================================

function calculatePassiveInternalGainsW(zoneConfig, hour = new Date().getHours(), dayOfWeek = new Date().getDay()) {
    if (!zoneConfig || isOutdoorZone(zoneConfig.name || '', zoneConfig) || isBufferZone(zoneConfig.name || '', zoneConfig)) {
        return { totalW: 0, convectiveAirW: 0, radiativeMassW: 0 };
    }

    const area = parseFloat(zoneConfig.area) || 15;
    const usages = Array.isArray(zoneConfig.usages) ? zoneConfig.usages : [];
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);

    let sensibleW = 0;

    if (usages.length === 0) {
        // Pièce chauffée générique : profil résidentiel moyen (~2.2 W/m²)
        const factorH = (hour >= 7 && hour <= 22) ? 2.5 : 1.5;
        sensibleW = area * factorH;
    } else {
        // Base veille équipements selon surface
        sensibleW += area * 0.5;

        if (usages.includes('kitchen')) {
            sensibleW += 35; // Réfrigérateur / veille permanente
            if (hour >= 7 && hour <= 8) sensibleW += 90;
            else if (hour >= 12 && hour <= 13) sensibleW += (isWeekend ? 180 : 80);
            else if (hour >= 19 && hour <= 21) sensibleW += 200;
        }
        if (usages.includes('living') || usages.includes('dining')) {
            if (hour >= 7 && hour <= 9) sensibleW += 65;
            else if (hour > 9 && hour < 18) sensibleW += (isWeekend ? 130 : 30);
            else if (hour >= 18 && hour <= 23) sensibleW += 155;
        }
        if (usages.includes('office')) {
            if (hour >= 8 && hour <= 18) sensibleW += (isWeekend ? 35 : 130);
            else sensibleW += 10;
        }
        if (usages.includes('bedroom')) {
            if (hour >= 22 || hour < 7) sensibleW += 65; // Métabolisme nocturne (~65 W sensibles)
            else if (hour === 7 || hour === 21) sensibleW += 35;
        }
        if (usages.includes('bath') || usages.includes('bathroom')) {
            if ((hour >= 7 && hour <= 8) || (hour >= 19 && hour <= 20)) sensibleW += 70;
        }
    }

    // Répartition physique : 70% convectif direct vers l'air, 30% radiatif vers les parois (masse)
    const convectiveAirW = sensibleW * 0.70;
    const radiativeMassW = sensibleW * 0.30;

    return {
        totalW: parseFloat(sensibleW.toFixed(1)),
        convectiveAirW: parseFloat(convectiveAirW.toFixed(1)),
        radiativeMassW: parseFloat(radiativeMassW.toFixed(1))
    };
}

function calculateZone2R2CParams(zoneConfig) {
    if (!zoneConfig || (Array.isArray(zoneConfig.usages) && zoneConfig.usages.includes('outdoor'))) {
        return {
            area: 0, height: 2.5, volume: 0,
            hWindows: 0, hVentilation: 0, hRapide: 0,
            hWallOpaque: 0, hCeiling: 0, hFloor: 0, hOpaque: 0, hTotal: 0,
            hCi: 0, cAirWhPerK: 1, cMassWhPerK: 1, tauHours: 20,
            fSolAir: 0.18, fSolMass: 0.82
        };
    }

    const area = parseFloat(zoneConfig.area) || 15;
    const h = parseFloat(zoneConfig.height) || 2.5;
    const volume = area * h;
    const side = Math.sqrt(area);
    const wallArea = side * h;

    const uWall = getUValueParoi('wall', zoneConfig.wallMat || 'cinderblock', zoneConfig.insulation || 'iti_recent', zoneConfig.wallThick, zoneConfig.uWall);
    const uCeiling = getUValueParoi('ceiling', zoneConfig.ceilingMat || 'leger', zoneConfig.ceilingInsulation || 'iti_recent');
    const uFloor = getUValueParoi('floor', zoneConfig.floorMat || 'lourd', zoneConfig.floorInsulation || 'iti_recent');

    const getBFactor = (adj) => {
        if (Array.isArray(adj)) {
            if (adj.includes('outside')) return 1.0;
            if (adj.includes('unheated')) return 0.5;
            if (adj.includes('ground')) return 0.4;
            return 0.0;
        }
        if (adj === 'outside') return 1.0;
        if (adj === 'unheated') return 0.5;
        if (adj === 'ground') return 0.4;
        return 0.0;
    };

    const bW1 = getBFactor(zoneConfig.adj?.wall1 || 'outside');
    const bW2 = getBFactor(zoneConfig.adj?.wall2 || 'heated');
    const bW3 = getBFactor(zoneConfig.adj?.wall3 || 'heated');
    const bW4 = getBFactor(zoneConfig.adj?.wall4 || 'heated');
    const bCeiling = getBFactor(zoneConfig.adj?.ceiling || ['heated']);
    const bFloor = getBFactor(zoneConfig.adj?.floor || ['heated']);

    // 1. Vitrages (conductance directe sans inertie + fraction solaire)
    let hWindows = 0;
    let totalWindowArea = 0;
    let weightedFSolAir = 0;
    const glassUProps = {
        'single': 5.7,
        'double_old': 2.8,
        'double_standard': 1.5,
        'double_recent': 1.2,
        'triple': 0.7
    };

    if (Array.isArray(zoneConfig.windows) && zoneConfig.windows.length > 0) {
        zoneConfig.windows.forEach(win => {
            const wArea = parseFloat(win.area) || 0;
            if (wArea <= 0) return;
            const uWin = glassUProps[win.glass] || 1.4;
            hWindows += (uWin * wArea);
            totalWindowArea += wArea;

            // Si rideau ou store intérieur : le rayonnement arrêté chauffe immédiatement l'air par convection (50% air / 50% masse)
            // Sinon : l'air est diatherme (18% convectif immédiat sur vitre/mobilier léger, 82% absorbé par la tache solaire sur dalle/murs)
            const isInteriorBlind = (win.shutter === 'store_interieur' || win.shutter === 'rideau_interieur');
            const winFSolAir = isInteriorBlind ? 0.50 : 0.18;
            weightedFSolAir += (winFSolAir * wArea);
        });
    }

    const fSolAir = totalWindowArea > 0 ? (weightedFSolAir / totalWindowArea) : 0.18;
    const fSolMass = 1.0 - fSolAir;

    // 2. Parois opaques (déduction de la surface vitrée sur les murs extérieurs pour éviter tout double comptage)
    const extWallFactorSum = bW1 + bW2 + bW3 + bW4;
    const grossExtWallArea = wallArea * extWallFactorSum;
    const netExtWallArea = Math.max(0, grossExtWallArea - totalWindowArea);

    const hWallOpaque = uWall * netExtWallArea;
    const hCeiling = uCeiling * area * bCeiling;
    const hFloor = uFloor * area * bFloor;
    const hOpaque = hWallOpaque + hCeiling + hFloor;

    // 3. Renouvellement d'air aéraulique (VMC + infiltrations parasites)
    let qvEffM3h = 0;
    const vmcType = zoneConfig.equipment?.vmcType || 'none';
    const customAirflow = parseFloat(zoneConfig.equipment?.vmcAirflow);
    const vmcSys = zoneConfig.equipment?.vmcSystem || 'none';

    if (!isNaN(customAirflow) && customAirflow > 0) {
        const recoveryFactor = (vmcType === 'df_eff') ? 0.15 : 1.0; // Double flux : 85% récupérés
        const infiltrationM3h = volume * 0.12; // Infiltrations parasites enveloppe
        qvEffM3h = (customAirflow * recoveryFactor) + infiltrationM3h;
    } else {
        let ach = 0.45;
        if (vmcSys === 'marche_forcee') ach = 0.90;
        else if (vmcSys === 'continue_non_pilotable') ach = 0.60;
        else if (vmcSys === 'trappe') ach = 0.45;
        else if (vmcSys === 'none') ach = 0.22;

        if (vmcType === 'df_eff') ach *= 0.25; // VMC Double Flux + infiltrations résiduelles
        else if (vmcType === 'sf_hygro') ach *= 0.75; // Régulation hygro-réglable

        qvEffM3h = volume * ach;
    }

    const hVentilation = 0.34 * qvEffM3h;

    // Conductance directe rapide (Air <-> Extérieur : Vitrages + Renouvellement d'air)
    const hRapide = hWindows + hVentilation;
    const hTotal = hRapide + hOpaque;

    // 4. Couplage convectif pur Air <-> Masse (H_ci = somme h_ci * S_active)
    // Coefficient purement convectif h_ci (~2.5 W/m²K vertical, ~2.8 W/m²K horizontal moyen), SANS le terme radiatif h_ri (5.2 W/m²K)
    const ins = zoneConfig.insulation || 'iti_recent';
    const floorMat = zoneConfig.floorMat || 'lourd';
    const ceilingMat = zoneConfig.ceilingMat || 'leger';
    const wallMat = zoneConfig.wallMat || 'cinderblock';

    const totalInternalWallArea = Math.max(4.0, (4 * wallArea) - totalWindowArea);
    const activeWallRatio = (ins.startsWith('ite') || ins === 'none') ? 0.90 : 0.45;
    const activeFloorRatio = (floorMat === 'lourd') ? 0.95 : 0.45;
    const activeCeilingRatio = (ceilingMat === 'lourd') ? 0.85 : 0.35;

    const hCiWalls = 2.5 * (totalInternalWallArea * activeWallRatio);
    const hCiSlabs = 2.8 * area * (activeFloorRatio + activeCeilingRatio);
    const hCi = Math.max(volume * 1.8, hCiWalls + hCiSlabs);

    // 5. Capacités thermiques C_air et C_masse (en Wh/K) et constante de temps dynamique tau
    const cAirWhPerK = 1.0 * volume; // Air (0.34 Wh/m³K) + mobilier léger immédiatement couplé (~3x air)

    let cmPerM2 = 45; // Base inertie moyenne (parpaing + plâtre + cloisons)
    if (['concrete', 'stone'].includes(wallMat)) cmPerM2 += 35;
    else if (wallMat === 'wood' || wallMat === 'brique_creuse' || wallMat === 'brick') cmPerM2 -= 12;

    const wallThickCm = parseFloat(zoneConfig.wallThick) || 20;
    if (wallThickCm > 25 && !ins.startsWith('iti')) {
        cmPerM2 += Math.min(30, (wallThickCm - 20) * 0.8);
    }

    if (ins.startsWith('ite')) cmPerM2 += 30;
    else if (ins.startsWith('iti')) cmPerM2 -= 15;

    if (floorMat === 'lourd') cmPerM2 += 18;
    if (ceilingMat === 'lourd') cmPerM2 += 12;

    cmPerM2 = Math.max(22, cmPerM2);
    const cMassWhPerK = cmPerM2 * area;

    // Constante de temps effective du nœud Masse dans le réseau 2R2C
    let rMoyen = 2.2;
    if (ins.includes('recent') || ins.includes('heavy')) rMoyen = 3.6;
    else if (ins.includes('old')) rMoyen = 1.8;
    else if (ins === 'none') rMoyen = 0.6;

    const tauHours = Math.max(8.0, Math.min(72.0, parseFloat(((cmPerM2 * rMoyen) / 4.0).toFixed(1))));

    return {
        area,
        height: h,
        volume,
        hWindows: parseFloat(hWindows.toFixed(2)),
        hVentilation: parseFloat(hVentilation.toFixed(2)),
        hRapide: parseFloat(hRapide.toFixed(2)),
        hWallOpaque: parseFloat(hWallOpaque.toFixed(2)),
        hCeiling: parseFloat(hCeiling.toFixed(2)),
        hFloor: parseFloat(hFloor.toFixed(2)),
        hOpaque: parseFloat(hOpaque.toFixed(2)),
        hTotal: parseFloat(hTotal.toFixed(2)),
        hCi: parseFloat(hCi.toFixed(2)),
        cAirWhPerK: parseFloat(cAirWhPerK.toFixed(1)),
        cMassWhPerK: parseFloat(cMassWhPerK.toFixed(1)),
        tauHours,
        fSolAir: parseFloat(fSolAir.toFixed(2)),
        fSolMass: parseFloat(fSolMass.toFixed(2))
    };
}

function calculateWindowSolarGainW(zoneConfig, isSunny, sunModulation = 1.0) {
    if (!zoneConfig || !isSunny || !Array.isArray(zoneConfig.windows) || zoneConfig.windows.length === 0) {
        return { totalW: 0, airW: 0, massW: 0 };
    }

    const glassMap = { 'single': 0.85, 'double_old': 0.75, 'double_standard': 0.68, 'double_recent': 0.60, 'triple': 0.45 };
    const maskMap = { 'none': 1.0, 'partial': 0.5, 'heavy': 0.1 };
    const shutterMap = {
        'aucun': 1.0, 'store_interieur': 0.7, 'rideau_interieur': 0.8, 'store_banne': 0.3,
        'persienne': 0.3, 'roulant_pvc': 0.15, 'roulant_metal': 0.2, 'battant_bois': 0.15
    };
    const orientMap = { 'S': 3.2, 'SE': 2.5, 'SW': 2.5, 'E': 1.8, 'W': 1.8, 'N': 0.6 };

    let totalKw = 0;
    let airKw = 0;
    let massKw = 0;

    zoneConfig.windows.forEach(win => {
        const wArea = parseFloat(win.area) || 0;
        if (wArea <= 0) return;

        const gFactor = glassMap[win.glass] ?? 0.60;
        const maskFactor = maskMap[win.mask] ?? 1.0;
        const shutterFactor = shutterMap[win.shutter] ?? 1.0;

        const orients = Array.isArray(win.orient) ? win.orient : [win.orient || 'S'];
        let sumI = 0;
        orients.forEach(o => { sumI += (orientMap[o] || 1.5); });
        const iSolar = orients.length > 0 ? (sumI / orients.length) : 1.5;

        const winKw = wArea * gFactor * maskFactor * shutterFactor * (iSolar / 12) * sunModulation;
        const isInteriorBlind = (win.shutter === 'store_interieur' || win.shutter === 'rideau_interieur');
        const fAir = isInteriorBlind ? 0.50 : 0.18;

        totalKw += winKw;
        airKw += (winKw * fAir);
        massKw += (winKw * (1.0 - fAir));
    });

    return {
        totalW: totalKw * 1000,
        airW: airKw * 1000,
        massW: massKw * 1000
    };
}

function calculateDailyThermalBalance(zoneConfig, ta, tStructOpt = null) {
    if (!zoneConfig || (Array.isArray(zoneConfig.usages) && zoneConfig.usages.includes('outdoor'))) {
        return {
            hTotalWPerK: 0, hRapideWPerK: 0, hOpaqueWPerK: 0, hCiWPerK: 0,
            deperditionskWh: 0, gainsConductionkWh: 0, gainsSolaireskWh: 0, gainsTotauxkWh: 0,
            bilanNetkWh: 0, bilanPasseKwh: 0, bilanFuturKwh: 0, bilanDiurnekWh: 0, bilanNocturnekWh: 0,
            depKw: 0, depOpaqueMassKw: 0, gainsConductionKw: 0, gainsSolairesKw: 0, gainsSolairesAirKw: 0, gainsSolairesMasseKw: 0,
            gainsInternesKw: 0, fluxWallKw: 0, puissanceNetteKw: 0,
            cumulativeNetHours: new Array(24).fill(0), theoCumulativeHours: new Array(24).fill(0)
        };
    }

    const params = calculateZone2R2CParams(zoneConfig);
    const { hRapide, hOpaque, hTotal, hCi, cAirWhPerK, cMassWhPerK, tauHours, fSolAir, fSolMass } = params;

    const now = new Date();
    const currentHour = now.getHours();
    const dayOfWeek = now.getDay();
    const sunriseH = window.solsticeEphemeris?.sunriseHour || 7;
    const sunsetH = window.solsticeEphemeris?.sunsetHour || 19;

    const effOutdoor = getEffectiveOutdoorAir();
    const tExtRef = effOutdoor.tAir;

    // Température actuelle du nœud Masse (Tm)
    let tMassNow = tStructOpt;
    if (tMassNow === null || tMassNow === undefined || isNaN(tMassNow)) {
        tMassNow = (zoneConfig.name && DONNEES_HABITAT[zoneConfig.name]?.tStruct !== undefined)
            ? DONNEES_HABITAT[zoneConfig.name].tStruct
            : calculateEquilibriumTstruct(zoneConfig, ta, getDailyOutdoorTemp());
    }

    // 1. Flux directs rapides entre l'air intérieur (Ta) et l'air extérieur (Text) : Vitrages + Renouvellement d'air
    let depKw = 0;
    let gainsConductionKw = 0;
    if (ta > tExtRef) {
        depKw = (hRapide * (ta - tExtRef)) / 1000;
    } else {
        gainsConductionKw = (hRapide * (tExtRef - ta)) / 1000;
    }

    // Déperdition / gain lent des parois opaques (entre le nœud Masse Tm et l'extérieur, non compté deux fois sur l'air)
    const depOpaqueMassKw = (hOpaque * Math.max(0, tMassNow - tExtRef)) / 1000;
    const gainsOpaqueMassKw = (hOpaque * Math.max(0, tExtRef - tMassNow)) / 1000;

    // 2. Apports solaires instantanés (avec répartition Air diatherme vs Masse tache solaire)
    const isSunnyInstant = effOutdoor.hasDiffuseSun;
    const sunModulation = effOutdoor.sunFactor;
    const solarInstant = calculateWindowSolarGainW(zoneConfig, isSunnyInstant, sunModulation);
    const gainsSolairesKw = solarInstant.totalW / 1000;
    const gainsSolairesAirKw = solarInstant.airW / 1000;
    const gainsSolairesMasseKw = solarInstant.massW / 1000;

    // 3. Apports internes passifs (selon type de pièce, jour et heure)
    const internalInstant = calculatePassiveInternalGainsW(zoneConfig, currentHour, dayOfWeek);
    const gainsInternesKw = internalInstant.totalW / 1000;
    const gainsInternesAirKw = internalInstant.convectiveAirW / 1000;

    // 4. Flux convectif entre le nœud Masse (Tm) et le nœud Air (Ta)
    const fluxWallKw = (hCi * (tMassNow - ta)) / 1000;

    // Solde net instantané autour du dénominateur commun Ta
    const puissanceNetteKw = (gainsSolairesKw + gainsConductionKw + fluxWallKw) - depKw;

    // ============================================================
    // SIMULATION HORAIRE 24H COUPLÉE 2R2C (THÉORIQUE VS RÉEL IN SITU)
    // ============================================================
    let deperditionskWh = 0;
    let gainsConductionkWh = 0;
    let gainsSolaireskWh = 0;
    let bilanDiurnekWh = 0;
    let bilanNocturnekWh = 0;
    let bilanPasseKwh = 0;
    let bilanFuturKwh = 0;

    const cumulativeNetHours = [];
    const theoCumulativeHours = [];
    let runningRealNet = 0;
    let runningTheoNet = 0;

    // Référence théorique fixe à 20.0°C pour garantir l'invariance de la feuille de route théorique sur 24h
    const tIntRef = 20.0;
    const tExt24h = getDailyOutdoorTemp();
    let simMassTheo = calculateEquilibriumTstruct(zoneConfig, tIntRef, tExt24h);
    let simMassReal = calculateEquilibriumTstruct(zoneConfig, ta, tExt24h);

    if (Array.isArray(window.hourlyExtForecast) && window.hourlyExtForecast.length === 24) {
        window.hourlyExtForecast.forEach(slot => {
            const hSlot = slot.hour;
            const tExtHour = slot.temp;
            const intHour = calculatePassiveInternalGainsW(zoneConfig, hSlot, dayOfWeek);

            // Modulation solaire horaire sinusoïdale réaliste entre lever et coucher du soleil
            const dayLen = Math.max(6, sunsetH - sunriseH);
            const sinSun = (hSlot >= sunriseH && hSlot <= sunsetH)
                ? Math.max(0.25, Math.sin(((hSlot - sunriseH + 0.5) / dayLen) * Math.PI))
                : 0;

            // --- A. TRAJECTOIRE THÉORIQUE DE RÉFÉRENCE (24H STABLE) ---
            const solTheo = calculateWindowSolarGainW(zoneConfig, slot.isSunny && sinSun > 0, sinSun);
            const tMassEqTheo = (hCi * tIntRef + hOpaque * tExtHour + solTheo.massW + intHour.radiativeMassW) / Math.max(1, hCi + hOpaque);
            simMassTheo = tMassEqTheo + (simMassTheo - tMassEqTheo) * Math.exp(-1.0 / tauHours);

            const depRapidTheoKw = (hRapide * Math.max(0, tIntRef - tExtHour)) / 1000;
            const condRapidTheoKw = (hRapide * Math.max(0, tExtHour - tIntRef)) / 1000;
            const wallFluxTheoKw = (hCi * (simMassTheo - tIntRef)) / 1000;
            const netTheoHour = (solTheo.totalW / 1000) + condRapidTheoKw + wallFluxTheoKw - depRapidTheoKw;

            runningTheoNet += netTheoHour;
            theoCumulativeHours.push(parseFloat(runningTheoNet.toFixed(3)));

            // --- B. TRAJECTOIRE RÉELLE IN SITU (ANCRÉE SUR CAPTEURS TA, TM & PYRANOMÈTRE) ---
            const isPastOrCurrent = (hSlot <= currentHour);
            const effectiveSunnyReal = isPastOrCurrent ? (slot.isSunny || (hSlot === currentHour && isSunnyInstant)) : slot.isSunny;
            const effectiveSunMod = (hSlot === currentHour && isSunnyInstant)
                ? sunModulation
                : (isPastOrCurrent && isSunnyInstant ? Math.max(sinSun, sunModulation * 0.85) : sinSun);

            const solReal = calculateWindowSolarGainW(zoneConfig, effectiveSunnyReal && effectiveSunMod > 0, effectiveSunMod);
            const tMassEqReal = (hCi * ta + hOpaque * tExtHour + solReal.massW + intHour.radiativeMassW) / Math.max(1, hCi + hOpaque);
            simMassReal = (hSlot === currentHour)
                ? tMassNow
                : (tMassEqReal + (simMassReal - tMassEqReal) * Math.exp(-1.0 / tauHours));

            const depHour = (hRapide * Math.max(0, ta - tExtHour)) / 1000;
            const gainsCondHour = (hRapide * Math.max(0, tExtHour - ta)) / 1000;
            const gainsSolHour = solReal.totalW / 1000;
            const wallFluxRealKw = (hCi * (simMassReal - ta)) / 1000;

            deperditionskWh += depHour;
            gainsConductionkWh += gainsCondHour;
            gainsSolaireskWh += gainsSolHour;

            const netHour = (gainsCondHour + gainsSolHour + wallFluxRealKw) - depHour;
            runningRealNet += netHour;
            cumulativeNetHours.push(parseFloat(runningRealNet.toFixed(3)));

            if (hSlot >= sunriseH && hSlot < sunsetH) {
                bilanDiurnekWh += netHour;
            } else {
                bilanNocturnekWh += netHour;
            }

            if (hSlot < currentHour) {
                bilanPasseKwh += netHour;
            } else {
                bilanFuturKwh += netHour;
            }
        });
    } else {
        deperditionskWh = depKw * 24;
        gainsConductionkWh = gainsConductionKw * 24;
        gainsSolaireskWh = gainsSolairesKw * 10;
        bilanDiurnekWh = (gainsConductionKw + gainsSolairesKw + fluxWallKw - depKw) * 12;
        bilanNocturnekWh = (gainsConductionKw + fluxWallKw - depKw) * 12;

        const fractionPassee = Math.min(24, Math.max(0, currentHour)) / 24;
        const totalNetJour = bilanDiurnekWh + bilanNocturnekWh;
        bilanPasseKwh = totalNetJour * fractionPassee;
        bilanFuturKwh = totalNetJour * (1 - fractionPassee);
        for (let h = 1; h <= 24; h++) {
            const valH = parseFloat(((totalNetJour / 24) * h).toFixed(3));
            cumulativeNetHours.push(valH);
            theoCumulativeHours.push(valH);
        }
    }

    const gainsTotauxkWh = gainsSolaireskWh + gainsConductionkWh;
    const bilanNetkWh = bilanPasseKwh + bilanFuturKwh;

    return {
        hTotalWPerK: parseFloat(hTotal.toFixed(1)),
        hRapideWPerK: parseFloat(hRapide.toFixed(1)),
        hOpaqueWPerK: parseFloat(hOpaque.toFixed(1)),
        hCiWPerK: parseFloat(hCi.toFixed(1)),
        cAirWhPerK: parseFloat((cAirWhPerK || 0).toFixed(1)),
        cMassWhPerK: parseFloat((cMassWhPerK || 0).toFixed(1)),
        depKw: parseFloat(depKw.toFixed(2)),
        depOpaqueMassKw: parseFloat(depOpaqueMassKw.toFixed(2)),
        gainsOpaqueMassKw: parseFloat(gainsOpaqueMassKw.toFixed(2)),
        gainsConductionKw: parseFloat(gainsConductionKw.toFixed(2)),
        gainsSolairesKw: parseFloat(gainsSolairesKw.toFixed(2)),
        gainsSolairesAirKw: parseFloat(gainsSolairesAirKw.toFixed(2)),
        gainsSolairesMasseKw: parseFloat(gainsSolairesMasseKw.toFixed(2)),
        gainsInternesKw: parseFloat(gainsInternesKw.toFixed(2)),
        gainsInternesAirKw: parseFloat(gainsInternesAirKw.toFixed(2)),
        fluxWallKw: parseFloat(fluxWallKw.toFixed(2)),
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
        cumulativeNetHours,
        theoCumulativeHours,
        currentHour
    };
}

// ============================================================
// MODÈLE D'INERTIE ET RÉSERVE THERMIQUE AVANCÉ (2R2C & RATTRAPAGE)
// ============================================================

function calculateDynamicTau(zoneConfig) {
    if (!zoneConfig) return 20.0;
    return calculateZone2R2CParams(zoneConfig).tauHours;
}

function calculateEquilibriumTstruct(zoneConfig, tAir, tExt24h, extraMassPowerW = null) {
    if (!zoneConfig) return tAir;

    const params = calculateZone2R2CParams(zoneConfig);
    const { hCi, hOpaque } = params;
    if (hCi + hOpaque <= 0) return tAir;

    // Apports radiatifs moyens vers la masse sur 24h (apports internes radiatifs + fond solaire diurne)
    let avgMassPowerW = extraMassPowerW;
    if (avgMassPowerW === null || avgMassPowerW === undefined || isNaN(avgMassPowerW)) {
        const intGains = calculatePassiveInternalGainsW(zoneConfig, 14, 2);
        const effOutdoor = (typeof getEffectiveOutdoorAir === 'function') ? getEffectiveOutdoorAir() : { hasDiffuseSun: false, sunFactor: 0 };
        const solInstant = calculateWindowSolarGainW(zoneConfig, effOutdoor.hasDiffuseSun, effOutdoor.sunFactor * 0.35);
        avgMassPowerW = intGains.radiativeMassW + solInstant.massW;
    }

    // Équilibre stationnaire exact du nœud Masse 2R2C : H_ci*(Ta - Tm) + H_op*(Text - Tm) + Phi_masse = 0
    const tEquilibrium = (hCi * tAir + hOpaque * tExt24h + avgMassPowerW) / (hCi + hOpaque);
    return parseFloat(tEquilibrium.toFixed(2));
}

function updateStructureTemperature(nomPiece, currentTa) {
    const now = Date.now();
    const zoneConfig = getZoneConfigByName(nomPiece);
    const params = calculateZone2R2CParams(zoneConfig);
    const { hCi, hOpaque, tauHours: tau } = params;

    const effOutdoor = (typeof getEffectiveOutdoorAir === 'function') ? getEffectiveOutdoorAir() : { tAir: outdoorTemp, hasDiffuseSun: false, sunFactor: 0 };
    const tExtNow = effOutdoor.tAir ?? outdoorTemp;
    const tExt24h = getDailyOutdoorTemp();

    // Calcul de la puissance instantanée absorbée directement par la masse (82% du solaire + 30% apports internes)
    const nowDate = new Date(now);
    const solNow = calculateWindowSolarGainW(zoneConfig, effOutdoor.hasDiffuseSun, effOutdoor.sunFactor);
    const intNow = calculatePassiveInternalGainsW(zoneConfig, nowDate.getHours(), nowDate.getDay());
    const phiMassNowW = solNow.massW + intNow.radiativeMassW;

    // Température asymptotique instantanée du nœud Masse dans le schéma 2R2C
    const currentTargetTm = (hCi + hOpaque > 0)
        ? ((hCi * currentTa + hOpaque * tExtNow + phiMassNowW) / (hCi + hOpaque))
        : currentTa;

    if (!DONNEES_HABITAT[nomPiece]) {
        DONNEES_HABITAT[nomPiece] = {};
    }
    const roomData = DONNEES_HABITAT[nomPiece];

    let lastTstruct = roomData.tStruct;
    let lastTop = roomData.lastTop;
    let lastTimestamp = roomData.lastTimestamp;
    let modelVersion = roomData.modelVersion;

    if (lastTstruct === undefined) {
        const lastDataRaw = localStorage.getItem(`SOLSTICE_TSTRUCT_${nomPiece}`);
        if (lastDataRaw) {
            try {
                const parsed = JSON.parse(lastDataRaw);
                lastTstruct = parsed.tStruct;
                lastTop = parsed.lastTop;
                lastTimestamp = parsed.lastTimestamp;
                modelVersion = parsed.modelVersion;
            } catch (e) {}
        }
    }

    // Si pas de données, cache d'un ancien modèle (pré-2R2C), ou écart > 2.5°C : réinitialiser à l'équilibre 2R2C réaliste
    if (modelVersion !== '2R2C_v1' || lastTstruct === undefined || isNaN(lastTstruct) || Math.abs(lastTstruct - currentTa) > 2.5 || !lastTimestamp) {
        const initialTstruct = calculateEquilibriumTstruct(zoneConfig, currentTa, tExt24h);
        roomData.tStruct = parseFloat(initialTstruct.toFixed(2));
        roomData.lastTop = parseFloat(currentTargetTm.toFixed(2));
        roomData.lastTimestamp = now;
        roomData.modelVersion = '2R2C_v1';
        try {
            localStorage.setItem(`SOLSTICE_TSTRUCT_${nomPiece}`, JSON.stringify({
                tStruct: roomData.tStruct,
                lastTop: roomData.lastTop,
                lastTimestamp: now,
                modelVersion: '2R2C_v1'
            }));
        } catch (e) {}
        return roomData.tStruct;
    }

    const dtHours = (now - lastTimestamp) / (1000 * 3600);
    if (dtHours < 0.016) return roomData.tStruct;

    let newTstruct = lastTstruct;
    const prevTargetTm = lastTop !== undefined ? lastTop : currentTargetTm;

    if (dtHours > 24) {
        newTstruct = calculateEquilibriumTstruct(zoneConfig, currentTa, tExt24h);
    } else if (dtHours > 2) {
        const steps = Math.floor(dtHours);
        const alphaStep = 1 - Math.exp(-1 / tau);
        const tTargetStep = (currentTargetTm - prevTargetTm) / steps;

        for (let i = 1; i <= steps; i++) {
            const interpolatedTarget = prevTargetTm + (tTargetStep * i);
            newTstruct = newTstruct + alphaStep * (interpolatedTarget - newTstruct);
        }

        const remainder = dtHours - steps;
        if (remainder > 0.01) {
            const alphaRem = 1 - Math.exp(-remainder / tau);
            newTstruct = newTstruct + alphaRem * (currentTargetTm - newTstruct);
        }
    } else {
        const alpha = 1 - Math.exp(-dtHours / tau);
        newTstruct = lastTstruct + alpha * (currentTargetTm - lastTstruct);
    }

    roomData.tStruct = parseFloat(newTstruct.toFixed(2));
    roomData.lastTop = parseFloat(currentTargetTm.toFixed(2));
    roomData.lastTimestamp = now;
    roomData.modelVersion = '2R2C_v1';
    try {
        localStorage.setItem(`SOLSTICE_TSTRUCT_${nomPiece}`, JSON.stringify({
            tStruct: roomData.tStruct,
            lastTop: roomData.lastTop,
            lastTimestamp: now,
            modelVersion: '2R2C_v1'
        }));
    } catch (e) {}

    return roomData.tStruct;
}

function calculateStructureReserve(tStruct, tAir, totalVolumeM3 = 100, tauReel = 18.0, options = {}) {
    const deltaFlux = tStruct - tAir;
    // Couplage purement convectif H_ci entre le nœud Masse (Tm) et le nœud Air (Ta)
    // En 2R2C : h_ci ~ 2.5 à 2.8 W/(m²K) (sans le rayonnement inter-parois h_ri = 5.2 W/m²K) => ~ 3.0 W/(K·m³)
    const hCiEffectiveWPerK = (options.hCiWPerK && options.hCiWPerK > 0)
        ? options.hCiWPerK
        : (totalVolumeM3 * 3.0);
    const fluxPowerKw = (hCiEffectiveWPerK * deltaFlux) / 1000;
    const fluxWatts = Math.round(fluxPowerKw * 1000);
    // Capacité thermique horaire couplée 2R2C (Air + inertie active des parois mobilisée sur 1h : ~ 19 Wh/(K·m³))
    const cEffAirKwhPerK = Math.max(0.40, totalVolumeM3 * 0.019);
    const fluxRateDegPerH = fluxPowerKw / cEffAirKwhPerK;
    const absRateStr = Math.abs(fluxRateDegPerH).toFixed(2);

    let fluxStatusText = "";
    let fluxColor = "#4ADE80";

    if (deltaFlux > 0.25) {
        fluxStatusText = `🔥 Restitution (+${absRateStr} °C/h)`;
        fluxColor = "#FDBA74";
    } else if (deltaFlux < -0.25) {
        fluxStatusText = `❄️ Absorption (-${absRateStr} °C/h)`;
        fluxColor = "#38BDF8";
    } else {
        fluxStatusText = "⚖️ Équilibre (0.00 °C/h)";
        fluxColor = "#4ADE80";
    }

    // --- SIMULATION DYNAMIQUE PROSPECTIVE 2R2C DE L'AUTONOMIE & DU BOUCLIER D'INERTIE ---
    const tCible = 19.0;
    const tExtMoy = (options.tExt !== undefined) ? options.tExt : getDailyOutdoorTemp();
    const hTotalWPerK = (options.hTotalWPerK && options.hTotalWPerK > 0)
        ? options.hTotalWPerK
        : (totalVolumeM3 * 0.7);

    let futureForecast = (Array.isArray(window.futureHourlyForecast) && window.futureHourlyForecast.length >= 12)
        ? window.futureHourlyForecast
        : null;

    if (!futureForecast) {
        const curT = (options.tExt !== undefined) ? options.tExt : (typeof outdoorTemp !== 'undefined' ? outdoorTemp : 15);
        const curRh = (typeof outdoorHumidity !== 'undefined') ? outdoorHumidity : 60;
        const isSunny = (typeof sunshineStatus !== 'undefined') ? (sunshineStatus.toLowerCase().includes('clear') || sunshineStatus.toLowerCase().includes('sun')) : false;
        futureForecast = generateSyntheticFutureForecast(curT, curRh, isSunny);
    }

    const peakSolarKw = (options.gainsSolairesKw !== undefined && options.gainsSolairesKw > 0)
        ? options.gainsSolairesKw
        : (totalVolumeM3 * 0.004);

    const surfaceHab = totalVolumeM3 / 2.5;
    const pInterneW = (options.gainsInternesKw !== undefined && options.gainsInternesKw > 0)
        ? (options.gainsInternesKw * 1000)
        : (surfaceHab * 2.2);

    let simT = tStruct;
    let simT6h = tStruct;
    let hoursTo19 = null;
    let targetMoment = null;
    let minTReached = simT;
    let minNightTemp = 99;

    const tauSim = Math.max(8.0, tauReel);

    for (let k = 0; k < futureForecast.length; k++) {
        const slot = futureForecast[k];
        const tExtSlot = (slot && slot.temp !== undefined) ? slot.temp : 10;
        minNightTemp = Math.min(minNightTemp, tExtSlot);

        let solarW = 0;
        if (slot.isSunny) {
            const h = slot.hour;
            const sunFactor = Math.max(0, Math.sin(((h - 7) / 12) * Math.PI));
            solarW = peakSolarKw * 1000 * sunFactor;
        }

        // En régime passif 2R2C, 85% du solaire + apports internes soutiennent l'équilibre de la masse
        const totalGainsW = (solarW * 0.85) + pInterneW;
        const tEquilibreSlot = tExtSlot + (totalGainsW / Math.max(10, hTotalWPerK));

        const tNext = tEquilibreSlot + (simT - tEquilibreSlot) * Math.exp(-1.0 / tauSim);

        if (tStruct > tCible && simT > tCible && tNext <= tCible && hoursTo19 === null) {
            const frac = (simT - tCible) / Math.max(0.01, simT - tNext);
            hoursTo19 = k + frac;
            const targetTimestamp = slot.dt ? ((slot.dt + frac * 3600) * 1000) : (Date.now() + hoursTo19 * 3600 * 1000);
            targetMoment = new Date(targetTimestamp);
        }

        simT = tNext;
        if (k === 5) simT6h = simT;
        minTReached = Math.min(minTReached, simT);
    }

    if (tStruct <= tCible) {
        hoursTo19 = 0;
    }

    let autonomyText = '';
    let autonomyDetail = '';

    if (tStruct <= tCible) {
        const drift6h = (simT6h - tStruct) / 6.0;
        const driftSign = drift6h >= 0 ? '+' : '';
        const shieldPct = Math.min(85, Math.max(15, Math.round(((tStruct - 15.0) / 6.0) * 100)));
        const shieldPowerW = Math.round(Math.abs(tStruct - tExtMoy) * hTotalWPerK * 0.65);
        autonomyText = `🛡️ Actif (${driftSign}${drift6h.toFixed(2)} °C/h)`;
        autonomyDetail = `Bouclier d'inertie actif (τ = ${tauSim.toFixed(0)}h, réserve tampon ~${shieldPct}%) : vos parois lourdes à ${tStruct.toFixed(1)}°C amortissent le froid extérieur et limitent la dérive naturelle à ${driftSign}${drift6h.toFixed(2)} °C/h (effet tampon ~${shieldPowerW} W | Échange convectif Murs↔Air : ${fluxWatts >= 0 ? '+' : ''}${fluxWatts} W).`;
        hoursTo19 = 0;
    } else if (hoursTo19 === null) {
        autonomyText = '> 48 h (préservée)';
        autonomyDetail = `Simulation 2R2C 48h : grâce aux apports solaires stockés dans la masse et à la douceur extérieure, vos parois restent au-dessus de 19°C (minimum simulé : ${minTReached.toFixed(1)}°C | Échange Murs↔Air : ${fluxWatts >= 0 ? '+' : ''}${fluxWatts} W).`;
        hoursTo19 = 48;
    } else {
        const hVal = parseFloat(hoursTo19.toFixed(1));
        const now = new Date();
        const sameDay = targetMoment && (targetMoment.getDate() === now.getDate());
        const isTomorrow = targetMoment && (targetMoment.getDate() === (now.getDate() + 1));

        let momentStr = '';
        if (targetMoment) {
            const hStr = `${String(targetMoment.getHours()).padStart(2, '0')}h${String(targetMoment.getMinutes()).padStart(2, '0')}`;
            if (sameDay) momentStr = `ce soir vers ${hStr}`;
            else if (isTomorrow) momentStr = `demain vers ${hStr}`;
            else momentStr = `dans ${Math.round(hVal)}h (${targetMoment.toLocaleDateString('fr-FR', { weekday: 'short' })} à ${hStr})`;
        }

        if (hVal < 24) {
            autonomyText = `~${hVal} h`;
        } else {
            const days = (hVal / 24).toFixed(1);
            autonomyText = `~${days} j (~${Math.round(hVal)} h)`;
        }

        autonomyDetail = `Simulation 2R2C prospective : avec le refroidissement nocturne (${minNightTemp.toFixed(1)}°C dehors), la masse de vos parois franchira 19°C ${momentStr || `dans ~${hVal}h`} (Échange convectif Murs↔Air actuel : ${fluxWatts >= 0 ? '+' : ''}${fluxWatts} W).`;
    }

    const rawConfig = localStorage.getItem('HOUSE_CONFIG');
    const houseConfig = rawConfig ? JSON.parse(rawConfig) : {};
    
    const profileKey = houseConfig.profile 
                    || houseConfig.global?.profile 
                    || houseConfig.global?.userProfile 
                    || localStorage.getItem('SOLSTICE_PROFILE') 
                    || 'long_term';

    let tMaxPrevue = outdoorTemp;
    let tMinPrevue = outdoorTemp - 8.0;

    if (Array.isArray(window.hourlyExtForecast) && window.hourlyExtForecast.length > 0) {
        const tempsMeteo = window.hourlyExtForecast.map(s => s.temp);
        tMaxPrevue = Math.max(...tempsMeteo);
        tMinPrevue = Math.min(...tempsMeteo);
    }

    const surchauffeInterieure = (tStruct >= 24.0 || tAir >= 24.0);
    const vraieSurchauffeExterieure = (tExtMoy >= 20.0 && tMinPrevue >= 17.0);
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

    const finalTEq = (minTReached !== undefined && !isNaN(minTReached)) ? minTReached : tCible;
    const finalDeltaTeq = (tStruct - finalTEq);

    return {
        tStruct: parseFloat(tStruct.toFixed(1)),
        tEquilibre: parseFloat(finalTEq.toFixed(1)),
        deltaTeq: parseFloat(finalDeltaTeq.toFixed(1)),
        fluxPowerKw: parseFloat(fluxPowerKw.toFixed(2)),
        fluxStatusText,
        fluxColor,
        actionColor,
        autonomyText,
        autonomyDetail,
        hoursTo19: parseFloat(hoursTo19.toFixed(1)),
        targetMoment,
        actionText,
        isFreeHeating: (hoursTo19 >= 48)
    };
}

// ============================================================
// INDICATEURS GLOBAUX DE L'HABITAT (PONDÉRATION VOLUMIQUE 2R2C)
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
    let totalDepOpaqueMassKw = 0;
    let totalGainsOpaqueMassKw = 0;
    let totalGainsConductionKw = 0;
    let totalGainsSolairesKw = 0;
    let totalGainsSolairesAirKw = 0;
    let totalGainsSolairesMasseKw = 0;
    let totalGainsInternesKw = 0;
    let totalFluxWallKw = 0;
    let totalPuissanceNetteKw = 0;
    let totalBilanNetKwh = 0;
    let totalBilanPasseKwh = 0;
    let totalBilanFuturKwh = 0;

    let totalBilanDiurnekWh = 0;
    let totalBilanNocturnekWh = 0;
    let totalHTotalWPerK = 0;
    let totalHRapideWPerK = 0;
    let totalHOpaqueWPerK = 0;
    let totalHCiWPerK = 0;
    let totalCMassWhPerK = 0;
    const totalCumulativeHours = new Array(24).fill(0);
    const totalTheoCumulativeHours = new Array(24).fill(0);
    const roomSnapshots = [];
    const sunnyRoomsNow = [];

    for (const [nomPiece, data] of Object.entries(DONNEES_HABITAT)) {
        if (nomPiece === '__ENV__' || nomPiece === '__BUFFER_TOGGLE__') continue;
        if (!data || isNaN(data.ta) || isNaN(data.rh)) continue;

        const zoneConfig = getZoneConfigByName(nomPiece) || { name: nomPiece, area: 15, height: 2.5 };
        if (isOutdoorZone(nomPiece, zoneConfig)) continue;
        if (!includeBufferZones && isBufferZone(nomPiece, zoneConfig)) continue;

        const area = parseFloat(zoneConfig.area) || 15;
        const height = parseFloat(zoneConfig.height) || 2.5;
        const volume = area * height;

        const tauPiece = calculateDynamicTau(zoneConfig);
        // 1. Mise à jour du nœud Masse 2R2C (Tm) en premier pour nourrir Tmr (PMV) et le bilan thermique
        const tStruct = updateStructureTemperature(nomPiece, data.ta);

        const ah = calculateAbsoluteHumidity(data.ta, data.rh);
        const vel = calculateAirVelocity(zoneConfig, nomPiece);
        const tr = calculateMeanRadiantTemp(zoneConfig, data.ta, tStruct);
        const { met, totalClo } = getBaseCloAndMet(zoneConfig);
        const pmv = calculatePMV(data.ta, tr, vel, data.rh, met, totalClo);
        
        const drying = calculateDryingPotential(data.ta, data.rh, vel);
        const energy = calculateDailyThermalBalance(zoneConfig, data.ta, tStruct);

        const orientations = Array.isArray(zoneConfig.windows)
            ? [...new Set(zoneConfig.windows.map(w => (w.orientation || 'S').toUpperCase()))]
            : [];

        roomSnapshots.push({
            name: nomPiece,
            ta: parseFloat(data.ta.toFixed(1)),
            rh: Math.round(data.rh),
            tStruct: parseFloat(tStruct.toFixed(1)),
            pmv: parseFloat(pmv.toFixed(2)),
            absPmv: Math.abs(pmv),
            dryingScore10: parseFloat(drying.score10),
            dryingIndex: drying.dryingIndex,
            solarKw: energy.gainsSolairesKw || 0,
            orientations
        });

        if ((energy.gainsSolairesKw || 0) >= 0.04) {
            sunnyRoomsNow.push({
                name: nomPiece,
                solarKw: energy.gainsSolairesKw,
                orientations: orientations.length > 0 ? orientations.join('/') : 'Sud/Ouest'
            });
        }

        totalVolume += volume;
        weightedTau += tauPiece * volume;
        weightedTemp += data.ta * volume;
        weightedRH += data.rh * volume;
        weightedAH += ah * volume;
        weightedPMV += pmv * volume;
        weightedTStruct += tStruct * volume;
        weightedDryingIndex += drying.dryingIndex * volume;

        totalDeperditionsKw += energy.depKw;
        totalDepOpaqueMassKw += (energy.depOpaqueMassKw || 0);
        totalGainsOpaqueMassKw += (energy.gainsOpaqueMassKw || 0);
        totalGainsConductionKw += energy.gainsConductionKw;
        totalGainsSolairesKw += energy.gainsSolairesKw;
        totalGainsSolairesAirKw += (energy.gainsSolairesAirKw || 0);
        totalGainsSolairesMasseKw += (energy.gainsSolairesMasseKw || 0);
        totalGainsInternesKw += (energy.gainsInternesKw || 0);
        totalFluxWallKw += (energy.fluxWallKw || 0);
        totalPuissanceNetteKw += energy.puissanceNetteKw;
        totalBilanNetKwh += energy.bilanNetkWh;
        totalBilanPasseKwh += energy.bilanPasseKwh;
        totalBilanFuturKwh += energy.bilanFuturKwh;

        if (Array.isArray(energy.cumulativeNetHours)) {
            for (let h = 0; h < 24; h++) {
                totalCumulativeHours[h] += (energy.cumulativeNetHours[h] || 0);
            }
        }
        if (Array.isArray(energy.theoCumulativeHours)) {
            for (let h = 0; h < 24; h++) {
                totalTheoCumulativeHours[h] += (energy.theoCumulativeHours[h] || 0);
            }
        }

        totalBilanDiurnekWh += energy.bilanDiurnekWh;
        totalBilanNocturnekWh += energy.bilanNocturnekWh;
        totalHTotalWPerK += energy.hTotalWPerK;
        totalHRapideWPerK += (energy.hRapideWPerK || 0);
        totalHOpaqueWPerK += (energy.hOpaqueWPerK || 0);
        totalHCiWPerK += (energy.hCiWPerK || 0);
        totalCMassWhPerK += (energy.cMassWhPerK || 0);
    }

    if (totalVolume === 0) return null;
    const avgTau = weightedTau / totalVolume;

    const effOutdoor = getEffectiveOutdoorAir();
    const velExt = (outdoorWind || 0) / 3.6;
    const tDryingExt = effOutdoor.tAir;
    const rhDryingExt = effOutdoor.rhAir;
    const dryingOutdoor = calculateDryingPotential(tDryingExt, rhDryingExt, velExt, { isOutdoor: true });

    const avgDryingIndoorIndex = weightedDryingIndex / totalVolume;
    const indoorDryingScore10 = (Math.min(100, Math.max(0, Math.round((avgDryingIndoorIndex / 1.8) * 100))) / 10).toFixed(1);

    // Classement des pièces selon le PMV (distance à la neutralité thermique PMV = 0.00) et le potentiel de séchage
    let bestComfortRoom = null;
    let worstComfortRoom = null;
    let bestDryingRoom = null;
    if (roomSnapshots.length > 0) {
        const sortedByComfort = [...roomSnapshots].sort((a, b) => a.absPmv - b.absPmv);
        bestComfortRoom = sortedByComfort[0];
        worstComfortRoom = sortedByComfort[sortedByComfort.length - 1];

        const sortedByDrying = [...roomSnapshots].sort((a, b) => b.dryingIndex - a.dryingIndex);
        bestDryingRoom = sortedByDrying[0];
    }

    return {
        avgTemp: parseFloat((weightedTemp / totalVolume).toFixed(1)),
        avgRH: parseFloat((weightedRH / totalVolume).toFixed(0)),
        avgAH: parseFloat((weightedAH / totalVolume).toFixed(2)),
        avgPMV: parseFloat((weightedPMV / totalVolume).toFixed(2)),
        avgTStruct: parseFloat((weightedTStruct / totalVolume).toFixed(1)),
        avgTau: parseFloat(avgTau.toFixed(1)),
        indoorDryingScore10: indoorDryingScore10,
        outdoorDryingScore10: dryingOutdoor.score10,
        bestComfortRoom,
        worstComfortRoom,
        bestDryingRoom,
        sunnyRoomsNow,
        roomSnapshots,
        totalDeperditionsKw: parseFloat(totalDeperditionsKw.toFixed(2)),
        totalDepOpaqueMassKw: parseFloat(totalDepOpaqueMassKw.toFixed(2)),
        totalGainsOpaqueMassKw: parseFloat(totalGainsOpaqueMassKw.toFixed(2)),
        totalGainsConductionKw: parseFloat(totalGainsConductionKw.toFixed(2)),
        totalGainsSolairesKw: parseFloat(totalGainsSolairesKw.toFixed(2)),
        totalGainsSolairesAirKw: parseFloat(totalGainsSolairesAirKw.toFixed(2)),
        totalGainsSolairesMasseKw: parseFloat(totalGainsSolairesMasseKw.toFixed(2)),
        totalGainsInternesKw: parseFloat(totalGainsInternesKw.toFixed(2)),
        totalFluxWallKw: parseFloat(totalFluxWallKw.toFixed(2)),
        totalPuissanceNetteKw: parseFloat(totalPuissanceNetteKw.toFixed(2)),
        totalBilanNetKwh: parseFloat(totalBilanNetKwh.toFixed(2)),
        totalBilanPasseKwh: parseFloat(totalBilanPasseKwh.toFixed(2)),
        totalBilanFuturKwh: parseFloat(totalBilanFuturKwh.toFixed(2)),
        totalBilanDiurnekWh: parseFloat(totalBilanDiurnekWh.toFixed(2)),
        totalBilanNocturnekWh: parseFloat(totalBilanNocturnekWh.toFixed(2)),
        totalCumulativeHours: totalCumulativeHours.map(v => parseFloat(v.toFixed(2))),
        totalTheoCumulativeHours: totalTheoCumulativeHours.map(v => parseFloat(v.toFixed(2))),
        totalHTotalWPerK: parseFloat(totalHTotalWPerK.toFixed(1)),
        totalHRapideWPerK: parseFloat(totalHRapideWPerK.toFixed(1)),
        totalHOpaqueWPerK: parseFloat(totalHOpaqueWPerK.toFixed(1)),
        totalHCiWPerK: parseFloat(totalHCiWPerK.toFixed(1)),
        totalCMassWhPerK: parseFloat(totalCMassWhPerK.toFixed(1)),
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

        const isStreet = nomPiece.toLowerCase().includes('rue') || nomPiece.toLowerCase().includes('appui');
        const isGarden = nomPiece.toLowerCase().includes('jardin') || nomPiece.toLowerCase().includes('goutti');

        const actionElOutdoor = document.getElementById('action-' + idCapteur);
        if (actionElOutdoor) {
            if (isGarden) {
                actionElOutdoor.innerHTML = `<span style="background: #F0FDF4; border: 1px solid #BBF7D0; color: #166534; font-size: 0.72rem; padding: 2px 7px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;" title="Sonde d'air de référence in situ (Jardin / ombre)"><span>🌿</span><span>Réf. Air</span></span>`;
            } else if (isStreet) {
                actionElOutdoor.innerHTML = `<span style="background: #FFFBEB; border: 1px solid #FDE68A; color: #B45309; font-size: 0.72rem; padding: 2px 7px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 3px;" title="Sonde de façade exposée au soleil direct (Rue / appui)"><span>☀️</span><span>Réf. Soleil</span></span>`;
            } else {
                actionElOutdoor.innerHTML = `<span style="color: #94A3B8; font-size: 0.75rem; font-weight: 500;">Extérieur</span>`;
            }
        }

        const velExt = (outdoorWind || 0) / 3.6;
        const dryingExt = calculateDryingPotential(currentTa, currentRh, velExt, { isOutdoor: true });
        if (dryingEl) {
            const locName = isStreet ? "Côté Rue (au soleil)" : (isGarden ? "Au Jardin (ombragé)" : "Extérieur");
            dryingEl.innerHTML = `
                <div style="display: inline-flex; align-items: center; justify-content: center; gap: 6px;">
                    <span style="font-weight: 700; color: ${dryingExt.color};">${dryingExt.score10}/10</span>
                    <div style="width: 36px; height: 6px; background: #E2E8F0; border-radius: 3px; overflow: hidden; display: inline-block;">
                        <div style="width: ${dryingExt.scorePercent}%; height: 100%; background: ${dryingExt.color}; border-radius: 3px;"></div>
                    </div>
                </div>
            `;
            dryingEl.title = `Séchage ${locName} : ${dryingExt.status} (${dryingExt.scorePercent}%) - VPD: ${dryingExt.vpdkPa} kPa`;
        }
        return;
    }

    if (!data) return;

    const tStruct = updateStructureTemperature(nomPiece, data.ta);
    const vel = calculateAirVelocity(zoneConfig, nomPiece);
    const tr = calculateMeanRadiantTemp(zoneConfig, data.ta, tStruct);
    const { met, totalClo } = getBaseCloAndMet(zoneConfig);

    const drying = calculateDryingPotential(data.ta, data.rh, vel);
    const energyBalance = calculateDailyThermalBalance(zoneConfig, data.ta, tStruct);
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

    const roomVolM3 = (parseFloat(zoneConfig.area) || 15) * (parseFloat(zoneConfig.height) || 2.5);
    const cEffRoomKwhPerK = Math.max(0.20, roomVolM3 * 0.019);
    const roomWallRate = (energyBalance.fluxWallKw || 0) / cEffRoomKwhPerK;
    const roomNetRate = (energyBalance.puissanceNetteKw || 0) / cEffRoomKwhPerK;

    if (energyEl) {
        const netVal = energyBalance.bilanNetkWh;
        const prefix = netVal > 0 ? "+" : "";
        energyEl.textContent = `${prefix}${netVal.toFixed(2)} kWh/j`;
        energyEl.style.color = netVal >= 0 ? "#10B981" : "#EF4444";
        energyEl.title = `Bilan 2R2C cumulé (${energyBalance.currentHour}h) : ${energyBalance.bilanPasseKwh > 0 ? '+' : ''}${energyBalance.bilanPasseKwh} kWh | Dérive air : ${roomNetRate >= 0 ? '+' : ''}${roomNetRate.toFixed(2)} °C/h (${Math.round((energyBalance.puissanceNetteKw || 0) * 1000)} W | Solaire: +${Math.round((energyBalance.gainsSolairesKw || 0) * 1000)} W, Murs: ${energyBalance.fluxWallKw > 0 ? '+' : ''}${Math.round((energyBalance.fluxWallKw || 0) * 1000)} W, Pertes vitres/air: -${Math.round((energyBalance.depKw || 0) * 1000)} W)`;
    }

    if (tStructEl) {
        tStructEl.textContent = tStruct.toFixed(1) + " °C";
        tStructEl.title = `Nœud Masse 2R2C : ${tStruct.toFixed(1)} °C | T° Radiante Moyenne (Tmr) : ${tr.toFixed(1)} °C | Échange convectif Murs↔Air : ${roomWallRate >= 0 ? '+' : ''}${roomWallRate.toFixed(2)} °C/h (${energyBalance.fluxWallKw > 0 ? '+' : ''}${Math.round((energyBalance.fluxWallKw || 0) * 1000)} W)`;
    }

    if (pmvBadge) {
        pmvBadge.title = `PMV Fanger ISO 7730 : Air=${data.ta.toFixed(1)}°C, Tmr(2R2C)=${tr.toFixed(1)}°C, HR=${data.rh}%, v=${vel.toFixed(2)}m/s, Met=${met}, Clo=${totalClo.toFixed(2)}`;
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

    // Action Nudge Comportementale Intelligente
    const actionEl = document.getElementById('action-' + idCapteur);
    if (actionEl) {
        const nudge = getRoomActionNudge(nomPiece, zoneConfig, data, {
            t_ext: outdoorTemp,
            rh_ext: outdoorHumidity,
            sun_status: sunshineStatus
        });
        actionEl.innerHTML = nudge.html;
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
    const effOutdoor = getEffectiveOutdoorAir();
    const extTemp = effOutdoor.tAir;
    const extRh = effOutdoor.rhAir;
    const extAh = effOutdoor.ahAir;
    const extDrying = metrics.outdoorDryingScore10;

    const sunriseH = window.solsticeEphemeris?.sunriseHour || 7;
    const sunsetH = window.solsticeEphemeris?.sunsetHour || 19;
    const isNight = currentH < sunriseH || currentH >= sunsetH;
    let isSunny = (sunshineStatus || '').toLowerCase().includes('clear') || (sunshineStatus || '').toLowerCase().includes('sun');
    if (effOutdoor.hasDirectSun && !isNight) {
        isSunny = true;
    }

    let extEmoji = isNight ? '🌙' : (isSunny ? '☀️' : '⛅');
    let extLabel = isNight ? 'Nuit' : (isSunny ? 'Ensoleillé' : (sunshineStatus || 'Variable'));
    if ((sunshineStatus || '').toLowerCase().includes('rain')) { extEmoji = '🌧️'; extLabel = 'Pluie'; }
    if ((sunshineStatus || '').toLowerCase().includes('snow')) { extEmoji = '❄️'; extLabel = 'Neige'; }
    if (effOutdoor.hasDirectSun && !isNight) {
        extLabel = `Soleil in situ (+${effOutdoor.deltaSun.toFixed(1)}°C)`;
    } else if (effOutdoor.gardenSensor) {
        extLabel = `${extLabel} (in situ)`;
    }

    // Rendu Carte Extérieur (Desktop & Mobile)
    const txtExtTemp = document.getElementById('txt-ext-temp');
    if (txtExtTemp) {
        txtExtTemp.textContent = `${extTemp.toFixed(1)} °C`;
        if (effOutdoor.gardenSensor) {
            let tooltip = `🌿 Air Jardin (référence in situ) : ${extTemp.toFixed(1)} °C | HR ${extRh.toFixed(0)}% (${extAh.toFixed(1)} g/m³) [Réf. Air & Séchage]`;
            if (effOutdoor.streetSensor) {
                tooltip += `\n☀️ Façade Rue (ensoleillée) : ${effOutdoor.streetSensor.ta.toFixed(1)} °C | HR ${effOutdoor.streetSensor.rh.toFixed(0)}% (ΔT soleil : +${effOutdoor.deltaSun.toFixed(1)} °C)`;
            }
            txtExtTemp.parentElement.title = tooltip;
            txtExtTemp.title = tooltip;
        }
    }
    const txtExtTempM = document.getElementById('txt-ext-temp-m');
    if (txtExtTempM) txtExtTempM.textContent = `${extTemp.toFixed(1)} °C`;

    const txtExtRh = document.getElementById('txt-ext-rh');
    if (txtExtRh) txtExtRh.textContent = `${extRh.toFixed(0)} %`;
    const txtExtRhM = document.getElementById('txt-ext-rh-m');
    if (txtExtRhM) txtExtRhM.textContent = `${extRh.toFixed(0)}%`;

    const txtExtAh = document.getElementById('txt-ext-ah');
    if (txtExtAh) txtExtAh.textContent = `${extAh.toFixed(1)} g/m³`;
    const txtExtAhM = document.getElementById('txt-ext-ah-m');
    if (txtExtAhM) txtExtAhM.textContent = `${extAh.toFixed(1)} g/m³`;

    const txtExtDrying = document.getElementById('txt-ext-drying');
    if (txtExtDrying) {
        txtExtDrying.textContent = `${extDrying}/10`;
        const dryingRef = calculateDryingPotential(extTemp, extRh, (outdoorWind || 0) / 3.6, { isOutdoor: true });
        let dryingTooltip = `Séchage extérieur (Air réf. ${extTemp.toFixed(1)}°C, HR ${extRh.toFixed(0)}%, Vent ${(outdoorWind || 0).toFixed(0)} km/h) : ${extDrying}/10 — ${dryingRef.status}`;
        if (effOutdoor.streetSensor) {
            const dryingStreet = calculateDryingPotential(effOutdoor.streetSensor.ta, effOutdoor.streetSensor.rh, (outdoorWind || 0) / 3.6, { isOutdoor: true });
            dryingTooltip += `\nSéchage Côté Rue : ${dryingStreet.score10}/10 (${dryingStreet.status})`;
        }
        txtExtDrying.parentElement.title = dryingTooltip;
    }
    const txtExtDryingM = document.getElementById('txt-ext-drying-m');
    if (txtExtDryingM) txtExtDryingM.textContent = `${extDrying}/10`;

    const txtExtEmoji = document.getElementById('txt-ext-emoji');
    if (txtExtEmoji) txtExtEmoji.textContent = extEmoji;
    const txtExtEmojiM = document.getElementById('txt-ext-emoji-m');
    if (txtExtEmojiM) txtExtEmojiM.textContent = extEmoji;

    const txtExtLabel = document.getElementById('txt-ext-label');
    if (txtExtLabel) txtExtLabel.textContent = extLabel;
    const txtExtLabelM = document.getElementById('txt-ext-label-m');
    if (txtExtLabelM) txtExtLabelM.textContent = extLabel;

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
    // 2. BATTERIE DES MURS & AUTONOMIE (MODÈLE 2R2C)
    // ============================================================
    const globalReserve = calculateStructureReserve(
        metrics.avgTStruct, 
        metrics.avgTemp, 
        metrics.totalVolumeM3, 
        metrics.avgTau,
        {
            hTotalWPerK: metrics.totalHTotalWPerK,
            hCiWPerK: metrics.totalHCiWPerK,
            gainsSolairesKw: metrics.totalGainsSolairesKw,
            gainsInternesKw: metrics.totalGainsInternesKw,
            bilanNetKwh: metrics.totalBilanNetKwh,
            tExt: getDailyOutdoorTemp()
        }
    );

    const txtWallTemp = document.getElementById('txt-wall-temp');
    if (txtWallTemp) txtWallTemp.textContent = `${metrics.avgTStruct.toFixed(1)} °C`;
    const txtWallTempM = document.getElementById('txt-wall-temp-m');
    if (txtWallTempM) txtWallTempM.textContent = `${metrics.avgTStruct.toFixed(1)} °C`;

    const txtAutonomyVal = document.getElementById('txt-autonomy-val');
    if (txtAutonomyVal) {
        txtAutonomyVal.textContent = globalReserve.autonomyText;
        txtAutonomyVal.title = globalReserve.autonomyDetail || globalReserve.autonomyText;
    }
    const txtAutonomyValM = document.getElementById('txt-autonomy-val-m');
    if (txtAutonomyValM) {
        txtAutonomyValM.textContent = globalReserve.autonomyText;
        txtAutonomyValM.title = globalReserve.autonomyDetail || globalReserve.autonomyText;
    }
    
    const txtAutonomyBar = document.getElementById('txt-autonomy-bar');
    const txtAutonomyBarM = document.getElementById('txt-autonomy-bar-m');
    if (txtAutonomyBar || txtAutonomyBarM) {
        let barPct = 50;
        if (globalReserve.hoursTo19 !== undefined && !isNaN(globalReserve.hoursTo19) && globalReserve.hoursTo19 > 0 && !globalReserve.autonomyText.includes('Illimitée') && !globalReserve.autonomyText.includes('> 48 h')) {
            barPct = Math.min(100, Math.max(15, Math.round((globalReserve.hoursTo19 / 36) * 100)));
        } else if (globalReserve.autonomyText.includes('Illimitée') || globalReserve.autonomyText.includes('> 48 h')) {
            barPct = 100;
        } else if (globalReserve.hoursTo19 === 0 || globalReserve.autonomyText.includes('Actif')) {
            // Valorisation de la réserve tampon du bouclier d'inertie entre 15.0°C (0%) et 21.0°C (100%)
            barPct = Math.min(85, Math.max(15, Math.round(((metrics.avgTStruct - 15.0) / 6.0) * 100)));
        }
        if (txtAutonomyBar) {
            txtAutonomyBar.style.width = `${barPct}%`;
            txtAutonomyBar.parentElement.title = globalReserve.autonomyDetail || globalReserve.autonomyText;
        }
        if (txtAutonomyBarM) {
            txtAutonomyBarM.style.width = `${barPct}%`;
            txtAutonomyBarM.parentElement.title = globalReserve.autonomyDetail || globalReserve.autonomyText;
        }
    }

    // ============================================================
    // 3. AIR INTÉRIEUR
    // ============================================================
    const txtInTemp = document.getElementById('txt-in-temp');
    if (txtInTemp) txtInTemp.textContent = `${metrics.avgTemp.toFixed(1)} °C`;
    const txtInTempM = document.getElementById('txt-in-temp-m');
    if (txtInTempM) txtInTempM.textContent = `${metrics.avgTemp.toFixed(1)} °C`;

    const txtInRh = document.getElementById('txt-in-rh');
    if (txtInRh) txtInRh.textContent = `${metrics.avgRH} %`;
    const txtInRhM = document.getElementById('txt-in-rh-m');
    if (txtInRhM) txtInRhM.textContent = `${metrics.avgRH}%`;

    const txtInAh = document.getElementById('txt-in-ah');
    if (txtInAh) txtInAh.textContent = `${metrics.avgAH.toFixed(1)} g/m³`;
    const txtInAhM = document.getElementById('txt-in-ah-m');
    if (txtInAhM) txtInAhM.textContent = `${metrics.avgAH.toFixed(1)} g/m³`;

    const txtInDrying = document.getElementById('txt-in-drying');
    if (txtInDrying) txtInDrying.textContent = `${metrics.indoorDryingScore10}/10`;
    const txtInDryingM = document.getElementById('txt-in-drying-m');
    if (txtInDryingM) txtInDryingM.textContent = `${metrics.indoorDryingScore10}/10`;

    // 3.1 Statut d'aération différentielle globale
    const txtHudVent = document.getElementById('txt-hud-ventilation');
    const boxHudVent = document.getElementById('box-hud-ventilation');
    const deltaAhGlobal = metrics.avgAH - extAh;
    if (txtHudVent) {
        if (metrics.avgRH > 58 && deltaAhGlobal >= 0.5) {
            txtHudVent.textContent = "Favorable (5-7 min)";
            txtHudVent.className = "text-xs font-bold text-emerald-300 text-crisp";
            if (boxHudVent) boxHudVent.title = `Air extérieur asséchant (+${deltaAhGlobal.toFixed(1)} g/m³). Une aération flash extrait la vapeur sans refroidir la masse des murs.`;
        } else if (deltaAhGlobal < 0.2 && metrics.avgRH >= 58) {
            txtHudVent.textContent = "Bloquée (ext. saturé)";
            txtHudVent.className = "text-xs font-bold text-amber-300 text-crisp";
            if (boxHudVent) boxHudVent.title = `Air extérieur plus humide (${extAh.toFixed(1)} g/m³ > ${metrics.avgAH.toFixed(1)} g/m³). Ne pas ouvrir : risque d'imprégner vos murs.`;
        } else {
            txtHudVent.textContent = "Équilibrée";
            txtHudVent.className = "text-xs font-bold text-sky-200 text-crisp";
            if (boxHudVent) boxHudVent.title = "Hygrométrie saine, pas de correction urgente requise.";
        }
    }

    const txtPmvBadge = document.getElementById('txt-pmv-badge');
    const txtPmvBadgeM = document.getElementById('txt-pmv-badge-m');
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
        txtPmvBadge.className = `hidden sm:inline text-[8px] sm:text-[10px] font-extrabold px-1.5 sm:px-2 py-0.5 rounded-full border text-crisp ${pmvClass}`;
    }
    if (txtPmvBadgeM) {
        txtPmvBadgeM.textContent = `${pmvLabel} (${signPmv}${metrics.avgPMV.toFixed(2)})`;
        txtPmvBadgeM.className = `text-[8px] font-extrabold px-1.5 py-0.5 rounded-full border text-crisp ${pmvClass}`;
    }

    // ============================================================
    // 4. FLUX THERMIQUES EN °C/h (CAPACITÉS PROPRES PAR NŒUD & COUPLAGE 1H, W AU SURVOL)
    // ============================================================
    const totalVolM3 = metrics.totalVolumeM3 || 150;
    // Capacité thermique propre du volume d'air + mobilier léger (sans la masse des parois) : ~ 3.5 Wh/(K·m³)
    const cAirTotalKwhPerK = Math.max(0.25, totalVolM3 * 0.0035);
    // Capacité thermique réelle des parois lourdes agrégée depuis la configuration (matériaux, épaisseur, ITE/ITI, dalles)
    const cMassTotalKwhPerK = (metrics.totalCMassWhPerK && metrics.totalCMassWhPerK > 0)
        ? Math.max(0.80, metrics.totalCMassWhPerK / 1000)
        : Math.max(0.80, totalVolM3 * 0.022);
    // Sur un pas de temps d'1 heure, la tendance globale de la température de l'air est amortie par le couplage H_ci avec les parois
    const hCiCoupling = Math.max(80, metrics.totalHCiWPerK || (totalVolM3 * 3.0));
    const hRapCoupling = Math.max(15, metrics.totalHRapideWPerK || (totalVolM3 * 0.35));
    const hOpCoupling = Math.max(15, metrics.totalHOpaqueWPerK || (totalVolM3 * 0.35));
    const massCouplingFactor1h = hCiCoupling / (hCiCoupling + hRapCoupling + hOpCoupling);
    const cEffAirKwhPerK = Math.max(0.50, cAirTotalKwhPerK + (cMassTotalKwhPerK * massCouplingFactor1h));

    // 4.1 Apports Solaires via les vitrages
    const solGainKw = metrics.totalGainsSolairesKw || 0;
    const solAirKw = metrics.totalGainsSolairesAirKw || 0;
    const solMasseKw = metrics.totalGainsSolairesMasseKw || 0;
    const intGainKw = metrics.totalGainsInternesKw || 0;
    const solRate = solGainKw / cEffAirKwhPerK;
    const solWatts = Math.round(solGainKw * 1000);
    const solarTooltip = `☀️ Apports Solaires vitrages : +${solRate.toFixed(2)} °C/h (+${solWatts} W / +${solGainKw.toFixed(2)} kW)\n• Convection immédiate vers l'air : +${Math.round(solAirKw * 1000)} W (+${solAirKw.toFixed(2)} kW)\n• Rayonnement absorbé par la masse (dalles/murs) : +${Math.round(solMasseKw * 1000)} W (+${solMasseKw.toFixed(2)} kW)\n• Apports internes passifs (occupants/équipements) : +${Math.round(intGainKw * 1000)} W (+${intGainKw.toFixed(2)} kW)`;

    const txtFluxSolarVal = document.getElementById('txt-flux-solar-val');
    if (txtFluxSolarVal) {
        txtFluxSolarVal.textContent = solGainKw > 0 ? `+${solRate.toFixed(2)} °C/h` : `0.00 °C/h`;
        txtFluxSolarVal.className = `font-black ${solGainKw > 0 ? 'text-amber-400' : 'text-slate-400'}`;
        txtFluxSolarVal.title = solarTooltip;
        if (txtFluxSolarVal.parentElement) txtFluxSolarVal.parentElement.title = solarTooltip;
    }

    // 4.2 Flux Direct Rapide Air <-> Extérieur (Vitrages + Renouvellement d'air VMC, sans capacité thermique des parois)
    const depEnveloppeKw = metrics.totalDeperditionsKw || 0;
    const condGainKw = metrics.totalGainsConductionKw || 0;
    const depOpaqueKw = metrics.totalDepOpaqueMassKw || 0;
    const gainsOpaqueKw = metrics.totalGainsOpaqueMassKw || 0;
    const depRate = depEnveloppeKw / cAirTotalKwhPerK;
    const condRate = condGainKw / cAirTotalKwhPerK;
    const depWatts = Math.round(depEnveloppeKw * 1000);
    const condWatts = Math.round(condGainKw * 1000);
    const lossTooltip = depEnveloppeKw >= condGainKw
        ? `❄️ Échange direct rapide Vitrages & VMC ↔ Extérieur : -${depRate.toFixed(2)} °C/h sur l'air seul (-${depWatts} W / -${depEnveloppeKw.toFixed(2)} kW)\n• Éléments sans inertie des parois (Vitres + VMC/Infiltrations) : H_rapide = ${metrics.totalHRapideWPerK || 0} W/K\n• Air intérieur : ${metrics.avgTemp.toFixed(1)} °C ↔ Air extérieur : ${extTemp.toFixed(1)} °C`
        : `🌡️ Gain direct rapide Vitrages & VMC ↔ Extérieur : +${condRate.toFixed(2)} °C/h sur l'air seul (+${condWatts} W / +${condGainKw.toFixed(2)} kW)\n• Éléments sans inertie des parois (Vitres + VMC/Infiltrations) : H_rapide = ${metrics.totalHRapideWPerK || 0} W/K\n• Air intérieur : ${metrics.avgTemp.toFixed(1)} °C ↔ Air extérieur : ${extTemp.toFixed(1)} °C`;

    const txtFluxExtTag = document.getElementById('txt-flux-ext-tag');
    const txtFluxExtVal = document.getElementById('txt-flux-ext-val');
    const lineExt = document.getElementById('flux-laser-ext-line');
    const haloExt = document.getElementById('flux-laser-ext-halo');

    if (txtFluxExtTag && txtFluxExtVal && lineExt && haloExt) {
        txtFluxExtVal.title = lossTooltip;
        if (txtFluxExtVal.parentElement) txtFluxExtVal.parentElement.title = lossTooltip;
        if (depEnveloppeKw > 0.03) {
            txtFluxExtTag.textContent = "❄️ Vitres & VMC";
            txtFluxExtVal.textContent = `-${depRate.toFixed(2)} °C/h`;
            txtFluxExtVal.style.color = "#38BDF8";
            lineExt.setAttribute('d', "M 310 270 L 190 270");
            lineExt.setAttribute('stroke', "#38BDF8");
            lineExt.setAttribute('class', "flow-laser laser-blue");
            lineExt.setAttribute('marker-end', "url(#mk-laser-blue)");
            haloExt.setAttribute('d', "M 310 270 L 190 270");
            haloExt.setAttribute('stroke', "#38BDF8");
        } else if (condGainKw > 0.03) {
            txtFluxExtTag.textContent = "🌡️ Vitres & VMC";
            txtFluxExtVal.textContent = `+${condRate.toFixed(2)} °C/h`;
            txtFluxExtVal.style.color = "#F59E0B";
            lineExt.setAttribute('d', "M 190 270 L 310 270");
            lineExt.setAttribute('stroke', "#F59E0B");
            lineExt.setAttribute('class', "flow-laser laser-orange");
            lineExt.setAttribute('marker-end', "url(#mk-laser-orange)");
            haloExt.setAttribute('d', "M 190 270 L 310 270");
            haloExt.setAttribute('stroke', "#F59E0B");
        } else {
            txtFluxExtTag.textContent = "⚖️ Vitres & VMC";
            txtFluxExtVal.textContent = "0.00 °C/h";
            txtFluxExtVal.style.color = "#10B981";
            lineExt.setAttribute('d', "M 310 270 L 310 270");
            lineExt.setAttribute('stroke', "#10B981");
            lineExt.setAttribute('class', "flow-laser");
            lineExt.setAttribute('marker-end', "");
            haloExt.setAttribute('d', "M 310 270 L 310 270");
            haloExt.setAttribute('stroke', "#10B981");
        }
    }

    // 4.2b Flux Lent Parois Lourdes <-> Air Extérieur (Déperdition/Gain de la masse Tm à travers l'isolation)
    const depOpaqueRate = depOpaqueKw / cMassTotalKwhPerK;
    const gainsOpaqueRate = gainsOpaqueKw / cMassTotalKwhPerK;
    const depOpaqueWatts = Math.round(depOpaqueKw * 1000);
    const gainsOpaqueWatts = Math.round(gainsOpaqueKw * 1000);
    const opaqueExtTooltip = depOpaqueKw >= gainsOpaqueKw
        ? `🧱↔🌍 Échange lent Parois Lourdes ↔ Extérieur : -${depOpaqueRate.toFixed(2)} °C/h sur la masse (-${depOpaqueWatts} W / -${depOpaqueKw.toFixed(2)} kW)\n• Masse des parois (Tm) : ${metrics.avgTStruct.toFixed(1)} °C ↔ Extérieur : ${extTemp.toFixed(1)} °C\n• Conductance enveloppe opaque (Murs hors vitres + Toit + Dalle) : H_op = ${metrics.totalHOpaqueWPerK || 0} W/K`
        : `🧱↔🌍 Gain lent Extérieur → Parois Lourdes : +${gainsOpaqueRate.toFixed(2)} °C/h sur la masse (+${gainsOpaqueWatts} W / +${gainsOpaqueKw.toFixed(2)} kW)\n• Masse des parois (Tm) : ${metrics.avgTStruct.toFixed(1)} °C ↔ Extérieur : ${extTemp.toFixed(1)} °C\n• Conductance enveloppe opaque (Murs hors vitres + Toit + Dalle) : H_op = ${metrics.totalHOpaqueWPerK || 0} W/K`;
    const txtFluxOpaqueExtTag = document.getElementById('txt-flux-opaque-ext-tag');
    const txtFluxOpaqueExtVal = document.getElementById('txt-flux-opaque-ext-val');
    const lineOpaqueExt = document.getElementById('flux-laser-opaque-ext-line');
    const haloOpaqueExt = document.getElementById('flux-laser-opaque-ext-halo');

    if (txtFluxOpaqueExtTag && txtFluxOpaqueExtVal && lineOpaqueExt && haloOpaqueExt) {
        txtFluxOpaqueExtVal.title = opaqueExtTooltip;
        if (txtFluxOpaqueExtVal.parentElement) txtFluxOpaqueExtVal.parentElement.title = opaqueExtTooltip;
        if (depOpaqueKw > 0.03) {
            txtFluxOpaqueExtTag.textContent = "❄️ Parois → Ext.";
            txtFluxOpaqueExtVal.textContent = `-${depOpaqueRate.toFixed(2)} °C/h`;
            txtFluxOpaqueExtVal.style.color = "#38BDF8";
            lineOpaqueExt.setAttribute('d', "M 820 150 L 945 150");
            lineOpaqueExt.setAttribute('stroke', "#38BDF8");
            lineOpaqueExt.setAttribute('class', "flow-laser laser-blue");
            lineOpaqueExt.setAttribute('marker-end', "url(#mk-laser-blue)");
            haloOpaqueExt.setAttribute('d', "M 820 150 L 945 150");
            haloOpaqueExt.setAttribute('stroke', "#38BDF8");
        } else if (gainsOpaqueKw > 0.03) {
            txtFluxOpaqueExtTag.textContent = "🌡️ Ext. → Parois";
            txtFluxOpaqueExtVal.textContent = `+${gainsOpaqueRate.toFixed(2)} °C/h`;
            txtFluxOpaqueExtVal.style.color = "#F59E0B";
            lineOpaqueExt.setAttribute('d', "M 945 150 L 820 150");
            lineOpaqueExt.setAttribute('stroke', "#F59E0B");
            lineOpaqueExt.setAttribute('class', "flow-laser laser-orange");
            lineOpaqueExt.setAttribute('marker-end', "url(#mk-laser-orange)");
            haloOpaqueExt.setAttribute('d', "M 945 150 L 820 150");
            haloOpaqueExt.setAttribute('stroke', "#F59E0B");
        } else {
            txtFluxOpaqueExtTag.textContent = "⚖️ Parois ↔ Ext.";
            txtFluxOpaqueExtVal.textContent = "0.00 °C/h";
            txtFluxOpaqueExtVal.style.color = "#10B981";
            lineOpaqueExt.setAttribute('d', "M 820 150 L 820 150");
            lineOpaqueExt.setAttribute('stroke', "#10B981");
            lineOpaqueExt.setAttribute('class', "flow-laser");
            lineOpaqueExt.setAttribute('marker-end', "");
            haloOpaqueExt.setAttribute('d', "M 820 150 L 820 150");
            haloOpaqueExt.setAttribute('stroke', "#10B981");
        }
    }

    // 4.3 Flux Convectif Interne : Parois Lourdes <-> Air Intérieur (Nœud Masse Tm <-> Nœud Air Ta)
    const fluxWallKw = (metrics.totalFluxWallKw !== undefined) ? metrics.totalFluxWallKw : (globalReserve.fluxPowerKw || 0);
    const wallRate = fluxWallKw / cEffAirKwhPerK;
    const wallWatts = Math.round(fluxWallKw * 1000);
    const wallTooltip = `🧱 Échange convectif interne Parois (murs, sols, plafonds) ↔ Air : ${wallRate >= 0 ? '+' : ''}${wallRate.toFixed(2)} °C/h (${wallWatts >= 0 ? '+' : ''}${wallWatts} W / ${fluxWallKw >= 0 ? '+' : ''}${fluxWallKw.toFixed(2)} kW)\n• Température des Parois (Tm) : ${metrics.avgTStruct.toFixed(1)} °C vs Air (Ta) : ${metrics.avgTemp.toFixed(1)} °C\n• Couplage convectif pur H_ci = ${metrics.totalHCiWPerK || 0} W/K (h_ci ~ 2.5-2.8 W/m²K)`;

    const txtFluxWallTag = document.getElementById('txt-flux-wall-tag');
    const txtFluxWallVal = document.getElementById('txt-flux-wall-val');
    const lineWall = document.getElementById('flux-laser-wall-line');
    const haloWall = document.getElementById('flux-laser-wall-halo');

    if (txtFluxWallTag && txtFluxWallVal && lineWall && haloWall) {
        txtFluxWallVal.title = wallTooltip;
        if (txtFluxWallVal.parentElement) txtFluxWallVal.parentElement.title = wallTooltip;
        if (fluxWallKw > 0.05) {
            txtFluxWallTag.textContent = "🔥 Parois → Air";
            txtFluxWallVal.textContent = `+${wallRate.toFixed(2)} °C/h`;
            txtFluxWallVal.style.color = "#F59E0B";
            lineWall.setAttribute('d', "M 902 270 L 785 270");
            lineWall.setAttribute('stroke', "#F59E0B");
            lineWall.setAttribute('class', "flow-laser laser-orange");
            lineWall.setAttribute('marker-end', "url(#mk-laser-orange)");
            haloWall.setAttribute('d', "M 902 270 L 785 270");
            haloWall.setAttribute('stroke', "#F59E0B");
        } else if (fluxWallKw < -0.05) {
            txtFluxWallTag.textContent = "🧱 Air → Parois";
            txtFluxWallVal.textContent = `${wallRate.toFixed(2)} °C/h`;
            txtFluxWallVal.style.color = "#38BDF8";
            lineWall.setAttribute('d', "M 805 270 L 902 270");
            lineWall.setAttribute('stroke', "#38BDF8");
            lineWall.setAttribute('class', "flow-laser laser-blue");
            lineWall.setAttribute('marker-end', "url(#mk-laser-blue)");
            haloWall.setAttribute('d', "M 805 270 L 902 270");
            haloWall.setAttribute('stroke', "#38BDF8");
        } else {
            txtFluxWallTag.textContent = "⚖️ Parois ↔ Air";
            txtFluxWallVal.textContent = "0.00 °C/h";
            txtFluxWallVal.style.color = "#10B981";
            lineWall.setAttribute('d', "M 902 270 L 902 270");
            lineWall.setAttribute('stroke', "#10B981");
            lineWall.setAttribute('class', "flow-laser");
            lineWall.setAttribute('marker-end', "");
            haloWall.setAttribute('d', "M 902 270 L 902 270");
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
    // 5. BILAN PROGRESSIF ET TRAJECTOIRE ÉNERGÉTIQUE (MODÈLE 2R2C)
    // ============================================================
    // Décomposition des 3 flux élémentaires dans la carte Balance (en °C/h avec W au survol)
    const txtFluxSolarDetail = document.getElementById('txt-flux-solar-detail');
    if (txtFluxSolarDetail) {
        txtFluxSolarDetail.textContent = solGainKw > 0 ? `+${solRate.toFixed(2)} °C/h` : `0.00 °C/h`;
        txtFluxSolarDetail.className = `text-xs sm:text-sm font-black ${solGainKw > 0 ? 'text-amber-400' : 'text-slate-400'}`;
        txtFluxSolarDetail.title = solarTooltip;
        if (txtFluxSolarDetail.parentElement) txtFluxSolarDetail.parentElement.title = solarTooltip;
    }

    const txtFluxWallDetail = document.getElementById('txt-flux-wall-detail');
    if (txtFluxWallDetail) {
        const signWall = wallRate > 0 ? '+' : '';
        txtFluxWallDetail.textContent = `${signWall}${wallRate.toFixed(2)} °C/h`;
        txtFluxWallDetail.className = `text-xs sm:text-sm font-black ${fluxWallKw > 0.05 ? 'text-amber-400' : (fluxWallKw < -0.05 ? 'text-sky-400' : 'text-slate-300')}`;
        txtFluxWallDetail.title = wallTooltip;
        if (txtFluxWallDetail.parentElement) txtFluxWallDetail.parentElement.title = wallTooltip;
    }

    const txtFluxLossDetail = document.getElementById('txt-flux-loss-detail');
    if (txtFluxLossDetail) {
        if (depEnveloppeKw >= condGainKw) {
            txtFluxLossDetail.textContent = `-${depRate.toFixed(2)} °C/h`;
            txtFluxLossDetail.className = `text-xs sm:text-sm font-black ${depEnveloppeKw > 0 ? 'text-sky-400' : 'text-slate-400'}`;
        } else {
            txtFluxLossDetail.textContent = `+${condRate.toFixed(2)} °C/h`;
            txtFluxLossDetail.className = `text-xs sm:text-sm font-black text-amber-400`;
        }
        txtFluxLossDetail.title = lossTooltip;
        if (txtFluxLossDetail.parentElement) txtFluxLossDetail.parentElement.title = lossTooltip;
    }

    // Solde Net Instantané unifié autour de Ta : Solde = Solaire + Conduction - PertesDirectes + Murs
    const soldeNetReel = solGainKw + condGainKw - depEnveloppeKw + fluxWallKw;
    const netRate = soldeNetReel / cEffAirKwhPerK;
    const netWatts = Math.round(soldeNetReel * 1000);
    const valPasse = metrics.totalBilanPasseKwh || 0;
    const valFlux = soldeNetReel;
    const valFinal = metrics.totalBilanNetKwh || 0;

    const txtKwhPassed = document.getElementById('txt-kwh-passed');
    if (txtKwhPassed) {
        const sign = valPasse > 0 ? '+' : '';
        txtKwhPassed.textContent = `${sign}${valPasse.toFixed(2)} kWh`;
        txtKwhPassed.className = `text-base sm:text-lg font-black ${valPasse >= 0 ? 'text-emerald-400' : 'text-red-400'}`;
    }

    const txtKwFlux = document.getElementById('txt-kw-flux');
    const txtKwFluxDisplay = document.getElementById('txt-kw-flux-display');
    const verdictBox = document.getElementById('balance-verdict-box');
    const verdictTitle = document.getElementById('txt-balance-verdict-title');
    const verdictDesc = document.getElementById('txt-balance-verdict-desc');

    const signRate = netRate > 0 ? '+' : '';
    const rateFormatted = `${signRate}${netRate.toFixed(2)} °C/h`;
    const netTooltip = `Solde net sur l'air intérieur : ${rateFormatted} (${netWatts >= 0 ? '+' : ''}${netWatts} W / ${valFlux >= 0 ? '+' : ''}${valFlux.toFixed(2)} kW)\n• Solaire vitres : +${solRate.toFixed(2)} °C/h (+${solWatts} W)\n• Échange Murs ↔ Air : ${wallRate >= 0 ? '+' : ''}${wallRate.toFixed(2)} °C/h (${wallWatts >= 0 ? '+' : ''}${wallWatts} W)\n• Vitres & VMC ↔ Ext. : -${depRate.toFixed(2)} °C/h (-${depWatts} W)`;

    if (txtKwFlux) {
        txtKwFlux.textContent = rateFormatted;
        txtKwFlux.title = netTooltip;
    }
    if (txtKwFluxDisplay) {
        txtKwFluxDisplay.textContent = rateFormatted;
        txtKwFluxDisplay.title = netTooltip;
    }
    if (verdictBox) {
        verdictBox.title = netTooltip;
        if (netRate < -0.05) {
            verdictBox.className = "rounded-xl bg-sky-950/30 border border-sky-500/35 p-3 transition-colors";
            if (verdictTitle) {
                verdictTitle.textContent = "🔵 Tendance : Refroidissement";
                verdictTitle.className = "text-xs font-extrabold text-sky-200";
            }
            if (txtKwFlux) txtKwFlux.className = "text-sm sm:text-base font-black text-sky-400";
            if (verdictDesc) {
                if (fluxWallKw < -0.05 && depEnveloppeKw > 0.05) {
                    verdictDesc.textContent = `Sans chauffage actif, l'air cède des calories aux vitrages/VMC et recharge vos parois plus fraîches (${netWatts} W au total).`;
                } else if (fluxWallKw > 0.05) {
                    verdictDesc.textContent = `Vos parois restituent +${wallRate.toFixed(2)} °C/h (+${wallWatts} W) pour amortir les pertes extérieures (-${depRate.toFixed(2)} °C/h).`;
                } else {
                    verdictDesc.textContent = `Les pertes vers l'extérieur (${extTemp.toFixed(1)}°C dehors) l'emportent sur les apports actuels (${netWatts} W).`;
                }
            }
        } else if (netRate > 0.05) {
            verdictBox.className = "rounded-xl bg-amber-950/30 border border-amber-500/35 p-3 transition-colors";
            if (verdictTitle) {
                verdictTitle.textContent = "🟠 Tendance : Réchauffement naturel";
                verdictTitle.className = "text-xs font-extrabold text-amber-200";
            }
            if (txtKwFlux) txtKwFlux.className = "text-sm sm:text-base font-black text-amber-400";
            if (verdictDesc) {
                if (solGainKw > 0.15) {
                    verdictDesc.textContent = `Les apports solaires (+${solRate.toFixed(2)} °C/h) dépassent les déperditions et réchauffent naturellement votre intérieur (+${netWatts} W).`;
                } else {
                    verdictDesc.textContent = `La restitution de chaleur de vos parois (+${wallRate.toFixed(2)} °C/h) fait remonter la température de l'air (+${netWatts} W).`;
                }
            }
        } else {
            verdictBox.className = "rounded-xl bg-emerald-950/30 border border-emerald-500/35 p-3 transition-colors";
            if (verdictTitle) {
                verdictTitle.textContent = "🟢 Tendance : Équilibre stable";
                verdictTitle.className = "text-xs font-extrabold text-emerald-200";
            }
            if (txtKwFlux) txtKwFlux.className = "text-sm sm:text-base font-black text-emerald-400";
            if (verdictDesc) {
                verdictDesc.textContent = `Ce qui chauffe compense exactement ce qui refroidit : votre température intérieure reste stable (${netWatts >= 0 ? '+' : ''}${netWatts} W).`;
            }
        }
    }

    const txtKwhFinal = document.getElementById('txt-kwh-final');
    if (txtKwhFinal) {
        const sign = valFinal > 0 ? '+' : '';
        txtKwhFinal.textContent = `${sign}${valFinal.toFixed(2)} kWh`;
        txtKwhFinal.className = `text-base sm:text-lg font-black ${valFinal >= 0 ? 'text-white' : 'text-slate-300'}`;
    }

    // Animation & Positionnement de la Jauge de Balance Graphique
    const barGain = document.getElementById('balance-bar-gain');
    const barLoss = document.getElementById('balance-bar-loss');
    const needle = document.getElementById('balance-needle');
    if (barGain && barLoss && needle) {
        const apportsTotaux = Math.max(0.05, solGainKw + condGainKw + (fluxWallKw > 0 ? fluxWallKw : 0));
        const pertesTotales = Math.max(0.05, depEnveloppeKw + (fluxWallKw < 0 ? Math.abs(fluxWallKw) : 0));
        const totalFluxAbs = apportsTotaux + pertesTotales;
        const gainPct = Math.min(90, Math.max(10, Math.round((apportsTotaux / totalFluxAbs) * 100)));
        const lossPct = 100 - gainPct;
        
        barGain.style.width = `${gainPct}%`;
        barLoss.style.width = `${lossPct}%`;
        needle.style.left = `${gainPct}%`;
    }

    // ============================================================
    // 5.2 TRAJECTOIRE ÉNERGÉTIQUE 24H, EFFORT DE CHAUFFE & RÉVEIL 07H (2R2C)
    // ============================================================
    // Simulation prospective 2R2C jusqu'au prochain réveil à 07h00 (en régime passif sans chauffage)
    const hoursTo07h = currentH < 7 ? (7 - currentH) : (24 - currentH + 7);
    let wakeupForecastArr = (Array.isArray(window.futureHourlyForecast) && window.futureHourlyForecast.length >= hoursTo07h)
        ? window.futureHourlyForecast
        : generateSyntheticFutureForecast(extTemp, extRh, isSunny);

    let simTMass07 = metrics.avgTStruct;
    let simTAir07 = metrics.avgTemp;
    let bilanMinuit07hKwh = 0;
    let minExtNight07 = extTemp;

    const hRapide07 = Math.max(15, metrics.totalHRapideWPerK || (totalVolM3 * 0.35));
    const hOpaque07 = Math.max(15, metrics.totalHOpaqueWPerK || (totalVolM3 * 0.35));
    const hCi07 = Math.max(80, metrics.totalHCiWPerK || (totalVolM3 * 3.0));
    const cMassWh07 = Math.max(800, cMassTotalKwhPerK * 1000);
    const pIntNightW = (totalVolM3 / 2.5) * 1.6;

    for (let s = 0; s < hoursTo07h; s++) {
        const slot = wakeupForecastArr[s];
        const tExtSlot = (slot && slot.temp !== undefined) ? slot.temp : (extTemp - 2.0);
        const slotHour = (slot && slot.hour !== undefined) ? slot.hour : ((currentH + s + 1) % 24);
        minExtNight07 = Math.min(minExtNight07, tExtSlot);

        let solarStepW = 0;
        if (slot && slot.isSunny && slotHour >= sunriseH && slotHour < sunsetH) {
            const sunFactor = Math.max(0, Math.sin(((slotHour - 7) / 12) * Math.PI));
            solarStepW = (solGainKw > 0 ? solGainKw * 1000 : totalVolM3 * 3.5) * sunFactor;
        }

        // Équilibre convectif horaire du nœud Air (Ta) couplé à la masse (Tm) et aux vitres/VMC (Text)
        const tAirTarget = (hCi07 * simTMass07 + hRapide07 * tExtSlot + pIntNightW * 0.55 + solarStepW * 0.20) / (hCi07 + hRapide07);
        simTAir07 = simTAir07 + (tAirTarget - simTAir07) * 0.78;

        // Évolution dynamique du nœud Masse (Tm) sur 1h
        const qMassW = hOpaque07 * (tExtSlot - simTMass07) + hCi07 * (simTAir07 - simTMass07) + pIntNightW * 0.45 + solarStepW * 0.80;
        simTMass07 = simTMass07 + (qMassW / cMassWh07);

        // Cumul énergétique passif entre Minuit (00h) et 07h00 pour le 4e jalon du graphique
        if (slotHour >= 0 && slotHour < 7) {
            const netStepKw = (solarStepW + pIntNightW - hRapide07 * (simTAir07 - tExtSlot) - hOpaque07 * (simTMass07 - tExtSlot)) / 1000;
            bilanMinuit07hKwh += netStepKw;
        }
    }

    const wakeupAirTemp = simTAir07;
    const wakeupWallTemp = simTMass07;
    const deltaWakeupAir = wakeupAirTemp - metrics.avgTemp;
    const valWakeupKwh = valFinal + bilanMinuit07hKwh;

    // Mise à jour de la Trajectoire Énergétique Graphique (SVG : 00h x=48 -> Maintenant x=168 -> Minuit x=300 -> Réveil 07h x=418)
    const elBarPassed = document.getElementById('chart-bar-passed');
    const elTxtPassed = document.getElementById('chart-txt-passed');
    const elDotPassed = document.getElementById('chart-dot-passed');
    const elBarFinal = document.getElementById('chart-bar-final');
    const elTxtFinal = document.getElementById('chart-txt-final');
    const elDotFinal = document.getElementById('chart-dot-final');
    const elDotTheo = document.getElementById('chart-dot-theo');
    const elBarWakeup = document.getElementById('chart-bar-wakeup');
    const elTxtWakeupTemp = document.getElementById('chart-txt-wakeup-temp');
    const elTxtWakeupWall = document.getElementById('chart-txt-wakeup-wall');
    const elDotWakeup = document.getElementById('chart-dot-wakeup');
    const elTrendCurve = document.getElementById('chart-trend-curve');
    const elProjCurve = document.getElementById('chart-proj-curve');
    const elTheoCurve = document.getElementById('chart-theo-curve');
    const elWakeupCurve = document.getElementById('chart-wakeup-curve');
    const txtTheoLandingLegend = document.getElementById('txt-theo-landing-legend');

    if (elBarPassed && elBarFinal) {
        const zeroY = 70;
        const scaleKwh = 2.6;

        // 1. Point Réel Passé / Cumul à Maintenant (x = 168)
        const hP = Math.min(44, Math.max(6, Math.round(Math.abs(valPasse) * scaleKwh)));
        const yP = valPasse >= 0 ? (zeroY - hP) : zeroY;
        const dotYP = valPasse >= 0 ? (zeroY - hP) : (zeroY + hP);

        elBarPassed.setAttribute('y', yP);
        elBarPassed.setAttribute('height', hP);
        if (elTxtPassed) {
            const signP = valPasse > 0 ? '+' : '';
            elTxtPassed.textContent = `${signP}${valPasse.toFixed(1)} kWh`;
            elTxtPassed.setAttribute('y', Math.max(15, yP - 5));
        }
        if (elDotPassed) elDotPassed.setAttribute('cy', dotYP);

        // 2. Point Atterrissage Projeté / 24h Minuit (x = 300)
        const hFin = Math.min(44, Math.max(6, Math.round(Math.abs(valFinal) * scaleKwh)));
        const yFin = valFinal >= 0 ? (zeroY - hFin) : zeroY;
        const dotYFin = valFinal >= 0 ? (zeroY - hFin) : (zeroY + hFin);

        elBarFinal.setAttribute('y', yFin);
        elBarFinal.setAttribute('height', hFin);
        if (elTxtFinal) {
            const signFin = valFinal > 0 ? '+' : '';
            elTxtFinal.textContent = `${signFin}${valFinal.toFixed(1)} kWh`;
            elTxtFinal.setAttribute('y', Math.max(15, yFin - 5));
        }
        if (elDotFinal) elDotFinal.setAttribute('cy', dotYFin);

        // 3. Point Réveil Thermique à 07h00 (x = 418)
        const hWake = Math.min(44, Math.max(6, Math.round(Math.abs(valWakeupKwh) * scaleKwh)));
        const yWake = valWakeupKwh >= 0 ? (zeroY - hWake) : zeroY;
        const dotYWake = valWakeupKwh >= 0 ? (zeroY - hWake) : (zeroY + hWake);

        if (elBarWakeup) {
            elBarWakeup.setAttribute('y', yWake);
            elBarWakeup.setAttribute('height', hWake);
        }
        if (elTxtWakeupTemp) {
            elTxtWakeupTemp.textContent = `~${wakeupAirTemp.toFixed(1)} °C`;
            elTxtWakeupTemp.setAttribute('y', Math.max(14, yWake - 13));
        }
        if (elTxtWakeupWall) {
            elTxtWakeupWall.textContent = `Murs ${wakeupWallTemp.toFixed(1)}°C`;
            elTxtWakeupWall.setAttribute('y', Math.max(24, yWake - 3));
        }
        if (elDotWakeup) {
            elDotWakeup.setAttribute('cy', dotYWake);
            elDotWakeup.setAttribute('title', `Simulation 2R2C à 07h00 (sans chauffer) : Air ~${wakeupAirTemp.toFixed(1)}°C | Murs ~${wakeupWallTemp.toFixed(1)}°C | Bilan nuit (00h→07h) : ${bilanMinuit07hKwh >= 0 ? '+' : ''}${bilanMinuit07hKwh.toFixed(1)} kWh`);
        }
        if (elBarWakeup && elBarWakeup.parentElement) {
            elBarWakeup.parentElement.setAttribute('title', `Réveil thermique à 07h00 sans chauffage : Air ~${wakeupAirTemp.toFixed(1)}°C (${deltaWakeupAir >= 0 ? '+' : ''}${deltaWakeupAir.toFixed(1)}°C) | Murs ~${wakeupWallTemp.toFixed(1)}°C (T° ext min prévue : ${minExtNight07.toFixed(1)}°C)`);
        }

        // 4. Trajectoire Théorique Prévisionnelle (24h de référence stable à T_ref = 20°C)
        const theoCumulArr = metrics.totalTheoCumulativeHours || metrics.totalCumulativeHours || [];
        const valTheoPasse = (theoCumulArr.length === 24 && currentH > 0) ? theoCumulArr[currentH - 1] : (metrics.totalBilanPasseKwh || valPasse);
        const valTheoFinal = (theoCumulArr.length === 24) ? theoCumulArr[23] : (metrics.totalBilanNetKwh || valFinal);

        const hTheoP = Math.min(44, Math.max(4, Math.round(Math.abs(valTheoPasse) * scaleKwh)));
        const dotYTheoP = valTheoPasse >= 0 ? (zeroY - hTheoP) : (zeroY + hTheoP);
        const hTheoFin = Math.min(44, Math.max(4, Math.round(Math.abs(valTheoFinal) * scaleKwh)));
        const dotYTheoFin = valTheoFinal >= 0 ? (zeroY - hTheoFin) : (zeroY + hTheoFin);

        if (elDotTheo) {
            elDotTheo.setAttribute('cy', dotYTheoFin);
            const signTheoFin = valTheoFinal > 0 ? '+' : '';
            elDotTheo.setAttribute('title', `Prévision théorique initiale : ${signTheoFin}${valTheoFinal.toFixed(1)} kWh à minuit`);
        }

        // Tracé de la courbe théorique 24h (pointillés bleu-gris de 00h x=48 à Minuit x=300)
        if (elTheoCurve) {
            elTheoCurve.setAttribute('d', `M 48 ${zeroY} C 98 ${zeroY}, 120 ${dotYTheoP}, 168 ${dotYTheoP} C 220 ${dotYTheoP}, 255 ${dotYTheoFin}, 300 ${dotYTheoFin}`);
        }

        // Tracé du Réel in situ (trait plein orange de 00h x=48 à Maintenant x=168)
        if (elTrendCurve) {
            elTrendCurve.setAttribute('d', `M 48 ${zeroY} C 98 ${zeroY}, 120 ${dotYP}, 168 ${dotYP}`);
            elTrendCurve.setAttribute('stroke', '#F59E0B');
        }

        // Tracé du Prolongement Projeté (tirets orange de Maintenant x=168 à Minuit x=300)
        if (elProjCurve) {
            elProjCurve.setAttribute('d', `M 168 ${dotYP} C 220 ${dotYP}, 255 ${dotYFin}, 300 ${dotYFin}`);
            elProjCurve.setAttribute('stroke', '#F59E0B');
        }

        // Tracé de la Dérive Nocturne (pointillés violets de Minuit x=300 à Réveil 07h x=418)
        if (elWakeupCurve) {
            elWakeupCurve.setAttribute('d', `M 300 ${dotYFin} C 345 ${dotYFin}, 375 ${dotYWake}, 418 ${dotYWake}`);
        }

        if (elTxtPassed && elTxtPassed.parentElement) {
            const diffSolar = valPasse - valTheoPasse;
            const diffSign = diffSolar >= 0 ? '+' : '';
            const tooltipStr = `Réel in situ : ${valPasse > 0 ? '+' : ''}${valPasse.toFixed(1)} kWh | Prévision météo : ${valTheoPasse > 0 ? '+' : ''}${valTheoPasse.toFixed(1)} kWh (${diffSign}${diffSolar.toFixed(1)} kWh d'écart)`;
            elTxtPassed.parentElement.setAttribute('title', tooltipStr);
        }

        if (txtTheoLandingLegend) {
            const signTheo = valTheoFinal > 0 ? '+' : '';
            txtTheoLandingLegend.textContent = `Théorique (${signTheo}${valTheoFinal.toFixed(1)} kWh)`;
        }
    }

    // Encadrés du Bilan passif sur 24h : Effort de chauffe requis (24h) & Réveil demain 07h
    const boxHeatingEffort = document.getElementById('box-heating-effort');
    const txtHeatingEffortTitle = document.getElementById('txt-heating-effort-title');
    const txtHeatingEffortVal = document.getElementById('txt-heating-effort-val');
    const txtHeatingEffortDesc = document.getElementById('txt-heating-effort-desc');

    if (boxHeatingEffort && txtHeatingEffortTitle && txtHeatingEffortVal && txtHeatingEffortDesc) {
        if (valFinal < -0.15) {
            const effortKwh = Math.abs(valFinal).toFixed(1);
            boxHeatingEffort.className = "rounded-xl bg-amber-950/30 border border-amber-500/35 p-3 transition-colors";
            txtHeatingEffortTitle.textContent = "🔥 Effort de chauffe requis (sur 24h)";
            txtHeatingEffortTitle.className = "text-xs font-extrabold text-amber-200";
            txtHeatingEffortVal.textContent = `~${effortKwh} kWh`;
            txtHeatingEffortVal.className = "text-sm sm:text-base font-black text-amber-400";
            txtHeatingEffortDesc.textContent = `Énergie à fournir par votre chauffage sur la journée pour compenser les pertes naturelles et maintenir ${metrics.avgTemp.toFixed(1)}°C.`;
            boxHeatingEffort.title = `Bilan passif sur 24h : ${valFinal.toFixed(2)} kWh. Sans apport de chauffage de ~${effortKwh} kWh, la maison puiserait cette énergie dans ses parois.`;
        } else {
            boxHeatingEffort.className = "rounded-xl bg-emerald-950/30 border border-emerald-500/35 p-3 transition-colors";
            txtHeatingEffortTitle.textContent = "☀️ Autonomie passive (sur 24h)";
            txtHeatingEffortTitle.className = "text-xs font-extrabold text-emerald-200";
            txtHeatingEffortVal.textContent = `0 kWh requis (+${valFinal.toFixed(1)} kWh)`;
            txtHeatingEffortVal.className = "text-sm sm:text-base font-black text-emerald-400";
            txtHeatingEffortDesc.textContent = `Le soleil et l'inertie de vos parois couvrent 100% des pertes thermiques de la journée.`;
            boxHeatingEffort.title = `Excédent thermique naturel de +${valFinal.toFixed(2)} kWh stocké dans vos parois (murs, sols, plafonds).`;
        }
    }

    const boxWakeupForecast = document.getElementById('box-wakeup-forecast');
    const txtWakeupSummaryVal = document.getElementById('txt-wakeup-summary-val');
    const txtWakeupSummaryDesc = document.getElementById('txt-wakeup-summary-desc');
    if (boxWakeupForecast && txtWakeupSummaryVal && txtWakeupSummaryDesc) {
        const signDeltaWake = deltaWakeupAir >= 0 ? '+' : '';
        const avgNightRate = deltaWakeupAir / Math.max(1, hoursTo07h);
        const signNightRate = avgNightRate >= 0 ? '+' : '';
        txtWakeupSummaryVal.textContent = `Air ~${wakeupAirTemp.toFixed(1)}°C · Parois ~${wakeupWallTemp.toFixed(1)}°C`;
        txtWakeupSummaryDesc.textContent = `Évolution naturelle sur ${hoursTo07h}h : ${signDeltaWake}${deltaWakeupAir.toFixed(1)}°C (soit ${signNightRate}${avgNightRate.toFixed(2)} °C/h en moyenne, nuit à ${minExtNight07.toFixed(1)}°C amortie par vos parois).`;
        boxWakeupForecast.title = `Simulation 2R2C sur ${hoursTo07h}h sans chauffage actif : l'air passera de ${metrics.avgTemp.toFixed(1)}°C à ~${wakeupAirTemp.toFixed(1)}°C (${signNightRate}${avgNightRate.toFixed(2)} °C/h en moyenne) et vos parois à ~${wakeupWallTemp.toFixed(1)}°C.`;
    }

    const radiatorGroup = document.getElementById('radiator-heating-group');
    if (radiatorGroup) {
        const isHeatingOn = typeof isHeatingSeasonActive === 'function' ? isHeatingSeasonActive() : false;
        if (isHeatingOn) {
            radiatorGroup.classList.add('anim-radiator-heating');
            radiatorGroup.style.opacity = '1';
        } else {
            radiatorGroup.classList.remove('anim-radiator-heating');
            radiatorGroup.style.opacity = '0.45';
        }
    }

    // ============================================================
    // 6. SYNTHÈSE EN MOTS SIMPLES, FOCUS PIÈCES (PMV) & 3 ACTIONS PRIORITAIRES
    // ============================================================
    // 6.1 Focus Pièces extrêmes selon le PMV (distance à la neutralité PMV = 0.00)
    const badgeBestRoom = document.getElementById('badge-best-room');
    const badgeWorstRoom = document.getElementById('badge-worst-room');
    if (badgeBestRoom && metrics.bestComfortRoom) {
        const b = metrics.bestComfortRoom;
        const bSign = b.pmv > 0 ? '+' : '';
        badgeBestRoom.textContent = `🏆 Top confort : ${b.name} (PMV ${bSign}${b.pmv.toFixed(2)} · ${b.ta.toFixed(1)}°C)`;
        badgeBestRoom.title = `Pièce la plus proche du confort neutre (PMV 0.00) : ${b.name} — Air ${b.ta.toFixed(1)}°C, Parois ${b.tStruct.toFixed(1)}°C, HR ${b.rh}%`;
    }
    if (badgeWorstRoom && metrics.worstComfortRoom) {
        const w = metrics.worstComfortRoom;
        if (metrics.bestComfortRoom && w.name === metrics.bestComfortRoom.name) {
            badgeWorstRoom.style.display = 'none';
        } else {
            badgeWorstRoom.style.display = 'inline-block';
            const wSign = w.pmv > 0 ? '+' : '';
            const reasonTag = w.pmv < -0.5 ? 'fraîche' : (w.pmv > 0.5 ? 'chaude' : 'écart PMV');
            badgeWorstRoom.textContent = `⚠️ Point d'attention : ${w.name} (PMV ${wSign}${w.pmv.toFixed(2)} · ${w.ta.toFixed(1)}°C)`;
            badgeWorstRoom.title = `Pièce la plus éloignée de la neutralité thermique (${reasonTag}) : ${w.name} — Air ${w.ta.toFixed(1)}°C, Parois ${w.tStruct.toFixed(1)}°C, HR ${w.rh}%`;
        }
    }

    // 6.2 Les 3 Repères d'Action Immédiate (Volets, Lessive, Habillement)
    const isHeatingOn = typeof isHeatingSeasonActive === 'function' ? isHeatingSeasonActive() : false;
    const isColdOrHeatingSeason = isHeatingOn || outdoorTemp < 18.5;
    const isWarmSeason = !isHeatingOn && outdoorTemp >= 22.0;

    // Action 1 : Volets & Vitrages (selon l'heure exacte et les pièces exposées au soleil)
    const badgeShutters = document.getElementById('badge-prio-shutters');
    const titleShutters = document.getElementById('txt-prio-shutters-title');
    const descShutters = document.getElementById('txt-prio-shutters-desc');
    const icoShutters = document.getElementById('ico-prio-shutters');
    if (titleShutters && descShutters && badgeShutters) {
        const sunnyRooms = metrics.sunnyRoomsNow || [];
        const sunnyNames = sunnyRooms.slice(0, 3).map(r => r.name).join(', ');
        const sunnyOrient = [...new Set(sunnyRooms.map(r => r.orientations))].join(' / ') || (currentH < 13 ? 'Est / Sud' : 'Sud / Ouest');

        if (isNight) {
            if (isColdOrHeatingSeason || metrics.avgTemp < 21.5) {
                if (icoShutters) icoShutters.textContent = "🌙";
                badgeShutters.textContent = `Nuit (${sunsetH}h→${sunriseH}h)`;
                badgeShutters.className = "text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-200 border border-indigo-500/40";
                titleShutters.textContent = "Fermez tous les volets pour la nuit";
                descShutters.textContent = `Le soleil est couché : fermer les volets de toutes les pièces réduit d'environ 25% les pertes rapides par les vitrages jusqu'à ${sunriseH}h.`;
            } else {
                if (icoShutters) icoShutters.textContent = "🌙";
                badgeShutters.textContent = "Fraîcheur nuit";
                badgeShutters.className = "text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-950 text-sky-200 border border-sky-500/40";
                titleShutters.textContent = "Aérez / entrouvrez sur les pièces chaudes";
                descShutters.textContent = `Profitez des ${extTemp.toFixed(1)}°C extérieurs nocturnes pour décharger la chaleur accumulée dans les chambres et le séjour.`;
            }
        } else if (solGainKw >= 0.06) {
            if (metrics.avgTemp >= 23.5 || isWarmSeason) {
                if (icoShutters) icoShutters.textContent = "🛡️";
                badgeShutters.textContent = `Soleil (${sunnyOrient})`;
                badgeShutters.className = "text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-950 text-amber-200 border border-amber-500/40";
                titleShutters.textContent = `Occultez côté ${sunnyOrient}${sunnyNames ? ` (${sunnyNames})` : ''}`;
                descShutters.textContent = `Bloquez les +${solWatts} W solaires sur les vitrages exposés maintenant pour éviter la surchauffe (laissez ouvert au Nord).`;
            } else {
                if (icoShutters) icoShutters.textContent = "☀️";
                badgeShutters.textContent = `+${solRate.toFixed(2)} °C/h gratuits`;
                badgeShutters.className = "text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-950 text-amber-200 border border-amber-500/40";
                titleShutters.textContent = `Ouvrez grand côté ${sunnyOrient}${sunnyNames ? ` (${sunnyNames})` : ''}`;
                descShutters.textContent = `Captez les +${solWatts} W solaires gratuits sur ces pièces exposées maintenant, puis fermez tout dès la tombée de la nuit (${sunsetH}h).`;
            }
        } else {
            if (icoShutters) icoShutters.textContent = "☁️";
            badgeShutters.textContent = `Fermeture à ${sunsetH}h`;
            badgeShutters.className = "text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-600/40";
            titleShutters.textContent = `Ouverts pour la clarté · Fermez dès ${sunsetH}h`;
            descShutters.textContent = `Ciel peu porteur en calories solaires directes : gardez la lumière naturelle en journée et isolez toutes les fenêtres dès ${sunsetH}h.`;
        }
    }

    // Action 2 : Lessive (Comparaison séchage Extérieur vs Intérieur + meilleure pièce)
    const badgeLaundry = document.getElementById('badge-prio-laundry');
    const titleLaundry = document.getElementById('txt-prio-laundry-title');
    const descLaundry = document.getElementById('txt-prio-laundry-desc');
    const icoLaundry = document.getElementById('ico-prio-laundry');
    if (titleLaundry && descLaundry && badgeLaundry) {
        const extScore = parseFloat(metrics.outdoorDryingScore10) || 0;
        const inScore = parseFloat(metrics.indoorDryingScore10) || 0;
        const isRainingOrSnowing = (sunshineStatus || '').toLowerCase().includes('rain') || (sunshineStatus || '').toLowerCase().includes('snow') || (sunshineStatus || '').toLowerCase().includes('drizzle');
        const bestDryRoom = metrics.bestDryingRoom;
        const bestRoomStr = bestDryRoom ? `${bestDryRoom.name} (${bestDryRoom.dryingScore10.toFixed(1)}/10)` : `intérieur (${inScore.toFixed(1)}/10)`;

        if (!isRainingOrSnowing && !isNight && extScore >= 5.5 && extScore >= inScore) {
            if (icoLaundry) icoLaundry.textContent = "🌤️";
            badgeLaundry.textContent = `Dehors ${extScore.toFixed(1)}/10`;
            badgeLaundry.className = "text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-200 border border-emerald-500/40";
            titleLaundry.textContent = "Étendez votre lessive Dehors";
            descLaundry.textContent = `Pouvoir séchant extérieur supérieur (${extScore.toFixed(1)}/10 vs ${inScore.toFixed(1)}/10 dedans) sans humidifier l'air de la maison.`;
        } else {
            if (icoLaundry) icoLaundry.textContent = "🏠";
            badgeLaundry.textContent = `Dedans ${inScore.toFixed(1)}/10`;
            badgeLaundry.className = "text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-950 text-sky-200 border border-sky-500/40";
            titleLaundry.textContent = `Étendez Dedans : privilégiez ${bestDryRoom ? bestDryRoom.name : "l'intérieur"}`;
            const whyNoExt = isRainingOrSnowing ? "temps humide/pluvieux dehors" : (isNight ? `nuit fraîche (${extScore.toFixed(1)}/10 dehors)` : `extérieur peu séchant (${extScore.toFixed(1)}/10, HR ${extRh.toFixed(0)}%)`);
            descLaundry.textContent = `Avec ${whyNoExt}, étendez dans ${bestRoomStr} et aérez 5 min si l'humidité dépasse 60%.`;
        }
    }

    // Action 3 : Habillement & Confort PMV (ajustement Clo exact pour atteindre PMV ~ 0.00)
    const badgeClothing = document.getElementById('badge-prio-clothing');
    const titleClothing = document.getElementById('txt-prio-clothing-title');
    const descClothing = document.getElementById('txt-prio-clothing-desc');
    const icoClothing = document.getElementById('ico-prio-clothing');
    if (titleClothing && descClothing && badgeClothing) {
        const { totalClo: curClo } = getBaseCloAndMet({ name: 'Salon', usages: ['living'] });
        if (metrics.avgPMV < -0.20) {
            const deltaCloNeeded = Math.min(1.0, Math.max(0.15, Math.round((Math.abs(metrics.avgPMV) * 0.55) * 20) / 20));
            const targetClo = (curClo + deltaCloNeeded).toFixed(2);
            let garmentAdvice = "un gilet léger ou des chaussettes chaudes";
            if (deltaCloNeeded >= 0.45) {
                garmentAdvice = "un pull chaud / polaire (+ pantalon long)";
            } else if (deltaCloNeeded >= 0.25) {
                garmentAdvice = "un pull fin, sweat ou gilet manches longues";
            }
            if (icoClothing) icoClothing.textContent = "🧥";
            badgeClothing.textContent = `Ajoutez +${deltaCloNeeded.toFixed(2)} Clo`;
            badgeClothing.className = "text-[9px] font-bold px-1.5 py-0.5 rounded bg-sky-950 text-sky-200 border border-sky-500/40";
            titleClothing.textContent = `Ajoutez ${garmentAdvice}`;
            descClothing.textContent = `Passer de ${curClo.toFixed(2)} à ~${targetClo} Clo efface le ressenti frais (PMV ${metrics.avgPMV.toFixed(2)} → ~0.00) sans surconsommer de chauffage.`;
        } else if (metrics.avgPMV > 0.25) {
            const deltaCloRemove = Math.min(0.6, Math.max(0.15, Math.round((metrics.avgPMV * 0.50) * 20) / 20));
            if (icoClothing) icoClothing.textContent = "👕";
            badgeClothing.textContent = `Allégez -${deltaCloRemove.toFixed(2)} Clo`;
            badgeClothing.className = "text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-950 text-amber-200 border border-amber-500/40";
            titleClothing.textContent = "Allégez votre tenue (t-shirt / manches courtes)";
            descClothing.textContent = `Réduire de ${deltaCloRemove.toFixed(2)} Clo ramène immédiatement votre ressenti (PMV +${metrics.avgPMV.toFixed(2)}) au confort neutre.`;
        } else {
            if (icoClothing) icoClothing.textContent = "✅";
            badgeClothing.textContent = `Idéal (${curClo.toFixed(2)} Clo)`;
            badgeClothing.className = "text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-200 border border-emerald-500/40";
            titleClothing.textContent = "Tenue actuelle parfaitement adaptée";
            descClothing.textContent = `Votre équipement vestimentaire (${curClo.toFixed(2)} Clo) vous place en plein confort thermique (PMV ${signPmv}${metrics.avgPMV.toFixed(2)}).`;
        }
    }

    // 6.3 Texte de synthèse narratif (cohérent et complémentaire avec Tendance, Effort 24h et Réveil 07h)
    const txtSummary = document.getElementById('txt-summary');
    if (txtSummary) {
        let synthese = "";
        const tAir = metrics.avgTemp.toFixed(1);
        const tExt = extTemp.toFixed(1);
        const tParois = metrics.avgTStruct.toFixed(1);

        if (fluxWallKw > 0.08) {
            synthese = `Dehors il fait ${tExt}°C, votre air intérieur est à ${tAir}°C (${pmvLabel.toLowerCase()}) et vos parois à ${tParois}°C jouent leur rôle de bouclier en restituant leur chaleur.`;
        } else if (fluxWallKw < -0.08) {
            synthese = `Dehors il fait ${tExt}°C, votre air intérieur est à ${tAir}°C (${pmvLabel.toLowerCase()}) et vos parois à ${tParois}°C emmagasinent une partie des calories ambiantes.`;
        } else {
            synthese = `Dehors il fait ${tExt}°C, votre air intérieur (${tAir}°C, ${pmvLabel.toLowerCase()}) et vos parois (${tParois}°C) sont en parfait équilibre thermique.`;
        }

        if (metrics.avgRH > 58 && deltaAhGlobal >= 0.5) {
            synthese += ` 💡 Aération conseillée (${metrics.avgRH}% HR) : ouvrez 5 à 7 min en grand pour évacuer l'humidité vers l'extérieur plus sec sans refroidir vos parois.`;
        } else if (metrics.avgRH >= 58 && deltaAhGlobal < 0.2) {
            synthese += ` ⚠️ Aération déconseillée (${metrics.avgRH}% HR) : l'air extérieur est chargé d'humidité, gardez les fenêtres fermées.`;
        } else {
            synthese += ` 🌬️ Qualité d'air : hygrométrie intérieure saine (${metrics.avgRH}% HR), aucune aération corrective n'est requise en ce moment.`;
        }
        txtSummary.textContent = synthese;
        txtSummary.title = `Détail des puissances instantanées : Solaire +${solWatts} W | Parois↔Air ${wallWatts >= 0 ? '+' : ''}${wallWatts} W | Vitres & VMC -${depWatts} W | Parois↔Ext. -${depOpaqueWatts} W | Solde net air : ${netWatts >= 0 ? '+' : ''}${netWatts} W`;
    }

    // Horodatage du calcul
    const timeEl = document.getElementById('global-calc-timestamp');
    if (timeEl) {
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        timeEl.textContent = `(Calculé à ${timeStr})`;
    }

    // 7. Bandeau de Notification & Visuel Direct des Actions à Réaliser (Cœur du guidage habitant)
    updateLiveActionNotificationBanner(metrics);
}

function updateLiveActionNotificationBanner(metrics) {
    if (!metrics || !Array.isArray(metrics.roomSnapshots)) return;

    const effOut = getEffectiveOutdoorAir();
    const envPayload = {
        t_ext: effOut.tAir,
        rh_ext: effOut.rhAir,
        sun_status: effOut.hasDirectSun ? 'Clear' : sunshineStatus
    };

    const actionGroups = new Map();
    metrics.roomSnapshots.forEach(snap => {
        const zCfg = getZoneConfigByName(snap.name) || { name: snap.name, area: 15, height: 2.5 };
        const rData = DONNEES_HABITAT[snap.name] || { ta: snap.ta, rh: snap.rh };
        const nudge = getRoomActionNudge(snap.name, zCfg, rData, envPayload);
        if (nudge && nudge.actionKey !== 'comfort' && nudge.actionKey !== 'outdoor' && nudge.badgeLabel !== 'Fait') {
            if (!actionGroups.has(nudge.actionKey)) {
                let equipName = "ÉQUIPEMENT";
                let gainHint = "+0.25 PMV";
                let colorBorder = "border-amber-500/50 bg-amber-950/35";
                if (nudge.actionKey === 'open_win_humidity') {
                    equipName = "🪟 FENÊTRE";
                    gainHint = "Air sain • +0.12 PMV";
                    colorBorder = "border-emerald-500/50 bg-emerald-950/35";
                } else if (nudge.actionKey === 'vmc_boost') {
                    equipName = "🌀 VMC";
                    gainHint = "Extraction vapeur • +0.10 PMV";
                    colorBorder = "border-teal-500/50 bg-teal-950/35";
                } else if (nudge.actionKey === 'sun_heat') {
                    equipName = "☀️ VOLETS / RIDEAUX";
                    gainHint = "Chauffage solaire gratuit • +0.30 PMV";
                    colorBorder = "border-amber-400/60 bg-amber-950/40";
                } else if (nudge.actionKey === 'shutter_close') {
                    equipName = "🛡️ VOLETS / RIDEAUX";
                    gainHint = "Bouclier thermique • +0.22 PMV";
                    colorBorder = "border-indigo-400/50 bg-indigo-950/40";
                } else if (nudge.actionKey === 'free_cooling') {
                    equipName = "🪟 FENÊTRES";
                    gainHint = "Rafraîchissement gratuit • +0.35 PMV";
                    colorBorder = "border-sky-400/50 bg-sky-950/40";
                }
                actionGroups.set(nudge.actionKey, {
                    actionKey: nudge.actionKey,
                    equipName,
                    icon: nudge.badgeIcon,
                    label: nudge.badgeLabel,
                    tooltip: nudge.tooltip,
                    gainHint,
                    colorBorder,
                    rooms: []
                });
            }
            actionGroups.get(nudge.actionKey).rooms.push(snap.name);
        }
    });

    // Si fraîcheur globale sans soleil et aucune action d'équipement sur une pièce, signaler l'actionnable Tenue / Thermostat
    if (metrics.avgPMV < -0.35 && actionGroups.size === 0) {
        const worstName = metrics.worstComfortRoom ? metrics.worstComfortRoom.name : "Pièces de vie";
        actionGroups.set('clothing_adjust_warm', {
            actionKey: 'clothing_adjust_warm',
            equipName: "🧥 TENUE / THERMOSTAT",
            icon: "🧥",
            label: "Ajuster tenue (+0.25 Clo) ou appoint",
            tooltip: "Corriger l'inconfort frais immédiat sans fermer les volets en journée.",
            gainHint: "+0.35 PMV • Économie chauffage",
            colorBorder: "border-sky-400/50 bg-sky-950/40",
            rooms: [worstName]
        });
    }

    const totalActionsCount = Array.from(actionGroups.values()).reduce((acc, g) => acc + g.rooms.length, 0);

    const navBadge = document.getElementById('nav-action-badge');
    if (navBadge) {
        if (totalActionsCount > 0) {
            navBadge.textContent = `🔔 ${totalActionsCount}`;
            navBadge.classList.remove('hidden');
        } else {
            navBadge.classList.add('hidden');
        }
    }

    const banner = document.getElementById('live-action-notification-bar');
    if (!banner) return;

    if (actionGroups.size === 0) {
        banner.innerHTML = `
            <div class="bg-emerald-950/35 border border-emerald-500/35 rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div class="flex items-center gap-2 text-emerald-200 font-bold">
                    <span class="text-base">✅</span>
                    <span>Aucune action urgente à réaliser en ce moment : vos équipements et votre confort sont alignés.</span>
                </div>
                <button onclick="voirToutesLesRecommandations()" class="bg-emerald-900/70 hover:bg-emerald-800 text-emerald-100 border border-emerald-500/40 rounded-xl px-3 py-1 text-[11px] font-bold cursor-pointer">
                    📋 Voir les anticipations 24-48h →
                </button>
            </div>
        `;
        return;
    }

    const cardsHtml = Array.from(actionGroups.values()).slice(0, 3).map(g => {
        const roomsStr = g.rooms.slice(0, 3).join(', ') + (g.rooms.length > 3 ? ` +${g.rooms.length - 3}` : '');
        return `
            <div onclick="voirToutesLesRecommandations()" class="rounded-xl border ${g.colorBorder} p-2.5 cursor-pointer hover:scale-[1.01] transition flex items-start justify-between gap-2.5">
                <div class="min-w-0">
                    <div class="flex items-center gap-1.5 flex-wrap mb-1">
                        <span class="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-900/90 text-white border border-white/15">${g.equipName}</span>
                        <span class="text-[10px] font-extrabold text-amber-300 truncate">📍 ${roomsStr}</span>
                    </div>
                    <div class="text-xs font-extrabold text-white leading-snug">${g.icon} ${g.label}</div>
                    <div class="text-[11px] text-slate-300 mt-0.5 leading-snug line-clamp-1">${g.tooltip}</div>
                </div>
                <div class="shrink-0 flex flex-col items-end justify-between gap-1.5">
                    <span class="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-950/90 text-emerald-300 border border-emerald-500/40 whitespace-nowrap">${g.gainHint}</span>
                    <span class="text-[10px] font-bold text-amber-300 underline">Agir →</span>
                </div>
            </div>
        `;
    }).join('');

    banner.innerHTML = `
        <div class="bg-gradient-to-r from-amber-950/50 via-slate-900/95 to-slate-900/95 border-2 border-amber-500/50 rounded-2xl p-3 sm:p-3.5 shadow-lg">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-2.5">
                <div class="flex items-center gap-2">
                    <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-500 text-slate-950 font-black text-xs animate-pulse">🔔</span>
                    <div>
                        <strong class="text-xs sm:text-sm font-black text-white">
                            ${totalActionsCount} action${totalActionsCount > 1 ? 's' : ''} à réaliser maintenant sur vos équipements
                        </strong>
                        <span class="hidden sm:inline text-[11px] text-amber-200/90 ml-2">
                            Cliquez sur une action pour la valider et suivre votre gain PMV & financier
                        </span>
                    </div>
                </div>
                <button onclick="voirToutesLesRecommandations()" class="bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs px-3 py-1.5 rounded-xl cursor-pointer shadow whitespace-nowrap">
                    📋 Ouvrir le Plan d'Action (${totalActionsCount}) →
                </button>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-${Math.min(3, actionGroups.size)} gap-2.5">
                ${cardsHtml}
            </div>
        </div>
    `;
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
    const currentCloElM = document.getElementById('currentCloValue-m');
    const currentCloDescEl = document.getElementById('currentCloDesc');
    const currentCloDescElM = document.getElementById('currentCloDesc-m');
    const totalClo = getBaseCloAndMet(null).totalClo;
    const desc = getClothingDescription(totalClo);

    if (currentCloEl) currentCloEl.textContent = totalClo.toFixed(2); 
    if (currentCloElM) currentCloElM.textContent = totalClo.toFixed(2); 
    if (currentCloDescEl) currentCloDescEl.textContent = desc;
    if (currentCloDescElM) currentCloDescElM.textContent = desc;
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
    if (!Array.isArray(hourlyList) || hourlyList.length === 0) return [];
    const hourly = [];
    const now = new Date();
    const currentH = now.getHours();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime() / 1000;
    const dateKey = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}_${String(now.getDate()).padStart(2, '0')}`;

    // Historique persistant des mesures de la journée pour ne jamais écraser le passé
    let savedHistory = {};
    try {
        const rawHist = localStorage.getItem(`SOLSTICE_DAY_LOG_${dateKey}`);
        if (rawHist) savedHistory = JSON.parse(rawHist);
    } catch(e) {}

    // Plage thermique prévisionnelle (creux nocturne et pic diurne)
    const temps = hourlyList.map(item => item.temp);
    const tMinPrevue = Math.min(...temps);
    const tMaxPrevue = Math.max(...temps);
    const ampPrevue = Math.max(2.0, (tMaxPrevue - tMinPrevue) / 2);
    const tMoyPrevue = (tMaxPrevue + tMinPrevue) / 2;

    for (let h = 0; h < 24; h++) {
        const targetTs = startOfDay + (h * 3600);
        
        let closest = null;
        let minDiff = Infinity;
        for (let i = 0; i < hourlyList.length; i++) {
            const diff = Math.abs(hourlyList[i].dt - targetTs);
            if (diff < minDiff) {
                minDiff = diff;
                closest = hourlyList[i];
            }
        }

        const isDaytime = (h >= 7 && h <= 19);
        let finalTemp = 15;
        let finalHumidity = 60;
        let isSunny = false;

        if (savedHistory[h]) {
            // A. Donnée réelle observée et enregistrée plus tôt aujourd'hui
            finalTemp = savedHistory[h].temp;
            finalHumidity = savedHistory[h].humidity ?? 60;
            isSunny = !!savedHistory[h].isSunny;
        } else if (minDiff <= 2400 && closest) {
            // B. Créneau présent ou futur disponible dans l'API météo
            finalTemp = closest.temp;
            finalHumidity = closest.humidity;
            const weatherMain = closest.weather?.[0]?.main || 'Clouds';
            isSunny = isDaytime && (weatherMain.toLowerCase().includes('clear') || weatherMain.toLowerCase().includes('sun'));
        } else {
            // C. Heure passée non enregistrée : Reconstitution sinusoïdale réaliste (creux à 06h, pic à 15h)
            finalTemp = parseFloat((tMoyPrevue - ampPrevue * Math.cos(((h - 15) * 2 * Math.PI) / 24)).toFixed(1));
            finalHumidity = isDaytime ? 60 : 85;
            // La nuit n'a jamais de soleil direct !
            isSunny = isDaytime && (closest ? (closest.weather?.[0]?.main || '').toLowerCase().includes('clear') : false);
        }

        hourly.push({
            hour: h,
            temp: finalTemp,
            humidity: finalHumidity,
            isSunny: isSunny
        });
    }

    // Mémoriser l'heure actuelle dans l'historique de la journée
    try {
        if (typeof outdoorTemp === 'number') {
            savedHistory[currentH] = {
                temp: outdoorTemp,
                humidity: outdoorHumidity,
                isSunny: (currentH >= 7 && currentH <= 19) && (typeof effOutdoorScan !== 'undefined' ? effOutdoorScan.hasDiffuseSun : (sunshineStatus === 'Clear'))
            };
            localStorage.setItem(`SOLSTICE_DAY_LOG_${dateKey}`, JSON.stringify(savedHistory));
        }
    } catch(e) {}

    return hourly;
}

function processOneCallFutureForecast(hourlyList) {
    if (!Array.isArray(hourlyList) || hourlyList.length === 0) return [];
    const nowTs = Math.floor(Date.now() / 1000);
    // Filtrer les créneaux futurs (jusqu'à 48 heures consécutives)
    const futureSlots = hourlyList.filter(item => item && item.dt && item.dt >= (nowTs - 1800)).slice(0, 48);
    
    const sunriseH = window.solsticeEphemeris?.sunriseHour || 7;
    const sunsetH = window.solsticeEphemeris?.sunsetHour || 19;

    return futureSlots.map(item => {
        const d = new Date(item.dt * 1000);
        const h = d.getHours();
        const isDaytime = (h >= sunriseH && h < sunsetH);
        const weatherMain = item.weather?.[0]?.main || 'Clouds';
        const isSunny = isDaytime && (weatherMain.toLowerCase().includes('clear') || weatherMain.toLowerCase().includes('sun'));

        return {
            dt: item.dt,
            date: d,
            hour: h,
            temp: item.temp,
            humidity: item.humidity,
            weatherMain: weatherMain,
            isSunny: isSunny
        };
    });
}

function generateSyntheticFutureForecast(currentTemp = 15, currentHumidity = 60, isSunnyNow = false) {
    const forecast = [];
    const now = new Date();
    const currentH = now.getHours();
    const sunriseH = window.solsticeEphemeris?.sunriseHour || 7;
    const sunsetH = window.solsticeEphemeris?.sunsetHour || 19;

    // Amplitude thermique journalière typique (creux à l'aube vers 06h, pic vers 15h)
    const amp = 4.0;
    const tMoy = currentTemp - (amp * Math.cos(((currentH - 15) * 2 * Math.PI) / 24));

    for (let step = 0; step < 48; step++) {
        const stepDate = new Date(now.getTime() + step * 3600 * 1000);
        const h = stepDate.getHours();
        const tempSynth = tMoy + amp * Math.cos(((h - 15) * 2 * Math.PI) / 24);
        const isDay = (h >= sunriseH && h < sunsetH);

        forecast.push({
            dt: Math.floor(stepDate.getTime() / 1000),
            date: stepDate,
            hour: h,
            temp: parseFloat(tempSynth.toFixed(1)),
            humidity: Math.round(currentHumidity),
            weatherMain: isSunnyNow ? 'Clear' : 'Clouds',
            isSunny: isDay && isSunnyNow
        });
    }
    return forecast;
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
                try { localStorage.setItem('SOLSTICE_EPHEMERIS', JSON.stringify(window.solsticeEphemeris)); } catch(e) {}
            }

            if (Array.isArray(data.hourly)) {
                window.hourlyExtForecast = processOneCallHourlyForecast(data.hourly);
                window.futureHourlyForecast = processOneCallFutureForecast(data.hourly);
                localStorage.setItem('SOLSTICE_HOURLY_FORECAST', JSON.stringify(window.hourlyExtForecast));
                localStorage.setItem('SOLSTICE_FUTURE_FORECAST', JSON.stringify(window.futureHourlyForecast));
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

            const envPayload = {
                t_ext: outdoorTemp,
                rh_ext: outdoorHumidity,
                sun_status: sunshineStatus,
                wind_speed: outdoorWind,
                p_ext: outdoorPressure
            };
            localStorage.setItem('SOLSTICE_ENV_DATA', JSON.stringify(envPayload));
            
            if (typeof DONNEES_HABITAT === 'object') {
                DONNEES_HABITAT['__ENV__'] = {
                    outdoorTemp,
                    outdoorHumidity,
                    outdoorWind,
                    sunshineStatus,
                    hourlyExtForecast: window.hourlyExtForecast,
                    futureHourlyForecast: window.futureHourlyForecast
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
        btn.innerHTML = "⏳ Scan...";
        btn.style.backgroundColor = "#475569";
    }

    try {
        const response = await fetch('https://hook.eu1.make.com/0jz9xnz6phk3nmn5pdwkijlylowdxosd');
        if (!response.ok) throw new Error("Erreur Serveur Make (HTTP " + response.status + ")");
        
        const rawData = await response.json();
        const dataPack = Array.isArray(rawData) ? rawData : (rawData.data || rawData.sensors || []);
        
        const zonesConfig = GLOBAL_HOUSE_CONFIG.zones || GLOBAL_HOUSE_CONFIG;
        const zonesArray = Object.values(zonesConfig || {});

        for (const capteur of dataPack) {
            const idCapteur = capteur.id;
            
            const zone = zonesArray.find(z => z && (z.sensorId === idCapteur || z.id === idCapteur));
            const nomPiece = zone ? (zone.name || zone.nom || zone.title) : null;
            
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

        const effOutdoorScan = getEffectiveOutdoorAir();
        DONNEES_HABITAT['__ENV__'] = {
            outdoorTemp: effOutdoorScan.tAir,
            outdoorHumidity: effOutdoorScan.rhAir,
            outdoorWind,
            sunshineStatus: effOutdoorScan.hasDirectSun ? 'Clear' : sunshineStatus,
            hourlyExtForecast: window.hourlyExtForecast,
            t_ext_garden: effOutdoorScan.gardenSensor?.ta,
            rh_ext_garden: effOutdoorScan.gardenSensor?.rh,
            t_ext_street: effOutdoorScan.streetSensor?.ta,
            rh_ext_street: effOutdoorScan.streetSensor?.rh,
            delta_t_sun: effOutdoorScan.deltaSun,
            has_direct_sun: effOutdoorScan.hasDirectSun,
            source: effOutdoorScan.source
        };
        DONNEES_HABITAT['__BUFFER_TOGGLE__'] = includeBufferZones;

        if (window.SolsticeStore && window.SolsticeStore.saveScanData) {
            window.SolsticeStore.saveScanData(DONNEES_HABITAT);
        }

        actualiserCockpitGlobal();
        
    } catch (error) { 
        console.error("Erreur Bulk Scan:", error); 
        alert("❌ Erreur lors du scan des capteurs : " + (error.message || error)); 
    } finally {
        if (btn) {
            btn.innerHTML = "⚡ Super Scan";
            btn.style.backgroundColor = "";
        }
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

    sessionStorage.setItem('currentZoneId', 'all'); 
    sessionStorage.setItem('calculatedPMV', pmv);
    sessionStorage.setItem('indoorAirTemp', DONNEES_HABITAT[nomPiece].ta);
    sessionStorage.setItem('indoorHumidity', DONNEES_HABITAT[nomPiece].rh);
    const effOutdoorRec = getEffectiveOutdoorAir();
    sessionStorage.setItem('outdoorTemp', effOutdoorRec.tAir);
    sessionStorage.setItem('outdoorHumidity', effOutdoorRec.rhAir);
    sessionStorage.setItem('sunshineStatus', effOutdoorRec.hasDirectSun ? 'Clear' : sunshineStatus);

    const envPayload = {
        t_ext: effOutdoorRec.tAir,
        rh_ext: effOutdoorRec.rhAir,
        sun_status: effOutdoorRec.hasDirectSun ? 'Clear' : sunshineStatus,
        wind_speed: outdoorWind,
        p_ext: outdoorPressure,
        t_ext_garden: effOutdoorRec.gardenSensor?.ta,
        rh_ext_garden: effOutdoorRec.gardenSensor?.rh,
        t_ext_street: effOutdoorRec.streetSensor?.ta,
        rh_ext_street: effOutdoorRec.streetSensor?.rh,
        delta_t_sun: effOutdoorRec.deltaSun,
        has_direct_sun: effOutdoorRec.hasDirectSun,
        source: effOutdoorRec.source
    };
    localStorage.setItem('SOLSTICE_ENV_DATA', JSON.stringify(envPayload));

    window.location.href = `reco.html?zone=all`;
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
    updateStructureTemperature: typeof updateStructureTemperature !== 'undefined' ? updateStructureTemperature : null,
    calculateDynamicTau: typeof calculateDynamicTau !== 'undefined' ? calculateDynamicTau : null,
    calculateStructureReserve: typeof calculateStructureReserve !== 'undefined' ? calculateStructureReserve : null,
    calculateZone2R2CParams: typeof calculateZone2R2CParams !== 'undefined' ? calculateZone2R2CParams : null,
    calculateWindowSolarGainW: typeof calculateWindowSolarGainW !== 'undefined' ? calculateWindowSolarGainW : null,
    calculateDailyThermalBalance: typeof calculateDailyThermalBalance !== 'undefined' ? calculateDailyThermalBalance : null,
    evaluateSimulatedPMV: typeof evaluateSimulatedPMV !== 'undefined' ? evaluateSimulatedPMV : null,
    calculateAbsoluteHumidity: typeof calculateAbsoluteHumidity !== 'undefined' ? calculateAbsoluteHumidity : null,
    calculateDifferentialVentilation: typeof calculateDifferentialVentilation !== 'undefined' ? calculateDifferentialVentilation : null,
    getRoomActionNudge: typeof getRoomActionNudge !== 'undefined' ? getRoomActionNudge : null,
    calculateHabitatAccordageScore: typeof calculateHabitatAccordageScore !== 'undefined' ? calculateHabitatAccordageScore : null,
    calculateHabitatHarmonyScore: typeof calculateHabitatHarmonyScore !== 'undefined' ? calculateHabitatHarmonyScore : (typeof calculateHabitatAccordageScore !== 'undefined' ? calculateHabitatAccordageScore : null),
    hasOpenableWindows: typeof hasOpenableWindows !== 'undefined' ? hasOpenableWindows : null,

    evaluateSimulatedPMV(baseState, checkedActionKeys, envData) {
        let simTa = baseState.ta;
        let simTr = baseState.tr;
        let simVel = baseState.vel;
        let simRh = baseState.rh;
        let simClo = baseState.clo;
        const rf = (baseState.reactivityFactor !== undefined && !isNaN(baseState.reactivityFactor)) ? baseState.reactivityFactor : 1.0;
        const tExt = (envData && typeof envData.t_ext === 'number') ? envData.t_ext : 12;
        const isColdSituation = (baseState.ta < 21.5 && tExt < baseState.ta);

        // 1. Volets / Rideaux : distinction stricte entre protection solaire d'été et bouclier thermique d'hiver
        if (checkedActionKeys.includes('shutter_close_night') || checkedActionKeys.includes('thermal_curtain')) {
            simTr += 0.45 * rf;
            simTa += 0.15 * rf;
        }
        if (checkedActionKeys.includes('shutter_close') || checkedActionKeys.includes('anticipate_sun')) {
            if (isColdSituation) {
                simTr += 0.40 * rf;
                simTa += 0.15 * rf;
            } else {
                simTr -= 0.60 * rf;
                simTa -= 0.20 * rf;
            }
        }
        // 2. Surventilation / Free-cooling
        if (checkedActionKeys.includes('free_cooling')) {
            simTa = Math.max(tExt, simTa - 0.55 * rf);
            simTr -= 0.40 * rf;
        }
        // 3. Brasseur d'air (Été : rafraîchissement convectif | Hiver : destratification sous plafond haut)
        if (checkedActionKeys.includes('fan_on')) {
            simVel += 0.25 * rf;
        }
        if (checkedActionKeys.includes('fan_destrat')) {
            simTa += 0.45 * rf;
            simTr += 0.20 * rf;
        }
        // 4. Purge humidité (aération flash ou VMC) & réduction VMC en air sec froid
        if (checkedActionKeys.includes('vmc_boost') || checkedActionKeys.includes('open_win_humidity')) {
            simRh = Math.max(45, simRh - 6 * rf);
            if (isColdSituation) simTr += 0.10 * rf;
        }
        if (checkedActionKeys.includes('vmc_reduce_cold')) {
            simTa += 0.25 * rf;
            simRh = Math.min(50, simRh + 4 * rf);
        }
        // 5. Apports solaires gratuits (court terme et pré-charge 48h)
        if (checkedActionKeys.includes('sun_heat')) {
            simTr += 0.65 * rf;
            simTa += 0.25 * rf;
        }
        // 6. Actionnables de confort & sobriété (Tenue Clo, Thermostat/Robinet, Plancher, Climatisation)
        if (checkedActionKeys.includes('clothing_adjust_warm')) {
            simClo += 0.25 * rf;
        }
        if (checkedActionKeys.includes('clothing_adjust_cool')) {
            simClo = Math.max(0.3, simClo - 0.20 * rf);
        }
        if (checkedActionKeys.includes('heating_boost_comfort') || checkedActionKeys.includes('floor_inertia')) {
            simTa += 0.60 * rf;
            simTr += 0.35 * rf;
        }
        if (checkedActionKeys.includes('heating_cut')) {
            if (baseState.ta > 21.0) {
                simTa -= 0.45 * rf;
            }
        }
        if (checkedActionKeys.includes('cooling_setpoint_eco')) {
            if (baseState.ta < 24.5) {
                simTa += 0.35 * rf;
            }
        }

        const pmvSim = this.calculatePMV(simTa, simTr, simVel, simRh, baseState.met, simClo);
        return { pmv: pmvSim, simTa, simTr, simVel, simRh, simClo };
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
