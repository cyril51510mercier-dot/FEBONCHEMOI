/**
 * ==================================================================
 * SOLSTICE — MOTEUR DE RECOMMANDATIONS & CYCLE DE VIE (V7.4)
 * CALCUL THERMODYNAMIQUE DYNAMIQUE DES KWH (Béton / DPE 3CL)
 * ==================================================================
 */

document.addEventListener('DOMContentLoaded', function() {
    // Initialisation forcée de la source de données
    if (window.SolsticeStore && typeof window.SolsticeStore.init === 'function') {
        window.SolsticeStore.init();
    }
    
    try {
        // Accès sécurisé avec fallbacks
        const store = window.SolsticeStore || {};
        const engine = window.SolsticeEngine || {};

        const houseConfig = (store.getZones && store.getZones()) || {};
        const donneesHabitat = (store.getScanData && store.getScanData()) || {};
        
        function loadCurrentEnvData() {
            let tExt = 15, rhExt = 60, sunStatus = 'clear';

            // 1. SessionStorage (passé au clic depuis index.html)
            const sessT = sessionStorage.getItem('outdoorTemp');
            const sessRh = sessionStorage.getItem('outdoorHumidity');
            const sessSun = sessionStorage.getItem('sunshineStatus');
            if (sessT !== null && !isNaN(parseFloat(sessT))) tExt = parseFloat(sessT);
            if (sessRh !== null && !isNaN(parseFloat(sessRh))) rhExt = parseFloat(sessRh);
            if (sessSun) sunStatus = sessSun;

            // 2. LocalStorage SOLSTICE_ENV_DATA
            try {
                const rawEnv = localStorage.getItem('SOLSTICE_ENV_DATA');
                if (rawEnv) {
                    const p = JSON.parse(rawEnv);
                    if (typeof p.t_ext === 'number') tExt = p.t_ext;
                    if (typeof p.rh_ext === 'number') rhExt = p.rh_ext;
                    if (p.sun_status) sunStatus = p.sun_status;
                }
            } catch (e) {}

            // 3. Direct outdoorTemp / outdoorHumidity
            const locT = localStorage.getItem('outdoorTemp');
            const locRh = localStorage.getItem('outdoorHumidity');
            if (locT !== null && !isNaN(parseFloat(locT))) tExt = parseFloat(locT);
            if (locRh !== null && !isNaN(parseFloat(locRh))) rhExt = parseFloat(locRh);
            if (localStorage.getItem('sunshineStatus')) sunStatus = localStorage.getItem('sunshineStatus');

            // 4. Scan Data __ENV__ et détection directe in situ
            const scanData = (store.getScanData && store.getScanData()) || {};
            if (scanData['__ENV__']) {
                const env = scanData['__ENV__'];
                if (typeof env.outdoorTemp === 'number') tExt = env.outdoorTemp;
                if (typeof env.outdoorHumidity === 'number') rhExt = env.outdoorHumidity;
                if (env.sunshineStatus) sunStatus = env.sunshineStatus;
            }

            let gardenT = null, gardenRh = null, streetT = null, streetRh = null;
            for (const [nom, d] of Object.entries(scanData)) {
                if (nom === '__ENV__' || nom === '__BUFFER_TOGGLE__') continue;
                const low = nom.toLowerCase();
                if ((low.includes('jardin') || low.includes('gouttiere') || low.includes('gouttière')) && d && typeof d.ta === 'number' && !isNaN(d.ta)) {
                    gardenT = d.ta;
                    gardenRh = d.rh;
                }
                if ((low.includes('rue') || low.includes('appui') || low.includes('fenetre rue') || low.includes('fenêtre rue')) && d && typeof d.ta === 'number' && !isNaN(d.ta)) {
                    streetT = d.ta;
                    streetRh = d.rh;
                }
            }

            if (gardenT !== null) {
                tExt = gardenT;
                if (gardenRh !== null) rhExt = gardenRh;
            }

            let deltaTSun = 0;
            if (gardenT !== null && streetT !== null) {
                deltaTSun = parseFloat((streetT - gardenT).toFixed(1));
                if (deltaTSun >= 4.0) sunStatus = 'clear';
                else if (deltaTSun >= 2.0) sunStatus = 'partlycloudy';
            }

            return {
                t_ext: tExt,
                rh_ext: rhExt,
                sun_status: sunStatus,
                delta_t_sun: deltaTSun,
                t_ext_garden: gardenT,
                t_ext_street: streetT,
                t_ext_max: tExt + 3,
                t_ext_min: tExt - 5
            };
        }

        const envDataGlobal = loadCurrentEnvData();

        let currentZoneId = 'all';
        sessionStorage.setItem('currentZoneId', 'all');

        const zoneSelect = document.getElementById('zoneSelect');
        const containerImmediate = document.getElementById('container-immediate');
        const containerAnticipated = document.getElementById('container-anticipated');
        const containerStrategic = document.getElementById('container-strategic');
        const containerCompleted = document.getElementById('container-completed');
        const profileIndicator = document.getElementById('profileIndicator');

        const TODAY_KEY = new Date().toISOString().slice(0, 10);
        
        function getRecoLifecycleState() {
            try {
                const raw = localStorage.getItem('SOLSTICE_RECO_LIFECYCLE');
                const state = raw ? JSON.parse(raw) : { lastDate: TODAY_KEY, recos: {} };
                if (state.lastDate !== TODAY_KEY) {
                    // 1. Archiver les points et gains de la veille dans la cagnotte historique permanente
                    let prevDayPts = 0;
                    let prevDayEur = 0;
                    if (state.recos) {
                        Object.values(state.recos).forEach(item => {
                            if (item.status === 'completed') {
                                const pts = item.earnedPoints !== undefined ? item.earnedPoints : (item.impactWeight || 15);
                                prevDayPts += pts;
                                if (item.savedEur) prevDayEur += item.savedEur;
                            }
                        });
                    }
                    if (prevDayPts > 0) {
                        const curPts = parseInt(localStorage.getItem('SOLSTICE_CAGNOTTE_SCORE_PTS')) || 0;
                        localStorage.setItem('SOLSTICE_CAGNOTTE_SCORE_PTS', curPts + prevDayPts);
                    }
                    if (prevDayEur > 0) {
                        const curEur = parseFloat(localStorage.getItem('SOLSTICE_CAGNOTTE_EUR')) || 0;
                        localStorage.setItem('SOLSTICE_CAGNOTTE_EUR', (curEur + prevDayEur).toFixed(2));
                    }

                    // 2. Nouveau jour : vider les actions effectuées du jour précédent
                    state.lastDate = TODAY_KEY;
                    state.recos = {}; 
                    localStorage.setItem('SOLSTICE_RECO_LIFECYCLE', JSON.stringify(state));
                }
                return state;
            } catch (e) {
                return { lastDate: TODAY_KEY, recos: {} };
            }
        }

        function saveRecoLifecycleState(state) {
            localStorage.setItem('SOLSTICE_RECO_LIFECYCLE', JSON.stringify(state));
        }

        let lifecycleState = getRecoLifecycleState();

        // Formatage humain du délai écoulé
        function formatElapsedTime(elapsedMs) {
            const min = Math.max(0, Math.round(elapsedMs / 60000));
            if (min < 2) return "À l'instant";
            if (min < 60) return `Il y a ${min} min`;
            const h = Math.floor(min / 60);
            const remMin = min % 60;
            if (h < 24) return `Il y a ${h}h${remMin > 0 ? (remMin < 10 ? '0' : '') + remMin : ''}`;
            const d = Math.floor(h / 24);
            return `Il y a ${d} jour${d > 1 ? 's' : ''}`;
        }

        // Calcul dynamique du facteur de réactivité et points selon le niveau
        function getActionTimeInfo(rec, lifecycleItem) {
            const now = Date.now();
            const appearedAt = (lifecycleItem && lifecycleItem.appearedAt) || rec.appearedAt || now;
            const isCompleted = lifecycleItem && lifecycleItem.status === 'completed';
            const refTime = isCompleted ? (lifecycleItem.completedAt || now) : now;
            const elapsedMs = Math.max(0, refTime - appearedAt);
            const elapsedMin = Math.round(elapsedMs / 60000);
            const elapsedText = formatElapsedTime(elapsedMs);

            let factor = 1.0;
            const level = rec.level || 1;

            if (level === 1) {
                // Niveau 1 : Immédiat / Flash (optimal < 45 min)
                if (elapsedMin <= 45) factor = 1.0;
                else if (elapsedMin <= 120) factor = 0.80;
                else if (elapsedMin <= 240) factor = 0.60;
                else factor = 0.50;
            } else if (level === 2) {
                // Niveau 2 : Anticipation 24h (optimal < 3h)
                if (elapsedMin <= 180) factor = 1.0;
                else if (elapsedMin <= 360) factor = 0.80;
                else factor = 0.60;
            } else {
                // Niveau 3 : Stratégie météo 48-72h (optimal < 12h)
                if (elapsedMin <= 720) factor = 1.0;
                else factor = 0.75;
            }

            const currentPoints = Math.max(1, Math.round((rec.impactWeight || 15) * factor));
            const percent = Math.round(factor * 100);

            let delayClass = 'delay-fast';
            if (percent < 70) delayClass = 'delay-slow';
            else if (percent < 90) delayClass = 'delay-medium';

            return {
                elapsedMs,
                elapsedMin,
                elapsedText,
                factor,
                percent,
                currentPoints,
                delayClass
            };
        }

        // Gestion des réitérations et multi-occurrences dans la journée
        function resolveOccurrenceForRec(baseId, actionKey) {
            const matchingCompleted = Object.values(lifecycleState.recos || {}).filter(item => {
                const matchBase = item.baseId === baseId || (item.id && (item.id === baseId || item.id.startsWith(baseId + '#')));
                return matchBase && item.status === 'completed';
            });

            const countCompleted = matchingCompleted.length;
            if (countCompleted > 0) {
                // Vérifier le délai écoulé depuis la dernière réalisation
                const last = matchingCompleted.slice().sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))[0];
                const cooldownMs = 45 * 60 * 1000; // Cooldown minimal de 45 minutes
                const timeSinceLast = Date.now() - (last.completedAt || 0);

                if (timeSinceLast < cooldownMs) {
                    // L'action vient d'être faite, ambiance en cours d'ajustement
                    return { shouldEmit: false, occurrence: countCompleted };
                }

                return {
                    shouldEmit: true,
                    occurrence: countCompleted + 1,
                    id: `${baseId}#${countCompleted + 1}`,
                    baseId
                };
            }

            return {
                shouldEmit: true,
                occurrence: 1,
                id: `${baseId}#1`,
                baseId
            };
        }

        const globalConfig = houseConfig.global || {};
        const forcedSeason = globalConfig.forcedSeason;
        const manualHeating = globalConfig.heatingSeasonActive;
        const autoHeating = envDataGlobal.t_ext < 15;
        const isHeatingSeasonActive = (forcedSeason === 'heating') 
            ? true 
            : ((forcedSeason === 'auto') 
                ? autoHeating 
                : (manualHeating !== undefined && manualHeating !== null ? manualHeating : autoHeating));

        if (profileIndicator) {
            profileIndicator.textContent = `⚖️ Arbitrage libre Court Terme (Confort immédiat) ↔ Long Terme (Inertie des parois & Économies 24-72h)`;
        }

        const nowDate = new Date();
        const currentHour = nowDate.getHours();
        const currentMonth = nowDate.getMonth();
        let savedEphem = window.solsticeEphemeris || null;
        if (!savedEphem) {
            try {
                const rawEphem = localStorage.getItem('SOLSTICE_EPHEMERIS');
                if (rawEphem) savedEphem = JSON.parse(rawEphem);
            } catch (e) {}
        }
        const defaultSunriseByMonth = [8, 8, 7, 7, 6, 6, 6, 7, 7, 8, 8, 8];
        const defaultSunsetByMonth  = [17, 18, 19, 20, 21, 21, 21, 20, 19, 18, 17, 17];
        const sunriseHour = (savedEphem && typeof savedEphem.sunriseHour === 'number') ? savedEphem.sunriseHour : defaultSunriseByMonth[currentMonth];
        const sunsetHour  = (savedEphem && typeof savedEphem.sunsetHour === 'number') ? savedEphem.sunsetHour : defaultSunsetByMonth[currentMonth];

        const isNight = currentHour >= sunsetHour || currentHour < sunriseHour;
        const isMorning = !isNight && currentHour >= sunriseHour && currentHour < 12;
        const isAfternoon = !isNight && currentHour >= 12 && currentHour < sunsetHour;
        const isEvening = currentHour >= (sunsetHour - 1) && currentHour < 23;

        const tExtMaxDay = envDataGlobal.t_ext_max || (envDataGlobal.t_ext + 3);
        const tExtMinDay = envDataGlobal.t_ext_min || (envDataGlobal.t_ext - 5);

        // Vérifie si une pièce possède réellement au moins un vitrage exposé au soleil à l'heure actuelle (ou dans la journée)
        function getZoneSolarExposure(zone, checkHour = currentHour, wholeAfternoon = false) {
            if (!zone || !Array.isArray(zone.windows) || zone.windows.length === 0) {
                return { isExposedNow: false, hasSouthOrWest: false, exposedLabel: '' };
            }
            const activeSectorsNow = checkHour < 11
                ? ['E', 'SE', 'S']
                : (checkHour <= 14 ? ['E', 'SE', 'S', 'SW'] : ['S', 'SW', 'W']);
            const targetSectors = wholeAfternoon ? ['S', 'SE', 'SW', 'W'] : activeSectorsNow;

            const matchingOrients = new Set();
            let hasSouthOrWest = false;
            zone.windows.forEach(w => {
                if (!w) return;
                const rawOr = w.orient || w.orientation || 'S';
                const orients = Array.isArray(rawOr) ? rawOr : [rawOr];
                orients.forEach(o => {
                    const up = String(o).toUpperCase().trim();
                    if (['S', 'SE', 'SW', 'W'].includes(up)) hasSouthOrWest = true;
                    if (targetSectors.includes(up)) matchingOrients.add(up);
                });
            });

            return {
                isExposedNow: matchingOrients.size > 0,
                hasSouthOrWest,
                exposedLabel: Array.from(matchingOrients).join(' / ')
            };
        }

        // Irradiance solaire estimée (W/m²) selon statut météo
        function getSolarIrradiance() {
            const status = (envDataGlobal.sun_status || '').toLowerCase();
            if (status.includes('clear') || status.includes('sun') || status.includes('ensoleillé')) return 700;
            if (status.includes('partly') || status.includes('éclaircies')) return 350;
            return 120;
        }

        function isExteriorZone(zId, zone) {
            const id = (zId || '').toLowerCase();
            const name = (zone?.name || '').toLowerCase();
            return id.includes('exterieur') || id.includes('jardin') || id.includes('rue') ||
                   name.includes('extérieur') || name.includes('jardin') || name.includes('rue') ||
                   zone?.usages?.includes('outdoor');
        }

        function isBufferZone(zId, zone) {
            const id = (zId || '').toLowerCase();
            const name = (zone?.name || '').toLowerCase();
            return id.includes('garage') || id.includes('cave') || id.includes('cellier') ||
                   name.includes('garage') || name.includes('cave') || name.includes('cellier') ||
                   zone?.usages?.includes('buffer') || zone?.usages?.includes('unheated');
        }

        function getAbsoluteHumidity(ta, rh) {
            const pSat = 6.112 * Math.exp((17.67 * ta) / (ta + 243.5));
            const pv = pSat * (rh / 100);
            return (216.7 * pv) / (ta + 273.15);
        }

        function getEnergyCostPerKwh(zoneConfig) {
            const energyType = zoneConfig?.equipment?.heating?.energySource || globalConfig?.mainEnergySource || 'elec_direct';
            const energyCosts = {
                elec_direct: 0.2516,
                pac_air_eau: 0.2516 / 3.2,
                pac_air_air: 0.2516 / 3.0,
                gaz_condens: 0.1180,
                granules: 0.0890,
                fioul: 0.1350
            };
            return energyCosts[energyType] || 0.2516;
        }

        function getGeneratorEfficiency(zoneConfig) {
            const energyType = zoneConfig?.equipment?.heating?.energySource || globalConfig?.mainEnergySource || 'elec_direct';
            const efficiencies = {
                elec_direct: 1.0,
                pac_air_eau: 3.2,
                pac_air_air: 3.0,
                gaz_condens: 0.95,
                granules: 0.85,
                fioul: 0.88
            };
            return efficiencies[energyType] || 1.0;
        }

        function getAvailableZonesMap() {
            const zonesMap = {};
            Object.keys(houseConfig).forEach(zId => {
                if (zId !== 'global' && !isExteriorZone(zId, houseConfig[zId])) {
                    zonesMap[zId] = houseConfig[zId].name || zId;
                }
            });
            Object.keys(donneesHabitat).forEach(roomName => {
                if (roomName === '__ENV__' || roomName === '__BUFFER_TOGGLE__') return;
                const zId = roomName.toLowerCase().replace(/[^a-z0-9]/g, '_');
                if (!isExteriorZone(zId, houseConfig[zId]) && !zonesMap[zId] && !Object.values(zonesMap).includes(roomName)) {
                    zonesMap[zId] = roomName;
                }
            });
            if (Object.keys(zonesMap).length === 0) zonesMap['salon'] = 'Salon';
            return zonesMap;
        }

        function setupZoneSelector() {
            if (!zoneSelect) return;
            zoneSelect.innerHTML = '';
            const zonesMap = getAvailableZonesMap();

            Object.keys(zonesMap).forEach(zId => {
                const opt = document.createElement('option');
                opt.value = zId;
                opt.textContent = `📍 ${zonesMap[zId]}`;
                if (zId === currentZoneId || zonesMap[zId] === currentZoneId) opt.selected = true;
                zoneSelect.appendChild(opt);
            });

            const optAll = document.createElement('option');
            optAll.value = 'all';
            optAll.textContent = '🌐 Toutes les pièces';
            if (currentZoneId === 'all') optAll.selected = true;
            zoneSelect.appendChild(optAll);
        }

        // ============================================================
        // GENERATION DES RECOMMANDATIONS CONDITIONNEES
        // ============================================================
        function generateRecommendationsForZone(zone, zoneId, roomData) {
            const recs = [];
            if (isExteriorZone(zoneId, zone)) return recs;

            const isBuffer = isBufferZone(zoneId, zone);
            const isWetRoom = zone?.usages?.includes('kitchen') || zone?.usages?.includes('bath');
            const zoneName = zone ? (zone.name || zoneId) : zoneId;
            const ta = roomData ? (roomData.ta ?? 20) : 20;
            const rh = roomData ? (roomData.rh ?? 50) : 50;

            const area = parseFloat(zone?.area) || 15;
            const height = parseFloat(zone?.height) || 2.5;
            const volume = area * height;
            const tau = engine.calculateDynamicTau ? engine.calculateDynamicTau(zone) : 18;

            const params2R2C = engine.calculateZone2R2CParams ? engine.calculateZone2R2CParams(zone) : null;
            const tStruct = engine.updateStructureTemperature ? engine.updateStructureTemperature(zoneName, ta) : ta;
            const rawReserve = engine.calculateStructureReserve
                ? engine.calculateStructureReserve(tStruct, ta, volume, tau, params2R2C ? { hTotalWPerK: params2R2C.hTotal, hCiWPerK: params2R2C.hCi } : {})
                : {};

            const chargeCalories = Math.max(0, Math.min(100, Math.round(((tStruct - 15) / (22 - 15)) * 100)));
            const chargeFrigories = Math.max(0, Math.min(100, Math.round(((26 - tStruct) / (26 - 18)) * 100)));

            const reserve = {
                ...rawReserve,
                chargeCalories: isNaN(chargeCalories) ? 50 : chargeCalories,
                chargeFrigories: isNaN(chargeFrigories) ? 50 : chargeFrigories
            };

            const ahInt = getAbsoluteHumidity(ta, rh);
            const ahExt = getAbsoluteHumidity(envDataGlobal.t_ext, envDataGlobal.rh_ext || 60);
            const deltaAh = ahInt - ahExt;
            const mEau = Math.max(0, Math.round(deltaAh * volume));
            const nbVerres = Math.max(1, Math.round(mEau / 150));
            const verresTxt = `~${nbVerres} verre${nbVerres > 1 ? 's' : ''} d'eau`;

            const tr = engine.calculateMeanRadiantTemp ? engine.calculateMeanRadiantTemp(zone, ta, tStruct) : ta;
            const vel = engine.calculateAirVelocity ? engine.calculateAirVelocity(zone, zoneName) : 0.1;
            const { met, totalClo } = engine.getBaseCloAndMet ? engine.getBaseCloAndMet(zone) : { met: 1.2, totalClo: 1.0 };

            const roomPmv = engine.calculatePMV ? engine.calculatePMV(ta, tr, vel, rh, met, totalClo) : 0;
            const needsHeat = roomPmv < -0.4;
            const needsCooling = roomPmv > 0.4;
            // La nuit, il n'y a jamais d'ensoleillement direct (évite de recommander d'ouvrir les volets au soleil à 18h en hiver)
            const isSunny = !isNight && (
                (envDataGlobal.sun_status || '').toLowerCase().includes('clear') ||
                (envDataGlobal.sun_status || '').toLowerCase().includes('sun') ||
                (envDataGlobal.delta_t_sun || 0) >= 3.0
            );
            const solarExp = getZoneSolarExposure(zone, currentHour, false);
            const solarExpDay = getZoneSolarExposure(zone, currentHour, true);

            function hasOpenableWindows(z) {
                if (!z || !Array.isArray(z.windows) || z.windows.length === 0) return false;
                return z.windows.some(w => {
                    if (!w || !w.vent) return false;
                    const v = String(w.vent).toLowerCase().trim();
                    return v === 'total' || v === 'battante' || v === 'partial' || v === 'oscillo_battante' || v === 'oscillante' || v === 'coulissante';
                });
            }

            const canOpenWindows = hasOpenableWindows(zone);
            const mainVentType = zone?.windows?.find(w => w.vent && w.vent !== 'fixe' && w.vent !== 'fixed')?.vent || 'battante';

            const extShutterTypes = ['roulant_pvc', 'roulant_metal', 'battant_bois', 'persienne', 'store_banne'];
            const intShutterTypes = ['rideau_interieur', 'store_interieur'];
            const hasExteriorShutters = Array.isArray(zone?.windows) && zone.windows.length > 0
                ? zone.windows.some(w => !w.shutter || extShutterTypes.includes(w.shutter))
                : true;
            const hasInteriorCurtains = Array.isArray(zone?.windows) && zone.windows.some(w => intShutterTypes.includes(w.shutter));
            const hasAnyShutterOrCurtain = hasExteriorShutters || hasInteriorCurtains;

            // VMC réellement actionnable par l'occupant (marche forcée ou trappe réglable, hors VMC continue non pilotable)
            const vmcSys = zone?.equipment?.vmcSystem || 'none';
            const hasActionableVmc = (vmcSys === 'marche_forcee' || vmcSys === 'trappe');
            const vmcActionLabel = (vmcSys === 'trappe') ? 'Ouvrir la bouche/trappe VMC' : 'Activer la VMC (marche forcée)';

            const heatingSys = zone?.equipment?.heating?.system || 'none';
            const hasHeating = heatingSys !== 'none' && heatingSys !== 'aucun';
            const heatingRegs = Array.isArray(zone?.equipment?.heating?.regulation) ? zone.equipment.heating.regulation : [];
            const regDeviceLabel = heatingRegs.includes('thermostatic_valve')
                ? 'le robinet thermostatique'
                : (heatingRegs.includes('thermostat_central') ? 'le thermostat central' : 'la consigne de chauffage');

            const coolingSys = zone?.equipment?.cooling?.system || 'aucun';
            const hasCooling = coolingSys !== 'aucun' && coolingSys !== 'none';
            const fanSys = zone?.equipment?.fanSystem || 'aucun';
            const hasFan = fanSys !== 'aucun' && fanSys !== 'none';
            const hasRoofWin = Array.isArray(zone?.windows) && zone.windows.some(w => w.tilt === 'inclinee' || w.tilt === 'horizontale');

            // Paramètres physiques 2R2C réels de la pièce (conductances H_total, H_windows, H_ventilation et surfaces vitrées)
            const hTotalRoomWPerK = (params2R2C && params2R2C.hTotal > 0) ? params2R2C.hTotal : (volume * 0.75);
            const glassUMap = { single: 5.7, double_old: 2.8, double_standard: 1.5, double_recent: 1.2, triple: 0.7 };
            const shutterDeltaRMap = {
                roulant_pvc: 0.22,
                battant_bois: 0.20,
                roulant_metal: 0.15,
                persienne: 0.12,
                store_banne: 0.08,
                rideau_interieur: 0.09,
                store_interieur: 0.07
            };

            let realWindowAreaM2 = 0;
            let deltaHShuttersWPerK = 0;
            if (Array.isArray(zone?.windows) && zone.windows.length > 0) {
                zone.windows.forEach(w => {
                    const wA = parseFloat(w.area) || 0;
                    if (wA <= 0) return;
                    realWindowAreaM2 += wA;
                    const uW = glassUMap[w.glass] || 1.5;
                    const dR = shutterDeltaRMap[w.shutter] || (w.shutter && w.shutter !== 'aucun' ? 0.15 : 0);
                    if (dR > 0) {
                        const uClosed = 1 / ((1 / uW) + dR);
                        deltaHShuttersWPerK += wA * Math.max(0.15, uW - uClosed);
                    }
                });
            } else {
                realWindowAreaM2 = area * 0.16;
                deltaHShuttersWPerK = realWindowAreaM2 * 0.35;
            }

            // Métadonnées visuelles de l'actionnable équipé pour l'affichage direct
            function getActionableVisualMeta(actionKey) {
                const map = {
                    open_win_humidity:    { icon: '🪟', equip: 'FENÊTRE', bg: '#e0f2fe', color: '#0369a1', border: '#7dd3fc' },
                    free_cooling:         { icon: '🪟', equip: 'FENÊTRE', bg: '#dbeafe', color: '#1d4ed8', border: '#93c5fd' },
                    vmc_boost:            { icon: '🌀', equip: 'VMC PILOTABLE', bg: '#ccfbf1', color: '#0f766e', border: '#5eead4' },
                    vmc_reduce_cold:      { icon: '🌀', equip: 'VMC PILOTABLE', bg: '#f0fdfa', color: '#115e59', border: '#99f6e4' },
                    shutter_close:        { icon: '🛡️', equip: 'VOLETS / STORES', bg: '#fef3c7', color: '#b45309', border: '#fcd34d' },
                    anticipate_sun:       { icon: '🛡️', equip: 'VOLETS / STORES', bg: '#ffedd5', color: '#c2410c', border: '#fdba74' },
                    sun_heat:             { icon: '☀️', equip: 'VOLETS / RIDEAUX', bg: '#fef9c3', color: '#a16207', border: '#fde047' },
                    shutter_close_night:  { icon: '🌙', equip: 'VOLETS', bg: '#e0e7ff', color: '#3730a3', border: '#a5b4fc' },
                    thermal_curtain:      { icon: '🪟', equip: 'RIDEAUX ÉPAIS', bg: '#ede9fe', color: '#5b21b6', border: '#c4b5fd' },
                    clothing_adjust_warm: { icon: '🧥', equip: 'TENUE (CLO)', bg: '#fae8ff', color: '#86198f', border: '#f0abfc' },
                    clothing_adjust_cool: { icon: '👕', equip: 'TENUE (CLO)', bg: '#ecfeff', color: '#155e75', border: '#67e8f9' },
                    heating_boost_comfort:{ icon: '🌡️', equip: 'THERMOSTAT', bg: '#ffedd5', color: '#9a3412', border: '#fdba74' },
                    heating_cut:          { icon: '🌡️', equip: 'ROBINET / THERM.', bg: '#dcfce7', color: '#166534', border: '#86efac' },
                    bedroom_temp:         { icon: '🛏️', equip: 'CONSIGNE NUIT', bg: '#dcfce7', color: '#15803d', border: '#86efac' },
                    floor_inertia:        { icon: '♨️', equip: 'PLANCHER CHAUFF.', bg: '#fee2e2', color: '#991b1b', border: '#fca5a5' },
                    fan_on:               { icon: '💨', equip: 'BRASSEUR D\'AIR', bg: '#e0f2fe', color: '#075985', border: '#7dd3fc' },
                    fan_destrat:          { icon: '🔄', equip: 'BRASSEUR PLAFOND', bg: '#fef3c7', color: '#92400e', border: '#fcd34d' },
                    cooling_setpoint_eco: { icon: '❄️', equip: 'CLIMATISATION', bg: '#e0f2fe', color: '#0369a1', border: '#7dd3fc' }
                };
                return map[actionKey] || { icon: '⚙️', equip: 'ÉQUIPEMENT', bg: '#f1f5f9', color: '#334155', border: '#cbd5e1' };
            }

            // Calcul physique 2R2C unifié de l'impact unitaire (PMV + kWh + €) d'une action sur les vrais paramètres de la pièce
            function computeUnitImpactForAction(actionKey) {
                let deltaPmv100 = 0.15;
                if (engine.evaluateSimulatedPMV) {
                    const baseState = { ta, tr, vel, rh, met, clo: totalClo, reactivityFactor: 1.0 };
                    const simRes = engine.evaluateSimulatedPMV(baseState, [actionKey], envDataGlobal);
                    const rawImprovement = Math.abs(roomPmv) - Math.abs(simRes.pmv);
                    deltaPmv100 = Math.max(0.08, parseFloat(Math.abs(rawImprovement || (simRes.pmv - roomPmv)).toFixed(2)));
                }

                const etaGen = getGeneratorEfficiency(zone);
                const costPerKwh = getEnergyCostPerKwh(zone);
                const eerClim = 3.0;
                const gSol = getSolarIrradiance();
                const deltaTExt = Math.max(2.0, ta - envDataGlobal.t_ext);
                let kwh100 = 0;

                if (actionKey === 'sun_heat') {
                    // Apport solaire réel des vitrages de la pièce sur un créneau moyen de 4h d'ensoleillement
                    let solPowerW = 0;
                    if (engine.calculateWindowSolarGainW) {
                        solPowerW = engine.calculateWindowSolarGainW(zone, true, 0.75).totalW;
                    } else {
                        solPowerW = realWindowAreaM2 * gSol * 0.50;
                    }
                    kwh100 = ((Math.max(120, solPowerW) * 4.0) / 1000) / etaGen;
                } else if (actionKey === 'shutter_close_night' || actionKey === 'thermal_curtain') {
                    // Réduction réelle des déperditions vitrées sur 11h de nuit grâce à la résistance additionnelle ΔR du volet/rideau
                    const effDeltaH = Math.max(1.2, deltaHShuttersWPerK);
                    kwh100 = ((effDeltaH * deltaTExt * 11.0) / 1000) / etaGen;
                } else if (actionKey === 'shutter_close' || actionKey === 'anticipate_sun') {
                    // Blocage des apports solaires indésirables en été sur 5h (équivalent froid évité avec EER = 3.0)
                    let blockedSolW = realWindowAreaM2 * gSol * 0.52;
                    kwh100 = ((Math.max(150, blockedSolW) * 5.0) / 1000) / eerClim;
                } else if (actionKey === 'clothing_adjust_warm') {
                    // +0.25 Clo évite de devoir surchauffer la pièce de +1.2°C pendant 6h d'occupation
                    kwh100 = ((hTotalRoomWPerK * 1.2 * 6.0) / 1000) / etaGen;
                } else if (actionKey === 'clothing_adjust_cool') {
                    // -0.20 Clo évite d'abaisser la consigne de rafraîchissement de 1.2°C pendant 5h
                    kwh100 = ((hTotalRoomWPerK * 1.2 * 5.0) / 1000) / eerClim;
                } else if (actionKey === 'heating_cut') {
                    // Abaissement de -1.0°C sur 8h (sobriété / valorisation de l'inertie chaude des parois)
                    kwh100 = ((hTotalRoomWPerK * 1.0 * 8.0) / 1000) / etaGen;
                } else if (actionKey === 'bedroom_temp') {
                    // Réduit nocturne en chambre vers 17.5°C pendant 8h de nuit
                    const deltaSetback = Math.min(3.0, Math.max(1.0, ta - 17.5));
                    kwh100 = ((hTotalRoomWPerK * deltaSetback * 8.0) / 1000) / etaGen;
                } else if (actionKey === 'heating_boost_comfort') {
                    // Appoint actif de confort (+0.6°C pendant 4h) : gain de confort immédiat (+PMV) mais COÛT énergétique (-kWh / -€)
                    kwh100 = -(((hTotalRoomWPerK * 0.6 * 4.0) / 1000) / etaGen);
                } else if (actionKey === 'floor_inertia') {
                    // Anticipation du déphasage de la dalle évitant une surchauffe de relance (+0.8°C sur 5h)
                    kwh100 = ((hTotalRoomWPerK * 0.8 * 5.0) / 1000) / etaGen;
                } else if (actionKey === 'open_win_humidity' || actionKey === 'vmc_boost') {
                    // Aération flash maîtrisée (6 min avec minuteur) évitant les pertes d'une fenêtre laissée entrouverte (1.5 vol/h évité)
                    kwh100 = ((0.34 * volume * 1.5 * deltaTExt) / 1000) / etaGen;
                } else if (actionKey === 'vmc_reduce_cold') {
                    // Retour de marche forcée à débit normal par grand froid sec (évite 0.45 vol/h de fuite d'air chaud sur 6h)
                    kwh100 = ((0.34 * volume * 0.45 * deltaTExt * 6.0) / 1000) / etaGen;
                } else if (actionKey === 'free_cooling') {
                    // Décharge thermique gratuite par l'air frais extérieur (200 m³/h sur 2.5h, équivalent clim EER 3.0)
                    const deltaTCool = Math.max(1.5, ta - envDataGlobal.t_ext);
                    kwh100 = ((0.34 * Math.max(120, volume * 4) * deltaTCool * 2.5) / 1000) / eerClim;
                } else if (actionKey === 'fan_on') {
                    // Brassage d'air (~25 W) évitant le recours à la climatisation pour -1.5°C ressenti sur 4h
                    kwh100 = Math.max(0.15, (((hTotalRoomWPerK * 1.5 * 4.0) / 1000) / eerClim) - 0.10);
                } else if (actionKey === 'fan_destrat') {
                    // Destratification de l'air chaud sous plafond haut (>= 2.7m) rabattant +0.5°C vers la zone de vie sur 6h
                    kwh100 = ((hTotalRoomWPerK * 0.5 * 6.0) / 1000) / etaGen;
                } else if (actionKey === 'cooling_setpoint_eco') {
                    // Consigne de climatisation maintenue à 26°C (ou coupure au profit du free-cooling) sur 5h
                    kwh100 = ((hTotalRoomWPerK * 1.5 * 5.0) / 1000) / eerClim;
                }

                return {
                    deltaPmv100: parseFloat(deltaPmv100.toFixed(2)),
                    kwh100: parseFloat(kwh100.toFixed(2)),
                    eur100: parseFloat((kwh100 * costPerKwh).toFixed(2))
                };
            }

            // Helper unifié d'enregistrement avec cycle de vie, occurrence, dépréciation temporelle et visuel d'actionnable
            function pushRec(recData) {
                const baseId = recData.id;
                const occInfo = resolveOccurrenceForRec(baseId, recData.actionKey);
                if (!occInfo.shouldEmit) return;

                const finalId = occInfo.id;
                const occurrence = occInfo.occurrence;

                let displayTitle = recData.title;
                if (occurrence > 1) {
                    displayTitle += ` (🔁 ${occurrence}ᵉ intervention)`;
                }

                const unitImpact = computeUnitImpactForAction(recData.actionKey);
                const visualMeta = getActionableVisualMeta(recData.actionKey);

                let appearedAt = Date.now();
                if (lifecycleState.recos[finalId]) {
                    appearedAt = lifecycleState.recos[finalId].appearedAt || appearedAt;
                    lifecycleState.recos[finalId].unitImpact = unitImpact;
                    lifecycleState.recos[finalId].visualMeta = visualMeta;
                } else {
                    lifecycleState.recos[finalId] = {
                        id: finalId,
                        baseId: baseId,
                        occurrence: occurrence,
                        actionKey: recData.actionKey,
                        zoneId: recData.zoneId,
                        zoneName: recData.zoneName,
                        title: displayTitle,
                        text: recData.text,
                        level: recData.level,
                        timing: recData.timing,
                        type: recData.type,
                        impactWeight: recData.impactWeight,
                        appearedAt: appearedAt,
                        completedAt: null,
                        status: 'active',
                        nbVerres: recData.nbVerres || 0,
                        ventDurationMin: recData.ventDurationMin || 6,
                        unitImpact: unitImpact,
                        visualMeta: visualMeta
                    };
                }

                const timeInfo = getActionTimeInfo({ ...recData, appearedAt }, lifecycleState.recos[finalId]);

                recs.push({
                    ...recData,
                    id: finalId,
                    baseId: baseId,
                    occurrence: occurrence,
                    title: displayTitle,
                    appearedAt: appearedAt,
                    timeInfo: timeInfo,
                    unitImpact: unitImpact,
                    visualMeta: visualMeta
                });
            }

            // =========================================================================
            // CATALOGUE D'ACTIONS SANS DOUBLON — 1 RÈGLE PAR ACTIONNABLE ÉQUIPÉ
            // =========================================================================

            // --- ACTIONNABLE 1 : OUVRANTS DE FENÊTRE & VMC PILOTABLE (AÉRATION / FREE-COOLING) ---
            const vent = (engine.calculateDifferentialVentilation ? engine.calculateDifferentialVentilation(zone, roomData, envDataGlobal) : null) || {
                status: (rh > 60 && deltaAh >= 0.4 && ahExt < ahInt) ? 'recommended_dry' : (ahExt >= ahInt ? 'blocked_humid' : 'comfort'),
                verresTxt,
                nbVerres,
                mEau,
                optimalDurationMin: (mainVentType === 'oscillante' || mainVentType === 'oscillo_battante' || mainVentType === 'partial') ? 12 : 6,
                hasVmc: hasActionableVmc,
                canOpenWin: canOpenWindows
            };

            const ventDurationMin = vent.optimalDurationMin || 6;
            const ventDuration = `${ventDurationMin} min`;
            const effectiveVerresTxt = vent.verresTxt || verresTxt;
            const effectiveNbVerres = vent.nbVerres || nbVerres;
            const effectiveMEau = vent.mEau !== undefined ? vent.mEau : mEau;

            let windowActionEmitted = false;

            if (vent.status === 'urgent_dry' || vent.status === 'recommended_dry') {
                if (canOpenWindows) {
                    windowActionEmitted = true;
                    const cutHeatNote = (isHeatingSeasonActive && hasHeating && envDataGlobal.t_ext < 12)
                        ? ` Pensez à baisser ${regDeviceLabel} pendant ces ${ventDuration}.`
                        : '';
                    const titleText = isWetRoom ? `Ouvrir la fenêtre ${ventDuration} — Purge vapeur (${effectiveVerresTxt})` : `Ouvrir la fenêtre ${ventDuration} — Aération flash (${effectiveVerresTxt})`;
                    const actionText = `Humidité à ${rh} % (extérieur plus sec). Ouvrez en grand pendant ${ventDuration} (un minuteur vous notifiera de refermer) pour évacuer ${effectiveVerresTxt} sans refroidir vos parois.${cutHeatNote}`;
                    pushRec({
                        id: `${zoneId}_open_win_humidity`,
                        level: 1,
                        actionKey: 'open_win_humidity',
                        zoneId,
                        zoneName,
                        timing: 'immediate',
                        type: 'type-air',
                        title: titleText,
                        text: actionText,
                        impactWeight: 15,
                        nbVerres: effectiveNbVerres,
                        mEau: effectiveMEau,
                        ventDurationMin: ventDurationMin
                    });
                } else if (hasActionableVmc) {
                    pushRec({
                        id: `${zoneId}_vmc_boost`,
                        level: 1,
                        actionKey: 'vmc_boost',
                        zoneId,
                        zoneName,
                        timing: 'immediate',
                        type: 'type-air',
                        title: `${vmcActionLabel} (${effectiveVerresTxt})`,
                        text: `Humidité à ${rh} % dans cette pièce sans fenêtre ouvrable. Utilisez la VMC pour extraire ${effectiveVerresTxt}.`,
                        impactWeight: 15,
                        nbVerres: effectiveNbVerres,
                        mEau: effectiveMEau
                    });
                }
            } else if (vent.status === 'blocked_humid' && hasActionableVmc && rh > 60) {
                pushRec({
                    id: `${zoneId}_vmc_boost`,
                    level: 1,
                    actionKey: 'vmc_boost',
                    zoneId,
                    zoneName,
                    timing: 'immediate',
                    type: 'type-air',
                    title: `${vmcActionLabel} (${effectiveVerresTxt})`,
                    text: `L'air extérieur est trop humide (${ahExt.toFixed(1)} g/m³) pour ouvrir les fenêtres. Extrayez la vapeur (${effectiveVerresTxt}) via la VMC.`,
                    impactWeight: 15,
                    nbVerres: effectiveNbVerres,
                    mEau: effectiveMEau
                });
            } else if (isHeatingSeasonActive && hasActionableVmc && rh < 38 && envDataGlobal.t_ext < 8) {
                // Nouvelle action pertinente sur VMC pilotable : éviter le sur-débit d'air froid et sec
                const reduceVmcTitle = (vmcSys === 'trappe') ? 'Réduire la trappe VMC (Air sec & froid)' : 'Couper la marche forcée VMC (Débit normal)';
                pushRec({
                    id: `${zoneId}_vmc_reduce_cold`,
                    level: 1,
                    actionKey: 'vmc_reduce_cold',
                    zoneId,
                    zoneName,
                    timing: 'immediate',
                    type: 'type-eco',
                    title: reduceVmcTitle,
                    text: `L'air intérieur est déjà très sec (${rh} %) et il fait ${envDataGlobal.t_ext.toFixed(1)} °C dehors : repassez la VMC en débit minimal pour stopper les pertes d'air chaud.`,
                    impactWeight: 14
                });
            }

            // Free-cooling sur ouvrants de fenêtre (uniquement si la fenêtre n'est pas déjà sollicitée par une aération flash, et sans doublon Niveau 1 / Niveau 3)
            const isOutdoorHeatwaveThreat = tExtMaxDay > (ta + 1.5);
            if (!windowActionEmitted && canOpenWindows && envDataGlobal.t_ext < (ta - 1.0)) {
                if (needsCooling && (isOutdoorHeatwaveThreat || ta > 23.0)) {
                    pushRec({
                        id: `${zoneId}_free_cooling`,
                        level: 1,
                        actionKey: 'free_cooling',
                        zoneId,
                        zoneName,
                        timing: 'immediate',
                        type: 'type-cool',
                        title: 'Ouvrir les fenêtres 15 min (Rafraîchissement gratuit)',
                        text: `L'air extérieur est plus frais (${envDataGlobal.t_ext.toFixed(1)} °C contre ${ta.toFixed(1)} °C dedans). Ouvrez pour évacuer la chaleur gratuitement (avec rappel de fermeture).`,
                        impactWeight: 20,
                        ventDurationMin: 15
                    });
                } else if (!isHeatingSeasonActive && (tExtMaxDay >= 27.0 || tStruct >= 24.0) && envDataGlobal.t_ext < tStruct) {
                    pushRec({
                        id: `${zoneId}_heatwave_preventive_flush`,
                        level: 3,
                        actionKey: 'free_cooling',
                        zoneId,
                        zoneName,
                        timing: 'strategic',
                        type: 'type-cool',
                        title: 'Sur-ventilation nocturne des parois (30 min)',
                        text: `Chaleur annoncée (${tExtMaxDay.toFixed(0)} °C). Profitez de la fraîcheur extérieure (${envDataGlobal.t_ext.toFixed(1)} °C) pour décharger la masse de vos parois (${tStruct.toFixed(1)} °C).`,
                        impactWeight: 24,
                        ventDurationMin: 30
                    });
                }
            }

            // --- ACTIONNABLE 2 : VOLETS EXTÉRIEURS & RIDEAUX / STORES INTÉRIEURS (ZÉRO DOUBLON) ---
            if (hasAnyShutterOrCurtain) {
                const protName = hasExteriorShutters ? (hasInteriorCurtains ? 'les volets et rideaux' : 'les volets') : 'les rideaux / stores';

                // Cas 2A : Journée ensoleillée en période fraîche -> Ouvrir en grand (fusionne Court Terme & Pré-charge 48h sans doublon)
                if ((needsHeat || isHeatingSeasonActive) && isSunny && solarExp.isExposedNow && ta < 22.5 && envDataGlobal.t_ext < ta) {
                    const prechargeNote = (tExtMinDay < 8.0)
                        ? ` Cette recharge gratuite prépare aussi l'inertie de vos parois (${tStruct.toFixed(1)} °C) avant la nuit froide.`
                        : '';
                    pushRec({
                        id: `${zoneId}_sun_heat`,
                        level: 1,
                        actionKey: 'sun_heat',
                        zoneId,
                        zoneName,
                        timing: 'immediate',
                        type: 'type-sun',
                        title: `Ouvrir ${protName} côté ${solarExp.exposedLabel} (Soleil gratuit)`,
                        text: `Vitrages exposés au soleil : ouvrez grand ${protName} côté ${solarExp.exposedLabel} pour chauffer gratuitement l'air et les parois.${prechargeNote}`,
                        impactWeight: 20
                    });
                }
                // Cas 2B : Nuit tombée en période fraîche -> Fermer pour créer le bouclier thermique nocturne (1 seule carte unifiée volets/rideaux)
                else if ((needsHeat || isHeatingSeasonActive) && isNight && ta < 22.0) {
                    const actKeyNight = hasExteriorShutters ? 'shutter_close_night' : 'thermal_curtain';
                    pushRec({
                        id: `${zoneId}_winter_night_shutters`,
                        level: 1,
                        actionKey: actKeyNight,
                        zoneId,
                        zoneName,
                        timing: 'immediate',
                        type: 'type-heat',
                        title: `Fermer ${protName} pour la nuit (Bouclier isolant)`,
                        text: `Nuit tombée (${envDataGlobal.t_ext.toFixed(1)} °C dehors) : fermez ${protName} pour couper l'effet paroi froide des vitres (+0,45 °C radiants) et réduire les pertes nocturnes.`,
                        impactWeight: 18
                    });
                }
                // Cas 2C : Surchauffe au soleil -> Fermer les protections côté soleil (fusionne façade + Est/Ouest + Velux en 1 seule action claire)
                else if (needsCooling && isSunny && (solarExp.isExposedNow || hasRoofWin)) {
                    const targetLabel = hasRoofWin
                        ? (solarExp.exposedLabel ? `${solarExp.exposedLabel} & fenêtres de toit` : 'fenêtres de toit (Velux)')
                        : solarExp.exposedLabel;
                    pushRec({
                        id: `${zoneId}_shutter_close`,
                        level: 1,
                        actionKey: 'shutter_close',
                        zoneId,
                        zoneName,
                        timing: 'immediate',
                        type: 'type-sun',
                        title: `Fermer ${protName} côté ${targetLabel} (Anti-surchauffe)`,
                        text: `Bloquez le rayonnement solaire direct sur vos vitrages (${targetLabel}) avant qu'il ne surchauffe la pièce (${ta.toFixed(1)} °C).`,
                        impactWeight: 24
                    });
                }
                // Cas 2D : Anticipation matin avant rotation du soleil sur Sud/Ouest en été
                else if (needsCooling && isSunny && isMorning && solarExpDay.hasSouthOrWest && !solarExp.isExposedNow) {
                    pushRec({
                        id: `${zoneId}_anticipate_sun`,
                        level: 2,
                        actionKey: 'anticipate_sun',
                        zoneId,
                        zoneName,
                        timing: 'anticipated',
                        type: 'type-sun',
                        title: `Anticiper la fermeture de ${protName} (Sud / Ouest)`,
                        text: `Fermez ${protName} avant que le soleil ne tourne sur vos vitrages Sud/Ouest cet après-midi.`,
                        impactWeight: 16
                    });
                }

                // Rendez-vous programmé du soir : En journée de saison de chauffe, rappeler l'heure exacte de fermeture au coucher du soleil (Niveau 2)
                if (isHeatingSeasonActive && !isNight) {
                    pushRec({
                        id: `${zoneId}_anticipate_night_shutters`,
                        level: 2,
                        actionKey: hasExteriorShutters ? 'shutter_close_night' : 'thermal_curtain',
                        zoneId,
                        zoneName,
                        timing: 'anticipated',
                        type: 'type-heat',
                        title: `À ${sunsetHour}h00 : Fermer ${protName} dès le crépuscule`,
                        text: `Rendez-vous thermique à ${sunsetHour}h00 (coucher du soleil) : verrouillez ${protName} pour piéger la chaleur de vos parois (${tStruct.toFixed(1)} °C) avant la chute nocturne.`,
                        impactWeight: 15
                    });
                }
            }

            // --- ACTIONNABLE 3 : TENUE VESTIMENTAIRE (CLO) EN PIÈCE OCCUPÉE ---
            if (!isBuffer) {
                if (needsHeat && !isNight && (!isSunny || !solarExp.isExposedNow)) {
                    pushRec({
                        id: `${zoneId}_clothing_adjust_warm`,
                        level: 1,
                        actionKey: 'clothing_adjust_warm',
                        zoneId,
                        zoneName,
                        timing: 'immediate',
                        type: 'type-heat',
                        title: 'Ajouter une couche vestimentaire (+0.25 Clo)',
                        text: `Ressenti frais (${ta.toFixed(1)} °C, parois à ${tStruct.toFixed(1)} °C) sans soleil direct : gardez les volets ouverts pour la lumière naturelle et enfilez un pull fin ou gilet (+0,38 PMV immédiat, 0 € de chauffage).`,
                        impactWeight: 15
                    });
                } else if (needsCooling && roomPmv > 0.40 && totalClo > 0.55) {
                    pushRec({
                        id: `${zoneId}_clothing_adjust_cool`,
                        level: 1,
                        actionKey: 'clothing_adjust_cool',
                        zoneId,
                        zoneName,
                        timing: 'immediate',
                        type: 'type-cool',
                        title: 'Alléger la tenue vestimentaire (-0.20 Clo)',
                        text: `Ambiance chaude (${ta.toFixed(1)} °C, PMV +${roomPmv.toFixed(2)}) : passez en tenue légère respirante pour regagner du confort immédiat sans dépenser d'énergie.`,
                        impactWeight: 14
                    });
                }
            }

            // --- ACTIONNABLE 4 : CHAUFFAGE & RÉGULATION (THERMOSTAT, ROBINET THERMOSTATIQUE, PLANCHER) ---
            if (hasHeating && !isBuffer) {
                // Exclusivité mutuelle stricte : on ne propose jamais de monter et baisser le chauffage en même temps
                if (isHeatingSeasonActive && (roomPmv > 0.30 || (reserve.chargeCalories >= 75 && roomPmv >= -0.15))) {
                    const reasonTxt = (roomPmv > 0.30)
                        ? `La pièce dépasse la neutralité thermique (${ta.toFixed(1)} °C, PMV +${roomPmv.toFixed(2)}).`
                        : `Vos parois sont chargées en chaleur (${tStruct.toFixed(1)} °C, réserve ${reserve.chargeCalories} %).`;
                    pushRec({
                        id: `${zoneId}_heating_cut`,
                        level: 1,
                        actionKey: 'heating_cut',
                        zoneId,
                        zoneName,
                        timing: 'immediate',
                        type: 'type-eco',
                        title: `Baisser ${regDeviceLabel} de -1 °C (Sobriété & Inertie)`,
                        text: `${reasonTxt} Réduisez ${regDeviceLabel} d'un cran (-1 °C) pour économiser immédiatement sur le chauffage tout en restant confortable.`,
                        impactWeight: 16
                    });
                } else if (needsHeat && roomPmv < -0.65 && (!isSunny || !solarExp.isExposedNow) && heatingSys !== 'floor') {
                    pushRec({
                        id: `${zoneId}_heating_boost_comfort`,
                        level: 1,
                        actionKey: 'heating_boost_comfort',
                        zoneId,
                        zoneName,
                        timing: 'immediate',
                        type: 'type-heat',
                        title: `Monter ${regDeviceLabel} de +0,5 °C (Appoint confort)`,
                        text: `Inconfort frais marqué (PMV ${roomPmv.toFixed(2)}) sans apport solaire : si l'ajout d'un vêtement ne suffit pas, relevez légèrement ${regDeviceLabel} pendant l'occupation.`,
                        impactWeight: 12
                    });
                }

                // Niveau 2 : Plancher chauffant à forte inertie
                if (isHeatingSeasonActive && needsHeat && heatingSys === 'floor') {
                    pushRec({
                        id: `${zoneId}_floor_inertia`,
                        level: 2,
                        actionKey: 'floor_inertia',
                        zoneId,
                        zoneName,
                        timing: 'anticipated',
                        type: 'type-heat',
                        title: `Anticiper la consigne du plancher chauffant (Inertie dalle)`,
                        text: `Dalle à fort déphasage : pilotez ${regDeviceLabel} 3h à l'avance sans surchauffer en pointe.`,
                        impactWeight: 15
                    });
                }

                // Niveau 2 : Consigne nocturne en chambre
                if (isHeatingSeasonActive && Array.isArray(zone?.usages) && zone.usages.includes('bedroom') && ta > 18.2) {
                    pushRec({
                        id: `${zoneId}_bedroom_temp_drop`,
                        level: 2,
                        actionKey: 'bedroom_temp',
                        zoneId,
                        zoneName,
                        timing: 'anticipated',
                        type: 'type-eco',
                        title: `Abaisser ${regDeviceLabel} à 17,5 °C pour la nuit`,
                        text: `Chambre à ${ta.toFixed(1)} °C : réglez ${regDeviceLabel} sur 17,5 °C 1h avant le coucher pour un sommeil optimal et 8h d'économies nocturnes.`,
                        impactWeight: 14
                    });
                }
            }

            // --- ACTIONNABLE 5 : BRASSEUR D'AIR / VENTILATEUR (ÉTÉ & DESTRATIFICATION HIVER) ---
            if (hasFan) {
                const fanLabel = (fanSys === 'plafond') ? 'le ventilateur de plafond' : 'le ventilateur mobile';
                if (needsCooling) {
                    pushRec({
                        id: `${zoneId}_fan_on`,
                        level: 1,
                        actionKey: 'fan_on',
                        zoneId,
                        zoneName,
                        timing: 'immediate',
                        type: 'type-cool',
                        title: `Activer ${fanLabel} (Gain ressenti -2 °C)`,
                        text: `Le mouvement d'air (+0,25 m/s) rafraîchit immédiatement le ressenti cutané (-0,45 PMV) pour une consommation dérisoire (~25 W).`,
                        impactWeight: 18
                    });
                } else if (isHeatingSeasonActive && needsHeat && fanSys === 'plafond' && height >= 2.7) {
                    pushRec({
                        id: `${zoneId}_fan_destrat`,
                        level: 1,
                        actionKey: 'fan_destrat',
                        zoneId,
                        zoneName,
                        timing: 'immediate',
                        type: 'type-heat',
                        title: `Activer le ventilateur de plafond en mode Hiver (Destratification)`,
                        text: `Plafond haut (${height.toFixed(1)} m) : faites tourner le brasseur à vitesse lente (sens inverse) pour rabattre la poche d'air chaud du plafond vers la zone de vie (+0,45 °C gagnés).`,
                        impactWeight: 15
                    });
                }
            }

            // --- ACTIONNABLE 6 : CLIMATISATION / REFROIDISSEMENT ACTIF ---
            if (hasCooling && !isHeatingSeasonActive && (needsCooling || ta >= 24.0)) {
                if (envDataGlobal.t_ext < (ta - 1.0) && canOpenWindows) {
                    pushRec({
                        id: `${zoneId}_cooling_setpoint_eco`,
                        level: 1,
                        actionKey: 'cooling_setpoint_eco',
                        zoneId,
                        zoneName,
                        timing: 'immediate',
                        type: 'type-eco',
                        title: `Couper la climatisation (Extérieur plus frais à ${envDataGlobal.t_ext.toFixed(1)} °C)`,
                        text: `Il fait plus frais dehors que dedans (${ta.toFixed(1)} °C) : éteignez la climatisation et profitez du rafraîchissement naturel par les fenêtres.`,
                        impactWeight: 18
                    });
                } else if (envDataGlobal.t_ext >= 25.0) {
                    pushRec({
                        id: `${zoneId}_cooling_setpoint_eco`,
                        level: 1,
                        actionKey: 'cooling_setpoint_eco',
                        zoneId,
                        zoneName,
                        timing: 'immediate',
                        type: 'type-eco',
                        title: `Maintenir la consigne de climatisation à 26 °C`,
                        text: `Évitez tout écart supérieur à 5-6 °C avec l'extérieur : régler la consigne sur 26 °C économise ~15 % d'électricité par degré.`,
                        impactWeight: 15
                    });
                }
            }

            return recs;
        }

        function getAllRecommendations() {
            let allRecs = [];
            const zonesMap = getAvailableZonesMap();

            Object.keys(zonesMap).forEach(zId => {
                const roomName = zonesMap[zId];
                const zone = (engine.getZoneConfigByName ? engine.getZoneConfigByName(roomName) : null)
                          || houseConfig[zId] 
                          || Object.values(houseConfig).find(z => z && z.name === roomName)
                          || { id: zId, name: roomName };
                const roomData = donneesHabitat[roomName] || { ta: 20, rh: 50 };
                allRecs = allRecs.concat(generateRecommendationsForZone(zone, zId, roomData));
            });

            syncRecommendationsLifecycle(allRecs);
            return allRecs;
        }

        function syncRecommendationsLifecycle(activeGeneratedRecos) {
            const now = Date.now();
            const activeIds = new Set(activeGeneratedRecos.map(r => r.id));

            activeGeneratedRecos.forEach(r => {
                if (!lifecycleState.recos[r.id]) {
                    lifecycleState.recos[r.id] = { id: r.id, appearedAt: now, completedAt: null, status: 'active' };
                } else {
                    const item = lifecycleState.recos[r.id];
                    if (item.status === 'expired') {
                        item.status = 'active';
                        item.appearedAt = now;
                    }
                }
            });

            Object.keys(lifecycleState.recos).forEach(id => {
                const item = lifecycleState.recos[id];
                if (!activeIds.has(id) && item.status === 'active') {
                    item.status = 'expired';
                }
            });

            saveRecoLifecycleState(lifecycleState);
        }

        function render() {
            const recs = getAllRecommendations();
            if (containerImmediate) containerImmediate.innerHTML = '';
            if (containerAnticipated) containerAnticipated.innerHTML = '';
            if (containerStrategic) containerStrategic.innerHTML = '';
            if (containerCompleted) containerCompleted.innerHTML = '';

            // Regroupement visuel des recommandations EN ATTENTE (non effectuées)
            const groupsMap = new Map();
            const pendingRecs = recs.filter(rec => lifecycleState.recos[rec.id]?.status !== 'completed');

            pendingRecs.forEach(rec => {
                const groupKey = `${rec.actionKey}__${rec.level}__${rec.timing}`;
                if (!groupsMap.has(groupKey)) {
                    groupsMap.set(groupKey, {
                        groupKey,
                        actionKey: rec.actionKey,
                        level: rec.level,
                        timing: rec.timing,
                        type: rec.type,
                        title: rec.title.replace(/\s*\([^)]*Cuisine[^)]*\)/i, '').trim(),
                        text: rec.text,
                        impactWeightPerRoom: rec.impactWeight,
                        items: []
                    });
                }
                groupsMap.get(groupKey).items.push(rec);
            });

            const groups = Array.from(groupsMap.values());

            const immediatePending = [];
            const anticipatedPending = [];
            const strategicPending = [];

            groups.forEach(group => {
                if (group.timing === 'immediate' || group.level === 1) {
                    immediatePending.push(group);
                } else if (group.timing === 'anticipated' || group.level === 2) {
                    anticipatedPending.push(group);
                } else if (group.timing === 'strategic' || group.level === 3) {
                    strategicPending.push(group);
                }
            });

            renderGroupedCards(immediatePending, containerImmediate, "Aucune action immédiate requise.");
            
            if (containerStrategic) {
                renderGroupedCards(anticipatedPending, containerAnticipated, "Aucune action anticipée 24h requise.");
                renderGroupedCards(strategicPending, containerStrategic, "Aucune action stratégique météo 48-72h requise.");
            } else {
                renderGroupedCards([...anticipatedPending, ...strategicPending], containerAnticipated, "Aucune action anticipée ou stratégique requise.");
            }

            // Rendu dédié des actions effectuées enregistrées aujourd'hui
            const completedItems = Object.values(lifecycleState.recos || {}).filter(item => item.status === 'completed');
            completedItems.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
            renderCompletedCards(completedItems, containerCompleted, "Aucune action réalisée pour le moment.");

            renderActiveWindowTimers();
            renderNotificationHub(pendingRecs);
            renderArbitrageCard(recs);
            updateMetrics(recs);
        }

        // ============================================================
        // CENTRE DE NOTIFICATION DIRECT & ALERTES ÉQUIPEMENTS
        // ============================================================
        window.solsticeEnableActionNotifications = function() {
            playWindowAlertChime();
            if ('Notification' in window) {
                Notification.requestPermission().then(perm => {
                    if (perm === 'granted') {
                        try {
                            new Notification("🔔 SOLSTICE — Notifications Thermiques Activées", {
                                body: "Vous serez alerté en direct dès qu'une action sur vos fenêtres, volets ou chauffage est recommandée."
                            });
                        } catch (e) {}
                    }
                    render();
                });
            }
        };

        function renderNotificationHub(pendingRecs) {
            const hubEl = document.getElementById('live-reco-notification-hub');
            if (!hubEl) return;

            const immediateList = (pendingRecs || []).filter(r => r.level === 1);
            const scheduledList = (pendingRecs || []).filter(r => r.level >= 2);

            if (immediateList.length === 0) {
                hubEl.innerHTML = `
                    <div class="notif-hub-banner notif-hub-calm">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <span style="font-size: 1.5rem;">✅</span>
                                <div>
                                    <div style="font-weight: 800; color: #14532d; font-size: 0.98rem;">
                                        Aucune manipulation immédiate requise sur vos équipements
                                    </div>
                                    <div style="font-size: 0.84rem; color: #166534; margin-top: 2px;">
                                        ${scheduledList.length > 0 ? `${scheduledList.length} rendez-vous d'anticipation sont programmés plus bas (24h-48h).` : `Tous les équipements de vos pièces sont dans leur configuration optimale.`}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
                return;
            }

            // Résumé des actionnables à manipuler maintenant
            const equipSummaryMap = new Map();
            let totalImmediateEur = 0;
            let avgImmediatePmv = 0;

            immediateList.forEach(r => {
                const vMeta = r.visualMeta || { icon: '⚙️', equip: 'ÉQUIPEMENT' };
                const key = `${vMeta.icon} ${vMeta.equip}`;
                if (!equipSummaryMap.has(key)) equipSummaryMap.set(key, new Set());
                equipSummaryMap.get(key).add(r.zoneName);

                const u = r.unitImpact || { deltaPmv100: 0.15, eur100: 0 };
                const f = r.timeInfo ? r.timeInfo.factor : 1.0;
                avgImmediatePmv += (u.deltaPmv100 * f);
                if (u.eur100 > 0) totalImmediateEur += (u.eur100 * f);
            });
            avgImmediatePmv = avgImmediatePmv / Math.max(1, immediateList.length);

            const equipPillsHtml = Array.from(equipSummaryMap.entries()).map(([eqName, roomsSet]) => {
                const rArr = Array.from(roomsSet);
                return `<span style="background: #ffffff; border: 1px solid #f59e0b; color: #92400e; font-size: 0.78rem; font-weight: 800; padding: 4px 10px; border-radius: 999px; display: inline-flex; align-items: center; gap: 5px;">
                    <strong>${eqName}</strong> <span style="color: #475569; font-weight: 600;">(${rArr.join(', ')})</span>
                </span>`;
            }).join('');

            const notifPerm = ('Notification' in window) ? Notification.permission : 'unsupported';
            const notifBtnHtml = (notifPerm !== 'granted')
                ? `<button type="button" onclick="window.solsticeEnableActionNotifications()" style="background: #0f172a; color: #ffffff; border: none; border-radius: 8px; padding: 7px 12px; font-weight: 800; font-size: 0.78rem; cursor: pointer; white-space: nowrap;">
                    🔔 Activer alertes & son
                   </button>`
                : `<span style="font-size: 0.75rem; font-weight: 700; color: #15803d; background: #dcfce7; padding: 4px 9px; border-radius: 999px; border: 1px solid #86efac;">🔔 Alertes actives</span>`;

            hubEl.innerHTML = `
                <div class="notif-hub-banner notif-hub-active">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-size: 1.65rem; line-height: 1;">🔔</span>
                            <div>
                                <div style="font-weight: 900; color: #78350f; font-size: 1.02rem;">
                                    ${immediateList.length} action${immediateList.length > 1 ? 's' : ''} à réaliser maintenant dans votre habitat
                                </div>
                                <div style="font-size: 0.84rem; color: #92400e; margin-top: 2px;">
                                    Potentiel immédiat : <strong>+${avgImmediatePmv.toFixed(2)} PMV</strong> de confort moyen ${totalImmediateEur > 0.01 ? `et <strong>+${totalImmediateEur.toFixed(2).replace('.', ',')} €</strong> d'économies` : ''}
                                </div>
                            </div>
                        </div>
                        ${notifBtnHtml}
                    </div>
                    <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding-top: 4px;">
                        <span style="font-size: 0.76rem; font-weight: 800; color: #78350f; text-transform: uppercase;">Actionnables sollicités :</span>
                        ${equipPillsHtml}
                    </div>
                </div>
            `;
        }

        // ============================================================
        // CARTE D'ARBITRAGE COURT TERME VS LONG TERME
        // ============================================================
        const SHORT_TERM_KEYS = new Set([
            'clothing_adjust_warm',
            'clothing_adjust_cool',
            'heating_boost_comfort',
            'fan_on',
            'open_win_humidity',
            'vmc_boost',
            'shutter_close'
        ]);
        const LONG_TERM_KEYS = new Set([
            'sun_heat',
            'shutter_close_night',
            'thermal_curtain',
            'anticipate_sun',
            'floor_inertia',
            'bedroom_temp',
            'heating_cut',
            'free_cooling'
        ]);

        window.solsticeApplyArbitrageOption = function(mode) {
            const now = Date.now();
            const allRecs = getAllRecommendations();
            const targetRecs = allRecs.filter(r => {
                if (mode === 'short_term') {
                    return r.level === 1 && (SHORT_TERM_KEYS.has(r.actionKey) || !LONG_TERM_KEYS.has(r.actionKey));
                } else {
                    return r.level >= 2 || LONG_TERM_KEYS.has(r.actionKey);
                }
            });

            const listToApply = targetRecs.length > 0 ? targetRecs : allRecs;
            listToApply.forEach(rec => {
                let item = lifecycleState.recos[rec.id];
                if (!item) {
                    item = {
                        id: rec.id,
                        baseId: rec.baseId,
                        occurrence: rec.occurrence || 1,
                        actionKey: rec.actionKey,
                        zoneId: rec.zoneId,
                        zoneName: rec.zoneName,
                        title: rec.title,
                        text: rec.text,
                        level: rec.level,
                        timing: rec.timing,
                        type: rec.type,
                        impactWeight: rec.impactWeight,
                        ventDurationMin: rec.ventDurationMin || 6,
                        unitImpact: rec.unitImpact,
                        appearedAt: rec.appearedAt || now,
                        status: 'active'
                    };
                    lifecycleState.recos[rec.id] = item;
                }
                if (item.status !== 'completed') {
                    const timeInfo = getActionTimeInfo(rec, item);
                    item.status = 'completed';
                    item.completedAt = now;
                    item.earnedPoints = timeInfo.currentPoints;
                    item.reactivityPercent = timeInfo.percent;
                    item.elapsedMin = timeInfo.elapsedMin;
                    item.elapsedMs = timeInfo.elapsedMs;
                    startWindowCloseTimerForItem(item);
                }
            });

            localStorage.setItem('SOLSTICE_ARBITRAGE_LAST_CHOICE', mode);

            const completedMap = {};
            Object.values(lifecycleState.recos || {}).forEach(i => {
                if (i.status === 'completed') completedMap[i.id] = true;
            });
            localStorage.setItem('SOLSTICE_CHECKED_RECOS', JSON.stringify(completedMap));

            saveRecoLifecycleState(lifecycleState);
            render();
        };

        function renderArbitrageCard(allRecs) {
            const container = document.getElementById('arbitrage-card-container');
            if (!container) return;

            const hMetrics = (engine.calculateGlobalHabitatMetrics ? engine.calculateGlobalHabitatMetrics() : null) || {
                avgTemp: 19.0,
                avgTStruct: 18.5,
                avgPMV: -0.35,
                avgTau: 22.0
            };

            const shortRecs = (allRecs || []).filter(r => r.level === 1 && (SHORT_TERM_KEYS.has(r.actionKey) || !LONG_TERM_KEYS.has(r.actionKey)));
            const longRecs = (allRecs || []).filter(r => r.level >= 2 || LONG_TERM_KEYS.has(r.actionKey));

            const sumStats = (arr, fallbackPmv, fallbackKwh) => {
                if (!arr || arr.length === 0) {
                    return { pmvGain: fallbackPmv, kwhGain: fallbackKwh, eurGain: fallbackKwh * 0.22, count: 0 };
                }
                let pmvSum = 0;
                let kwhSum = 0;
                let eurSum = 0;
                arr.forEach(r => {
                    const u = r.unitImpact || { deltaPmv100: 0.15, kwh100: 0.25, eur100: 0.06 };
                    pmvSum += u.deltaPmv100;
                    kwhSum += u.kwh100;
                    eurSum += u.eur100;
                });
                return {
                    pmvGain: Math.max(fallbackPmv, pmvSum / Math.max(1, arr.length)),
                    kwhGain: Math.max(fallbackKwh, kwhSum),
                    eurGain: Math.max(fallbackKwh * 0.20, eurSum),
                    count: arr.length
                };
            };

            const shortStats = sumStats(shortRecs, 0.28, 0.35);
            const longStats = sumStats(longRecs, 0.22, 1.45);
            const lastChoice = localStorage.getItem('SOLSTICE_ARBITRAGE_LAST_CHOICE') || '';

            const isColdContext = isHeatingSeasonActive || hMetrics.avgPMV < -0.15 || envDataGlobal.t_ext < 16;

            const summaryText = isColdContext
                ? `Votre logement fonctionne à <strong>deux vitesses thermiques</strong> : l'air ambiant (<strong>${hMetrics.avgTemp.toFixed(1)} °C</strong>, réactif en 15 min) gouverne votre ressenti immédiat, tandis que vos parois (<strong>${hMetrics.avgTStruct.toFixed(1)} °C</strong>, inertie <strong>~${Math.round(hMetrics.avgTau || 20)}h</strong>) déterminent la température de demain matin à 07h et votre facture de chauffage. Choisissez librement votre priorité du moment ou combinez les deux :`
                : `Votre logement combine l'air ambiant (<strong>${hMetrics.avgTemp.toFixed(1)} °C</strong>, réactif immédiatement) et la réserve de fraîcheur de vos parois (<strong>${hMetrics.avgTStruct.toFixed(1)} °C</strong>, inertie <strong>~${Math.round(hMetrics.avgTau || 20)}h</strong>). Vous pouvez privilégier le rafraîchissement ressenti immédiat ou la décharge thermique profonde des parois sur 24-48h :`;

            const shortDesc = isColdContext
                ? `Agir directement sur votre ressenti corporel présent (ajustement vestimentaire +0.25 Clo, appoint thermostatique local, aération flash) tout en conservant la lumière naturelle en journée.`
                : `Agir immédiatement sur le ressenti cutané et l'air intérieur (brassage d'air, protection des vitrages actuellement au soleil, aération courte).`;

            const shortPro = isColdContext
                ? `<strong>✅ Avantages :</strong> Effet ressenti en quelques minutes (<strong>+${shortStats.pmvGain.toFixed(2)} PMV</strong>) • Conserve la vue extérieure et la lumière du jour • Zéro attente.`
                : `<strong>✅ Avantages :</strong> Soulagement thermique immédiat (<strong>+${shortStats.pmvGain.toFixed(2)} PMV</strong>) dans les pièces occupées • Action simple et rapide.`;

            const shortCon = isColdContext
                ? `<strong>⚠️ Inconvénients :</strong> Ne recharge pas la masse thermique des parois (${hMetrics.avgTStruct.toFixed(1)} °C) pour la nuit • Économies plus limitées si recours à une relance de chauffage.`
                : `<strong>⚠️ Inconvénients :</strong> Ne refroidit pas en profondeur la structure des parois • Risque de remontée rapide de la température dès l'arrêt du brassage.`;

            const longDesc = isColdContext
                ? `Utiliser vos parois comme batterie thermique : capter le soleil passif le jour, verrouiller les volets dès le coucher du soleil (${sunsetHour}h) et abaisser la consigne nocturne en s'appuyant sur l'inertie.`
                : `Préserver et régénérer le bouclier de fraîcheur des parois : occultation préventive dès le matin et sur-ventilation nocturne profonde pour décharger la masse des murs.`;

            const longPro = isColdContext
                ? `<strong>✅ Avantages :</strong> Économie maximale (<strong>~${longStats.kwhGain.toFixed(2)} kWh/j soit ~${longStats.eurGain.toFixed(2).replace('.', ',')} €</strong>) • Protège la température des parois et amortit la chute au réveil demain 07h.`
                : `<strong>✅ Avantages :</strong> Économie maximale (<strong>~${longStats.kwhGain.toFixed(2)} kWh/j soit ~${longStats.eurGain.toFixed(2).replace('.', ',')} €</strong>) • Garantie d'un logement frais sur 24 à 72h sans climatisation.`;

            const longCon = isColdContext
                ? `<strong>⚠️ Inconvénients :</strong> Effet progressif sur l'air ambiant (déphasage de plusieurs heures des parois) • Demande d'accepter une légère tolérance temporaire (±0.25 PMV) ou de fermer les volets dès ${sunsetHour}h.`
                : `<strong>⚠️ Inconvénients :</strong> Baisse plus lente au thermomètre immédiat • Nécessite d'anticiper la fermeture des volets avant l'arrivée du soleil.`;

            container.innerHTML = `
                <div class="arbitrage-panel">
                    <div class="arbitrage-header">
                        <div>
                            <h3 style="margin: 0; font-size: 1.08rem; font-weight: 800; color: #0f172a; display: flex; align-items: center; gap: 8px;">
                                <span>⚖️</span>
                                <span>Carte d'Arbitrage : Confort Immédiat (Court Terme) vs Inertie & Sobriété (Long Terme)</span>
                            </h3>
                        </div>
                        <span style="font-size: 0.75rem; font-weight: 700; background: #eef2ff; color: #4338ca; padding: 3px 10px; border-radius: 999px; border: 1px solid #c7d2fe;">
                            2 options complémentaires au choix
                        </span>
                    </div>

                    <div class="arbitrage-summary">
                        ${summaryText}
                    </div>

                    <div class="arbitrage-grid">
                        <!-- OPTION 1 : COURT TERME -->
                        <div class="arbitrage-option-card arbitrage-option-short ${lastChoice === 'short_term' ? 'active-choice' : ''}">
                            <div>
                                <div class="arbitrage-opt-title">
                                    <span>⚡ Option 1 — Privilégier le Court Terme (< 1h)</span>
                                    <span style="font-size: 0.72rem; background: #fef3c7; color: #b45309; padding: 2px 8px; border-radius: 999px; border: 1px solid #fde68a;">
                                        +${shortStats.pmvGain.toFixed(2)} PMV immédiat
                                    </span>
                                </div>
                                <div class="arbitrage-opt-desc">${shortDesc}</div>
                                <div class="arbitrage-pros-cons">
                                    <div class="arbitrage-pro">${shortPro}</div>
                                    <div class="arbitrage-con">${shortCon}</div>
                                </div>
                            </div>
                            <button type="button" class="arbitrage-btn arbitrage-btn-short" onclick="window.solsticeApplyArbitrageOption('short_term')">
                                ⚡ Choisir & cocher les actions Court Terme ${shortStats.count > 0 ? `(${shortStats.count})` : ''}
                            </button>
                        </div>

                        <!-- OPTION 2 : LONG TERME -->
                        <div class="arbitrage-option-card arbitrage-option-long ${lastChoice === 'long_term' ? 'active-choice' : ''}">
                            <div>
                                <div class="arbitrage-opt-title">
                                    <span>🛡️ Option 2 — Privilégier le Long Terme (24h–72h)</span>
                                    <span style="font-size: 0.72rem; background: #d1fae5; color: #065f46; padding: 2px 8px; border-radius: 999px; border: 1px solid #a7f3d0;">
                                        ~${longStats.kwhGain.toFixed(2)} kWh/j (~${longStats.eurGain.toFixed(2).replace('.', ',')} €)
                                    </span>
                                </div>
                                <div class="arbitrage-opt-desc">${longDesc}</div>
                                <div class="arbitrage-pros-cons">
                                    <div class="arbitrage-pro">${longPro}</div>
                                    <div class="arbitrage-con">${longCon}</div>
                                </div>
                            </div>
                            <button type="button" class="arbitrage-btn arbitrage-btn-long" onclick="window.solsticeApplyArbitrageOption('long_term')">
                                🛡️ Choisir & cocher les actions Long Terme ${longStats.count > 0 ? `(${longStats.count})` : ''}
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }

        // Formatage des badges visuels de gain (Confort PMV + Économie ou Coût financier honnête) selon le % de réactivité
        function formatGainBadgeHtml(unitImpact, factor, pct) {
            if (!unitImpact) return '';
            const effPmvNum = unitImpact.deltaPmv100 * factor;
            const effKwhNum = unitImpact.kwh100 * factor;
            const effEurNum = unitImpact.eur100 * factor;

            const pills = [];
            if (effPmvNum > 0.01) {
                pills.push(`<span class="impact-pill-pmv" title="Gain de confort thermique ressenti pondéré par votre réactivité (${pct}%)">🌡️ Confort (${pct}%) : +${effPmvNum.toFixed(2)} PMV</span>`);
            }
            if (effKwhNum > 0.01) {
                pills.push(`<span class="impact-pill-eur-pos" title="Énergie et dépenses évitées grâce à cette action">💶 Économie : +${effEurNum.toFixed(2).replace('.', ',')} € (+${effKwhNum.toFixed(2)} kWh)</span>`);
            } else if (effKwhNum < -0.01) {
                pills.push(`<span class="impact-pill-eur-neg" title="Coût énergétique de cet appoint actif de confort">⚡ Coût appoint : -${Math.abs(effEurNum).toFixed(2).replace('.', ',')} € (-${Math.abs(effKwhNum).toFixed(2)} kWh)</span>`);
            }
            return pills.join('');
        }

        function renderGroupedCards(groupList, container, emptyText) {
            if (!container) return;
            if (groupList.length === 0) {
                container.innerHTML = `<div style="color: #7f8c8d; font-style: italic; padding: 0.5rem 0;">${emptyText}</div>`;
                return;
            }

            groupList.forEach(group => {
                const totalRooms = group.items.length;
                const firstItem = group.items[0];
                const vMeta = firstItem?.visualMeta || lifecycleState.recos[firstItem?.id]?.visualMeta || {
                    icon: '⚙️', equip: 'ÉQUIPEMENT', bg: '#f1f5f9', color: '#334155', border: '#cbd5e1'
                };
                const timingLabel = group.level === 1
                    ? '🟢 À FAIRE MAINTENANT'
                    : (group.level === 2 ? '🕒 ANTICIPATION 24H' : '📅 STRATÉGIE 48-72H');

                // ============================================================
                // CAS 1 : UNE SEULE PIÈCE CONCERNÉE (Carte visuelle d'actionnable)
                // ============================================================
                if (totalRooms === 1) {
                    const item = group.items[0];
                    const tInfo = item.timeInfo || getActionTimeInfo(item, lifecycleState.recos[item.id]);
                    const uImp = item.unitImpact || lifecycleState.recos[item.id]?.unitImpact;
                    const gainPills = formatGainBadgeHtml(uImp, tInfo.factor, tInfo.percent);
                    const btnActionText = (item.actionKey === 'open_win_humidity' || item.actionKey === 'free_cooling')
                        ? `🪟 Ouvrir (${item.ventDurationMin || 6} min)`
                        : `✅ Fait`;

                    const card = document.createElement('div');
                    card.className = `reco-card reco-card-single ${item.type || group.type || ''}`;
                    card.style.cssText = "display: flex; align-items: stretch; gap: 14px;";
                    card.onclick = (e) => {
                        if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
                            window.solsticeToggleSingle(item.id, e);
                        }
                    };

                    card.innerHTML = `
                        <div class="actionable-visual-box" style="background: ${vMeta.bg}; color: ${vMeta.color}; border: 1px solid ${vMeta.border};">
                            <span class="actionable-icon-big">${vMeta.icon}</span>
                            <span class="actionable-name-tag">${vMeta.equip}</span>
                        </div>
                        <div style="flex: 1; min-width: 0;">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; flex-wrap: wrap; margin-bottom: 0.35rem;">
                                <div style="display: flex; gap: 7px; align-items: center; flex-wrap: wrap;">
                                    <span class="room-badge-bold">📍 ${item.zoneName}</span>
                                    <span class="level-badge level-${item.level}">${timingLabel}</span>
                                    <span class="badge-delay ${tInfo.delayClass}">⏱️ ${tInfo.elapsedText} • ${tInfo.percent}% (+${tInfo.currentPoints} pts)</span>
                                    ${item.occurrence > 1 ? `<span class="badge-occurrence">🔁 Interv. #${item.occurrence}</span>` : ''}
                                </div>
                                <button type="button" class="btn-validate-direct" onclick="window.solsticeToggleSingle('${item.id}', event)">
                                    ${btnActionText}
                                </button>
                            </div>
                            <div class="reco-title" style="margin-bottom: 0.25rem; font-size: 1.02rem;">${item.title}</div>
                            <div class="reco-text">${item.text}</div>
                            <div class="impact-pills-row">
                                ${gainPills}
                            </div>
                        </div>
                    `;

                    container.appendChild(card);
                    return;
                }

                // ============================================================
                // CAS 2 : PLUSIEURS PIÈCES CONCERNÉES (Carte groupée par Actionnable)
                // ============================================================
                const totalVerres = group.items.reduce((sum, item) => sum + (item.nbVerres || 0), 0);
                const verresGroupTxt = `~${totalVerres} verre${totalVerres > 1 ? 's' : ''} d'eau au total`;

                let groupTitle = group.title;
                let groupText = group.text;

                if (group.actionKey === 'open_win_humidity') {
                    groupTitle = `Ouvrir les fenêtres (${totalRooms} pièces — ${verresGroupTxt})`;
                    groupText = `Ouvrez les fenêtres dans les ${totalRooms} pièces concernées (avec minuteur automatique de fermeture) : vous évacuerez ${verresGroupTxt} sans entamer la chaleur des parois.`;
                } else if (group.actionKey === 'vmc_boost') {
                    groupTitle = `Activer la VMC anti-humidité (${totalRooms} pièces)`;
                    groupText = `Passez la VMC en extraction dans ces ${totalRooms} pièces pour évacuer la vapeur d'eau.`;
                } else if (group.actionKey === 'shutter_close') {
                    groupTitle = `Fermer les protections solaires (${totalRooms} pièces exposées)`;
                    groupText = `Fermez les volets ou stores dans les ${totalRooms} pièces au soleil pour bloquer le rayonnement direct avant le vitrage.`;
                } else if (group.actionKey === 'shutter_close_night' || group.actionKey === 'thermal_curtain') {
                    groupTitle = (group.level === 2)
                        ? `À ${sunsetHour}h00 : Fermer les volets et rideaux (${totalRooms} pièces)`
                        : `Fermer les volets et rideaux pour la nuit (${totalRooms} pièces)`;
                    groupText = (group.level === 2)
                        ? `Rendez-vous thermique au coucher du soleil (${sunsetHour}h00) : fermez les protections dans ces ${totalRooms} pièces pour piéger la chaleur des parois avant la nuit.`
                        : `Nuit tombée : fermez les volets/rideaux dans ces ${totalRooms} pièces pour couper l'effet paroi froide des vitrages (+0,45 °C radiants).`;
                } else if (group.actionKey === 'free_cooling') {
                    groupTitle = `Ouvrir les fenêtres — Rafraîchissement gratuit (${totalRooms} pièces)`;
                    groupText = `Il fait plus frais dehors (${envDataGlobal.t_ext.toFixed(1)} °C). Ouvrez dans ces ${totalRooms} pièces pour décharger l'air chaud.`;
                } else if (group.actionKey === 'sun_heat') {
                    groupTitle = `Ouvrir les volets/rideaux au soleil (${totalRooms} pièces exposées)`;
                    groupText = `Ouvrez grand les protections dans ces ${totalRooms} pièces ensoleillées pour chauffer gratuitement l'air et les parois.`;
                } else if (group.actionKey === 'clothing_adjust_warm') {
                    groupTitle = `Ajouter une couche vestimentaire (+0.25 Clo — ${totalRooms} pièces)`;
                    groupText = `Ciel sans soleil direct : gardez les volets ouverts pour la lumière du jour et ajoutez un pull fin ou gilet pour gagner +0,38 PMV sans surchauffer.`;
                } else if (group.actionKey === 'heating_cut') {
                    groupTitle = `Baisser le chauffage de -1 °C (${totalRooms} pièces)`;
                    groupText = `Valorisez la chaleur déjà présente dans ces ${totalRooms} pièces en abaissant le thermostat ou robinet thermostatique d'un cran (-1 °C).`;
                } else if (group.actionKey === 'heating_boost_comfort') {
                    groupTitle = `Appoint ciblé thermostat / robinet +0,5 °C (${totalRooms} pièces)`;
                    groupText = `Inconfort frais marqué sans relais solaire : relevez légèrement le thermostat ou robinet dans les pièces occupées.`;
                }

                const totalGroupCurrentPts = group.items.reduce((sum, item) => {
                    const itInfo = item.timeInfo || getActionTimeInfo(item, lifecycleState.recos[item.id]);
                    return sum + itInfo.currentPoints;
                }, 0);

                const avgGroupPmvGain = group.items.reduce((sum, item) => {
                    const itInfo = item.timeInfo || getActionTimeInfo(item, lifecycleState.recos[item.id]);
                    const uImp = item.unitImpact || lifecycleState.recos[item.id]?.unitImpact || { deltaPmv100: 0.15, kwh100: 0, eur100: 0 };
                    return sum + (uImp.deltaPmv100 * itInfo.factor);
                }, 0) / Math.max(1, totalRooms);

                const sumGroupKwh = group.items.reduce((sum, item) => {
                    const itInfo = item.timeInfo || getActionTimeInfo(item, lifecycleState.recos[item.id]);
                    const uImp = item.unitImpact || lifecycleState.recos[item.id]?.unitImpact || { deltaPmv100: 0.15, kwh100: 0, eur100: 0 };
                    return sum + (uImp.kwh100 * itInfo.factor);
                }, 0);

                const sumGroupEur = group.items.reduce((sum, item) => {
                    const itInfo = item.timeInfo || getActionTimeInfo(item, lifecycleState.recos[item.id]);
                    const uImp = item.unitImpact || lifecycleState.recos[item.id]?.unitImpact || { deltaPmv100: 0.15, kwh100: 0, eur100: 0 };
                    return sum + (uImp.eur100 * itInfo.factor);
                }, 0);

                const earliestItem = group.items.slice().sort((a, b) => (a.appearedAt || 0) - (b.appearedAt || 0))[0];
                const earliestInfo = earliestItem?.timeInfo || getActionTimeInfo(earliestItem, lifecycleState.recos[earliestItem?.id]);
                const groupGainPills = formatGainBadgeHtml(
                    { deltaPmv100: avgGroupPmvGain, kwh100: sumGroupKwh, eur100: sumGroupEur },
                    1.0,
                    earliestInfo.percent
                );

                const card = document.createElement('div');
                card.className = `reco-card ${group.type || ''}`;
                card.style.cssText = "display: flex; align-items: stretch; gap: 14px; width: 100%; box-sizing: border-box;";

                card.innerHTML = `
                    <div class="actionable-visual-box" style="background: ${vMeta.bg}; color: ${vMeta.color}; border: 1px solid ${vMeta.border};">
                        <span class="actionable-icon-big">${vMeta.icon}</span>
                        <span class="actionable-name-tag">${vMeta.equip}</span>
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 0.4rem; flex-wrap: wrap;">
                            <div style="display: flex; gap: 7px; align-items: center; flex-wrap: wrap;">
                                <span class="level-badge level-${group.level}">${timingLabel}</span>
                                <span class="badge-delay ${earliestInfo.delayClass}">⏱️ ${earliestInfo.elapsedText} • ${earliestInfo.percent}% (+${totalGroupCurrentPts} pts)</span>
                            </div>
                            <button type="button" class="btn-validate-direct" onclick="window.solsticeToggleGroup('${group.groupKey}', true)">
                                ⚡ Tout valider (${totalRooms} pièces)
                            </button>
                        </div>

                        <div class="reco-title" style="margin-bottom: 0.25rem; font-size: 1.02rem;">${groupTitle}</div>
                        <div class="reco-text" style="margin-bottom: 0.55rem;">${groupText}</div>

                        <div class="impact-pills-row" style="margin-bottom: 0.65rem;">
                            ${groupGainPills}
                        </div>

                        <div class="room-chips-container">
                            ${group.items.map(item => {
                                const itInfo = item.timeInfo || getActionTimeInfo(item, lifecycleState.recos[item.id]);
                                const chipVerres = item.nbVerres ? `~${item.nbVerres} verre${item.nbVerres > 1 ? 's' : ''}, ` : '';
                                return `
                                    <button type="button" 
                                            class="room-chip chip-pending" 
                                            onclick="window.solsticeToggleSingle('${item.id}', event)"
                                            title="Cliquer pour valider dans ${item.zoneName}">
                                        <span class="chip-check">⬜</span>
                                        <span class="chip-name">📍 ${item.zoneName}</span>
                                        <span class="chip-pts">${chipVerres}+${itInfo.currentPoints} pts</span>
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;

                container.appendChild(card);
            });
        }

        // Rendu dédié des actions complétées
        function renderCompletedCards(completedList, container, emptyText) {
            if (!container) return;
            if (!completedList || completedList.length === 0) {
                container.innerHTML = `<div style="color: #7f8c8d; font-style: italic; padding: 0.5rem 0;">${emptyText}</div>`;
                return;
            }

            completedList.forEach(item => {
                const card = document.createElement('div');
                card.className = `reco-card reco-card-single checked ${item.type || ''}`;
                card.style.cssText = "display: flex; gap: 12px; align-items: flex-start; opacity: 0.95;";
                card.onclick = (e) => {
                    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') {
                        window.solsticeToggleSingle(item.id, e);
                    }
                };

                const compDate = item.completedAt ? new Date(item.completedAt) : new Date();
                const compHour = `${String(compDate.getHours()).padStart(2, '0')}h${String(compDate.getMinutes()).padStart(2, '0')}`;
                const delayTxt = formatElapsedTime(item.elapsedMs || ((item.elapsedMin || 0) * 60000));
                const pts = item.earnedPoints ?? item.basePoints ?? item.impactWeight ?? 15;
                const pct = item.reactivityPercent ?? 100;
                const factor = pct / 100;
                const gainBadge = formatGainBadgeHtml(item.unitImpact, factor, pct);

                card.innerHTML = `
                    <div style="padding-top: 2px;">
                        <input type="checkbox" 
                               checked 
                               onchange="window.solsticeToggleSingle('${item.id}', event)" 
                               style="width: 20px; height: 20px; cursor: pointer; accent-color: #10B981;">
                    </div>
                    <div style="flex: 1;">
                        <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 0.35rem; flex-wrap: wrap;">
                            <span class="level-badge level-${item.level || 1}">Niveau ${item.level || 1}</span>
                            <span class="room-badge-bold">📍 ${item.zoneName || 'Habitat'}</span>
                            ${item.occurrence > 1 ? `<span class="badge-occurrence">🔁 Interv. #${item.occurrence}</span>` : ''}
                            <span class="completed-meta">✅ Réalisé à ${compHour} • Délai : ${delayTxt} (${pct}%)</span>
                            <span class="tag-weight" style="background: rgba(16, 185, 129, 0.15); color: #10B981; border: 1px solid rgba(16, 185, 129, 0.3);">+${pts} pts</span>
                            ${gainBadge}
                        </div>
                        <div class="reco-title" style="margin-bottom: 0.25rem; text-decoration: line-through; opacity: 0.85;">${item.title}</div>
                        <div class="reco-text" style="font-size: 0.82rem; color: #64748B;">${item.text}</div>
                    </div>
                `;

                container.appendChild(card);
            });
        }

        // ============================================================
        // MINUTEUR ACTIF DE FERMETURE DE FENÊTRE & NOTIFICATION
        // ============================================================
        function getActiveWindowTimers() {
            try {
                const raw = localStorage.getItem('SOLSTICE_WINDOW_TIMERS');
                return raw ? JSON.parse(raw) : {};
            } catch (e) {
                return {};
            }
        }

        function saveActiveWindowTimers(timers) {
            try {
                localStorage.setItem('SOLSTICE_WINDOW_TIMERS', JSON.stringify(timers));
            } catch (e) {}
        }

        function playWindowAlertChime() {
            try {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return;
                const ctx = new AudioCtx();
                const playTone = (freq, startOffset, duration) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffset);
                    gain.gain.setValueAtTime(0.18, ctx.currentTime + startOffset);
                    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + duration);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(ctx.currentTime + startOffset);
                    osc.stop(ctx.currentTime + startOffset + duration);
                };
                playTone(587.33, 0.0, 0.22); // Ré5
                playTone(880.00, 0.25, 0.38); // La5
            } catch (e) {}
        }

        function triggerWindowCloseNotification(timerObj) {
            playWindowAlertChime();
            if ('Notification' in window && Notification.permission === 'granted') {
                try {
                    new Notification(`🪟 SOLSTICE — Refermez la fenêtre (${timerObj.zoneName})`, {
                        body: `Les ${timerObj.durationMin} min d'aération dans ${timerObj.zoneName} sont écoulées. Refermez maintenant pour préserver la chaleur de vos parois !`,
                        icon: 'https://cdn-icons-png.flaticon.com/512/869/869869.png'
                    });
                } catch (e) {}
            }
        }

        function startWindowCloseTimerForItem(item) {
            if (!item || (item.actionKey !== 'open_win_humidity' && item.actionKey !== 'free_cooling')) return;
            if ('Notification' in window && Notification.permission === 'default') {
                try { Notification.requestPermission(); } catch (e) {}
            }
            const durationMin = item.ventDurationMin || (item.actionKey === 'free_cooling' ? 15 : 6);
            const timers = getActiveWindowTimers();
            timers[item.id] = {
                id: item.id,
                zoneName: item.zoneName || 'Pièce',
                actionKey: item.actionKey,
                durationMin: durationMin,
                startedAt: Date.now(),
                endsAt: Date.now() + (durationMin * 60 * 1000),
                notified: false
            };
            saveActiveWindowTimers(timers);
            renderActiveWindowTimers();
        }

        function removeWindowCloseTimerForId(id) {
            const timers = getActiveWindowTimers();
            if (timers[id]) {
                delete timers[id];
                saveActiveWindowTimers(timers);
                renderActiveWindowTimers();
            }
        }

        window.solsticeDismissWindowTimer = function(id) {
            removeWindowCloseTimerForId(id);
        };

        window.solsticeTestWindowTimerAlert = function(id) {
            const timers = getActiveWindowTimers();
            if (timers[id]) {
                timers[id].endsAt = Date.now() + 2000;
                timers[id].notified = false;
                saveActiveWindowTimers(timers);
                renderActiveWindowTimers();
            }
        };

        function renderActiveWindowTimers() {
            const banner = document.getElementById('active-window-timers-banner');
            if (!banner) return;
            const timers = getActiveWindowTimers();
            const keys = Object.keys(timers);
            if (keys.length === 0) {
                banner.style.display = 'none';
                banner.innerHTML = '';
                return;
            }

            const now = Date.now();
            let updatedStore = false;

            const cardsHtml = keys.map(k => {
                const t = timers[k];
                const remMs = t.endsAt - now;
                const isExpired = remMs <= 0;

                if (isExpired && !t.notified) {
                    t.notified = true;
                    updatedStore = true;
                    triggerWindowCloseNotification(t);
                }

                if (isExpired) {
                    return `
                        <div style="background: #fef2f2; border: 2px solid #ef4444; border-radius: 12px; padding: 14px 16px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.15);">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <span style="font-size: 1.5rem;">🔔</span>
                                <div>
                                    <div style="font-weight: 800; color: #991b1b; font-size: 0.98rem;">
                                        TEMPS D'AÉRATION ÉCOULÉ — 📍 ${t.zoneName}
                                    </div>
                                    <div style="font-size: 0.85rem; color: #b91c1c; margin-top: 2px;">
                                        Les ${t.durationMin} min sont terminées : <strong>refermez la fenêtre maintenant</strong> pour conserver la chaleur de vos parois !
                                    </div>
                                </div>
                            </div>
                            <button type="button" onclick="window.solsticeDismissWindowTimer('${t.id}')" style="background: #16a34a; color: white; border: none; border-radius: 8px; padding: 8px 14px; font-weight: 800; font-size: 0.85rem; cursor: pointer;">
                                ✅ J'ai refermé la fenêtre
                            </button>
                        </div>
                    `;
                } else {
                    const totalSec = Math.ceil(remMs / 1000);
                    const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
                    const ss = String(totalSec % 60).padStart(2, '0');
                    return `
                        <div style="background: #f0f9ff; border: 1px solid #38bdf8; border-radius: 12px; padding: 12px 16px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <span style="font-size: 1.35rem;">🪟</span>
                                <div>
                                    <div style="font-weight: 800; color: #0369a1; font-size: 0.92rem;">
                                        Aération en cours dans 📍 ${t.zoneName} — Refermez dans <span style="font-family: monospace; font-size: 1.05rem; background: #e0f2fe; padding: 2px 7px; border-radius: 6px; color: #0284c7;">${mm}:${ss}</span>
                                    </div>
                                    <div style="font-size: 0.8rem; color: #0c4a6e; margin-top: 2px;">
                                        Vous serez notifié automatiquement dès la fin du compte à rebours (${t.durationMin} min).
                                    </div>
                                </div>
                            </div>
                            <div style="display: flex; gap: 6px; align-items: center;">
                                <button type="button" onclick="window.solsticeTestWindowTimerAlert('${t.id}')" style="background: #e0f2fe; color: #0369a1; border: 1px solid #7dd3fc; border-radius: 6px; padding: 5px 10px; font-weight: 700; font-size: 0.75rem; cursor: pointer;" title="Tester l'alerte de fin de chrono dans 2 secondes">
                                    🔔 Tester alerte (2s)
                                </button>
                                <button type="button" onclick="window.solsticeDismissWindowTimer('${t.id}')" style="background: #ffffff; color: #475569; border: 1px solid #cbd5e1; border-radius: 6px; padding: 5px 10px; font-weight: 700; font-size: 0.75rem; cursor: pointer;">
                                    ✕ Refermée
                                </button>
                            </div>
                        </div>
                    `;
                }
            }).join('');

            if (updatedStore) saveActiveWindowTimers(timers);
            banner.style.display = 'block';
            banner.innerHTML = cardsHtml;
        }

        setInterval(renderActiveWindowTimers, 1000);

        window.solsticeToggleSingle = function(id, event) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            const now = Date.now();
            let item = lifecycleState.recos[id];
            if (!item) {
                item = { id, appearedAt: now, status: 'active' };
                lifecycleState.recos[id] = item;
            }

            if (item.status === 'completed') {
                // Décochage : Restauration de l'état actif (réversibilité stricte)
                item.status = 'active';
                item.completedAt = null;
                item.earnedPoints = null;
                item.reactivityPercent = null;
                removeWindowCloseTimerForId(item.id);

                // Nettoyer les occurrences actives ultérieures redondantes pour ce même baseId
                const baseId = item.baseId || item.id.split('#')[0];
                Object.values(lifecycleState.recos || {}).forEach(other => {
                    if (other.id !== item.id && (other.baseId === baseId || other.id.startsWith(baseId + '#'))) {
                        if (other.status === 'active') {
                            delete lifecycleState.recos[other.id];
                        }
                    }
                });
            } else {
                // Cochage : Calcul précis des points avec dépréciation temporelle
                const timeInfo = getActionTimeInfo(item, item);
                item.status = 'completed';
                item.completedAt = now;
                item.earnedPoints = timeInfo.currentPoints;
                item.reactivityPercent = timeInfo.percent;
                item.elapsedMin = timeInfo.elapsedMin;
                item.elapsedMs = timeInfo.elapsedMs;
                startWindowCloseTimerForItem(item);
            }

            const completedMap = {};
            Object.values(lifecycleState.recos || {}).forEach(i => {
                if (i.status === 'completed') completedMap[i.id] = true;
            });
            localStorage.setItem('SOLSTICE_CHECKED_RECOS', JSON.stringify(completedMap));

            saveRecoLifecycleState(lifecycleState);
            render();
        };

        window.solsticeToggleGroup = function(groupKey, targetState) {
            const now = Date.now();
            const allRecs = getAllRecommendations();
            allRecs.filter(r => `${r.actionKey}__${r.level}__${r.timing}` === groupKey).forEach(rec => {
                let item = lifecycleState.recos[rec.id];
                if (!item) {
                    item = { 
                        id: rec.id, 
                        baseId: rec.baseId,
                        occurrence: rec.occurrence || 1,
                        actionKey: rec.actionKey,
                        zoneId: rec.zoneId,
                        zoneName: rec.zoneName,
                        title: rec.title,
                        text: rec.text,
                        level: rec.level,
                        timing: rec.timing,
                        type: rec.type,
                        impactWeight: rec.impactWeight,
                        ventDurationMin: rec.ventDurationMin || 6,
                        unitImpact: rec.unitImpact,
                        appearedAt: rec.appearedAt || now, 
                        status: 'active' 
                    };
                    lifecycleState.recos[rec.id] = item;
                }

                if (targetState) {
                    const timeInfo = getActionTimeInfo(rec, item);
                    item.status = 'completed';
                    item.completedAt = now;
                    item.earnedPoints = timeInfo.currentPoints;
                    item.reactivityPercent = timeInfo.percent;
                    item.elapsedMin = timeInfo.elapsedMin;
                    item.elapsedMs = timeInfo.elapsedMs;
                    startWindowCloseTimerForItem(item);
                } else {
                    item.status = 'active';
                    item.completedAt = null;
                    item.earnedPoints = null;
                    item.reactivityPercent = null;
                    removeWindowCloseTimerForId(item.id);
                }
            });

            const completedMap = {};
            Object.values(lifecycleState.recos || {}).forEach(i => {
                if (i.status === 'completed') completedMap[i.id] = true;
            });
            localStorage.setItem('SOLSTICE_CHECKED_RECOS', JSON.stringify(completedMap));

            saveRecoLifecycleState(lifecycleState);
            render();
        };

        // ============================================================
        // MOTEUR DE CALCUL THERMODYNAMIQUE DYNAMIQUE
        // ============================================================
        function calculateFinancialImpact(allRecs) {
            let savedKwhDay = 0;
            let savedEurDay = 0;
            let earnedPointsToday = 0;

            const selectedZone = zoneSelect ? zoneSelect.value : currentZoneId;
            const defaultCostPerKwh = getEnergyCostPerKwh(houseConfig[selectedZone] || null);

            const completedItems = Object.values(lifecycleState.recos || {}).filter(item => item.status === 'completed');

            completedItems.forEach(item => {
                earnedPointsToday += (item.earnedPoints ?? item.basePoints ?? item.impactWeight ?? 15);
                const reactivityFactor = (item.reactivityPercent !== undefined ? item.reactivityPercent / 100 : 1.0);

                if (item.unitImpact && typeof item.unitImpact.kwh100 === 'number') {
                    const itemKwh = item.unitImpact.kwh100 * reactivityFactor;
                    const itemEur = (typeof item.unitImpact.eur100 === 'number')
                        ? (item.unitImpact.eur100 * reactivityFactor)
                        : (itemKwh * defaultCostPerKwh);
                    savedKwhDay += itemKwh;
                    savedEurDay += itemEur;
                    return;
                }
            });

            return { savedKwhDay, savedEurDay, earnedPointsToday };
        }

        function updateMetrics(allRecs) {
            const { savedKwhDay, savedEurDay, earnedPointsToday } = calculateFinancialImpact(allRecs);

            let pendingPossiblePoints = 0;
            allRecs.forEach(r => {
                const item = lifecycleState.recos[r.id];
                if (!item || item.status !== 'completed') {
                    pendingPossiblePoints += (r.timeInfo?.currentPoints || r.impactWeight || 15);
                }
            });

            const totalPossiblePointsToday = earnedPointsToday + pendingPossiblePoints;

            let totalHistoricalScorePts = parseInt(localStorage.getItem('SOLSTICE_CAGNOTTE_SCORE_PTS')) || 0;
            let totalCagnotteEur = parseFloat(localStorage.getItem('SOLSTICE_CAGNOTTE_EUR')) || 0.0;

            const todayScoreEl = document.getElementById('disp-today-score');
            const scoreBarEl = document.getElementById('scoreBar');
            if (todayScoreEl) {
                todayScoreEl.textContent = `+${earnedPointsToday} / +${totalPossiblePointsToday} pts`;
            }
            if (scoreBarEl) {
                const pctToday = totalPossiblePointsToday > 0 ? Math.round((earnedPointsToday / totalPossiblePointsToday) * 100) : 100;
                scoreBarEl.style.width = `${pctToday}%`;
            }

            const totalXpEl = document.getElementById('disp-total-xp');
            if (totalXpEl) {
                totalXpEl.textContent = `${totalHistoricalScorePts + earnedPointsToday} pts XP`;
            }

            const eurDayEl = document.getElementById('disp-daily-savings-eur');
            const kwhDayEl = document.getElementById('disp-daily-savings-kwh');
            const totalEurEl = document.getElementById('disp-cagnotte-total');

            if (eurDayEl) eurDayEl.textContent = `${savedEurDay.toFixed(2)} €`;
            if (kwhDayEl) kwhDayEl.textContent = `${savedKwhDay.toFixed(2)} kWh/j évités aujourd'hui`;
            if (totalEurEl) totalEurEl.textContent = `${(totalCagnotteEur + savedEurDay).toFixed(2)} €`;

            const dispInitEl = document.getElementById('disp-pmv-init');
            const simEl = document.getElementById('disp-pmv-sim');
            const selectedZone = zoneSelect ? zoneSelect.value : currentZoneId;
            const zonesMap = getAvailableZonesMap();

            // Alignement strict avec le Tableau de Bord (engine.js) + prise en compte de tStruct (2R2C)
            if (selectedZone === 'all') {
                let totalVol = 0;
                let weightedPmvInit = 0;
                let weightedPmvSim = 0;

                const includeBuffer = localStorage.getItem('SOLSTICE_INCLUDE_BUFFER') !== 'false';
                const scanData = (store.getScanData && store.getScanData()) || {};

                Object.keys(scanData).forEach(nomPiece => {
                    if (nomPiece === '__ENV__' || nomPiece === '__BUFFER_TOGGLE__') return;
                    const rData = scanData[nomPiece];
                    if (!rData || rData.ta === undefined || isNaN(rData.ta) || rData.rh === undefined || isNaN(rData.rh)) return;

                    const zConfig = (engine.getZoneConfigByName ? engine.getZoneConfigByName(nomPiece) : null) 
                                 || houseConfig[nomPiece] 
                                 || Object.values(houseConfig).find(z => z && z.name === nomPiece)
                                 || { area: 15, height: 2.5 };

                    const zId = Object.keys(houseConfig).find(k => houseConfig[k]?.name === nomPiece) || nomPiece.toLowerCase().replace(/[^a-z0-9]/g, '_');

                    if (engine.isOutdoorZone ? engine.isOutdoorZone(nomPiece, zConfig) : isExteriorZone(zId, zConfig)) return;
                    if (!includeBuffer && (engine.isBufferZone ? engine.isBufferZone(nomPiece, zConfig) : isBufferZone(zId, zConfig))) return;

                    const area = parseFloat(zConfig.area) || 15;
                    const height = parseFloat(zConfig.height) || 2.5;
                    const vol = area * height;

                    const baseTa = rData.ta;
                    const baseRh = rData.rh ?? 50;
                    const tStruct = engine.updateStructureTemperature ? engine.updateStructureTemperature(nomPiece, baseTa) : baseTa;
                    const baseTr = engine.calculateMeanRadiantTemp ? engine.calculateMeanRadiantTemp(zConfig, baseTa, tStruct) : baseTa;
                    const baseVel = engine.calculateAirVelocity ? engine.calculateAirVelocity(zConfig, nomPiece) : 0.1;
                    const { met, totalClo } = engine.getBaseCloAndMet ? engine.getBaseCloAndMet(zConfig) : { met: 1.2, totalClo: 1.0 };

                    const pmvI = engine.calculatePMV ? engine.calculatePMV(baseTa, baseTr, baseVel, baseRh, met, totalClo) : 0;

                    // Actions cochées pour cette pièce et réactivité moyenne
                    const checkedActionKeys = [];
                    let sumRf = 0;
                    Object.values(lifecycleState.recos || {}).forEach(item => {
                        if (item.status === 'completed' && (item.zoneId === zId || item.zoneName === nomPiece)) {
                            checkedActionKeys.push(item.actionKey);
                            sumRf += ((item.reactivityPercent ?? 100) / 100);
                        }
                    });
                    const avgRf = checkedActionKeys.length > 0 ? (sumRf / checkedActionKeys.length) : 1.0;

                    const baseState = { ta: baseTa, tr: baseTr, vel: baseVel, rh: baseRh, met, clo: totalClo, reactivityFactor: avgRf };
                    const simRes = engine.evaluateSimulatedPMV ? engine.evaluateSimulatedPMV(baseState, checkedActionKeys, envDataGlobal) : { pmv: pmvI };

                    totalVol += vol;
                    weightedPmvInit += pmvI * vol;
                    weightedPmvSim += simRes.pmv * vol;
                });

                const finalPmvInit = totalVol > 0 ? (weightedPmvInit / totalVol) : 0;
                const finalPmvSim = totalVol > 0 ? (weightedPmvSim / totalVol) : 0;

                if (dispInitEl) dispInitEl.textContent = (finalPmvInit > 0 ? "+" : "") + finalPmvInit.toFixed(2);
                if (simEl) {
                    simEl.textContent = (finalPmvSim > 0 ? "+" : "") + finalPmvSim.toFixed(2);
                    simEl.style.color = Math.abs(finalPmvSim) <= 0.5 ? '#4ade80' : (finalPmvSim > 0.5 ? '#f87171' : '#38bdf8');
                }
            } else {
                const roomName = zonesMap[selectedZone] || selectedZone;
                const targetZoneConfig = houseConfig[selectedZone] || null;
                const roomData = donneesHabitat[roomName] || { ta: 20, rh: 50 };

                const baseTa = roomData.ta;
                const tStruct = engine.updateStructureTemperature ? engine.updateStructureTemperature(roomName, baseTa) : baseTa;
                const baseTr = engine.calculateMeanRadiantTemp ? engine.calculateMeanRadiantTemp(targetZoneConfig, baseTa, tStruct) : baseTa;
                const baseVel = engine.calculateAirVelocity ? engine.calculateAirVelocity(targetZoneConfig, roomName) : 0.1;
                const { met, totalClo } = engine.getBaseCloAndMet ? engine.getBaseCloAndMet(targetZoneConfig) : { met: 1.2, totalClo: 1.0 };

                const checkedActionKeys = [];
                let sumRf = 0;
                Object.values(lifecycleState.recos || {}).forEach(item => {
                    if (item.status === 'completed' && (item.zoneId === selectedZone || item.zoneName === roomName)) {
                        checkedActionKeys.push(item.actionKey);
                        sumRf += ((item.reactivityPercent ?? 100) / 100);
                    }
                });
                const avgRf = checkedActionKeys.length > 0 ? (sumRf / checkedActionKeys.length) : 1.0;

                const baseState = { ta: baseTa, tr: baseTr, vel: baseVel, rh: roomData.rh, met, clo: totalClo, reactivityFactor: avgRf };
                const pmvInit = engine.calculatePMV ? engine.calculatePMV(baseTa, baseTr, baseVel, roomData.rh, met, totalClo) : 0;
                const simulation = engine.evaluateSimulatedPMV ? engine.evaluateSimulatedPMV(baseState, checkedActionKeys, envDataGlobal) : { pmv: pmvInit };

                if (dispInitEl) dispInitEl.textContent = (pmvInit > 0 ? "+" : "") + pmvInit.toFixed(2);
                if (simEl) {
                    const pmvSimulated = simulation.pmv;
                    simEl.textContent = (pmvSimulated > 0 ? "+" : "") + pmvSimulated.toFixed(2);
                    simEl.style.color = Math.abs(pmvSimulated) <= 0.5 ? 'var(--eco, #2ecc71)' : (pmvSimulated > 0.5 ? 'var(--hot, #e74c3c)' : 'var(--cold, #3498db)');
                }
            }

            // Mise à jour dynamique du Score de Maîtrise du Confort (sur 100)
            const completedRatio = totalPossiblePointsToday > 0 ? (earnedPointsToday / totalPossiblePointsToday) : 0.0;
            const habitatMetrics = (engine.calculateGlobalHabitatMetrics ? engine.calculateGlobalHabitatMetrics() : null) || {
                avgPMV: 0,
                avgRH: 50,
                avgTau: 20,
                totalBilanNetKwh: 0
            };
            const harmonyFn = engine.calculateHabitatHarmonyScore || engine.calculateHabitatAccordageScore;
            const harmony = (harmonyFn ? harmonyFn(habitatMetrics, completedRatio) : null) || {
                score: Math.min(100, Math.round(70 + (completedRatio * 30))),
                badge: "Maîtrise Optimale",
                color: "#10B981"
            };

            const accordageScoreEl = document.getElementById('disp-accordage-score');
            const accordageBadgeEl = document.getElementById('disp-accordage-badge');
            const accordageBarEl = document.getElementById('accordageBar');

            if (accordageScoreEl) accordageScoreEl.innerHTML = `${harmony.score} <span class="unit" style="font-size: 1rem; color: #94A3B8;">/ 100</span>`;
            if (accordageBadgeEl) {
                accordageBadgeEl.textContent = harmony.badge;
                accordageBadgeEl.style.color = harmony.color;
            }
            if (accordageBarEl) accordageBarEl.style.width = `${harmony.score}%`;
        }

        window.resetCagnotte = function() {
            localStorage.removeItem('SOLSTICE_CAGNOTTE_EUR');
            localStorage.removeItem('SOLSTICE_CAGNOTTE_SCORE_PTS');
            localStorage.removeItem('SOLSTICE_RECO_LIFECYCLE');
            lifecycleState = { lastDate: TODAY_KEY, recos: {} };
            render();
        };

        render();

    } catch (err) {
        console.error("Erreur d'initialisation Solstice Recos :", err);
    }
});
