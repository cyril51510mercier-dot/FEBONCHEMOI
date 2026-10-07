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

            // 4. Scan Data __ENV__
            const scanData = (store.getScanData && store.getScanData()) || {};
            if (scanData['__ENV__']) {
                const env = scanData['__ENV__'];
                if (typeof env.outdoorTemp === 'number') tExt = env.outdoorTemp;
                if (typeof env.outdoorHumidity === 'number') rhExt = env.outdoorHumidity;
                if (env.sunshineStatus) sunStatus = env.sunshineStatus;
            }

            return {
                t_ext: tExt,
                rh_ext: rhExt,
                sun_status: sunStatus,
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

        // Recherche robuste du profil utilisateur
        const globalConfig = houseConfig.global || {};
        const activeProfileKey = globalConfig.userProfile 
                              || globalConfig.profile 
                              || houseConfig.userProfile 
                              || houseConfig.profile 
                              || 'mid_term';

        const forcedSeason = globalConfig.forcedSeason;
        const manualHeating = globalConfig.heatingSeasonActive;
        const autoHeating = envDataGlobal.t_ext < 15;
        const isHeatingSeasonActive = (forcedSeason === 'heating') 
            ? true 
            : ((forcedSeason === 'auto') 
                ? autoHeating 
                : (manualHeating !== undefined && manualHeating !== null ? manualHeating : autoHeating));

        const profilesDef = engine.PROFILES || {
            short_term: { label: "Court termiste", allowedLevels: [1], maxDeltaPmv: 0.0 },
            mid_term:   { label: "Moyen termiste", allowedLevels: [1, 2], maxDeltaPmv: 0.3 },
            long_term:  { label: "Long termiste",  allowedLevels: [1, 2, 3], maxDeltaPmv: 0.6 }
        };
        const activeProfile = profilesDef[activeProfileKey] || profilesDef.mid_term;

        if (profileIndicator) {
            profileIndicator.textContent = `Profil : ${activeProfile.label} (Tolérance PMV ±${activeProfile.maxDeltaPmv})`;
        }

        const currentHour = new Date().getHours();
        const isMorning = currentHour >= 6 && currentHour < 12;
        const isAfternoon = currentHour >= 12 && currentHour < 18;
        const isEvening = currentHour >= 17 && currentHour < 23;
        const isNight = currentHour >= 21 || currentHour < 7;

        const tExtMaxDay = envDataGlobal.t_ext_max || (envDataGlobal.t_ext + 3);
        const tExtMinDay = envDataGlobal.t_ext_min || (envDataGlobal.t_ext - 5);

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

            const tStruct = engine.updateStructureTemperature ? engine.updateStructureTemperature(zoneName, ta) : ta;
            const rawReserve = engine.calculateStructureReserve ? engine.calculateStructureReserve(tStruct, ta, volume, tau) : {};

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

            const tr = engine.calculateMeanRadiantTemp ? engine.calculateMeanRadiantTemp(zone, ta) : ta;
            const vel = engine.calculateAirVelocity ? engine.calculateAirVelocity(zone, zoneName) : 0.1;
            const { met, totalClo } = engine.getBaseCloAndMet ? engine.getBaseCloAndMet(zone) : { met: 1.2, totalClo: 1.0 };

            const roomPmv = engine.calculatePMV ? engine.calculatePMV(ta, tr, vel, rh, met, totalClo) : 0;
            const needsHeat = roomPmv < -0.4;
            const needsCooling = roomPmv > 0.4;
            const isSunny = (envDataGlobal.sun_status || '').toLowerCase().includes('clear') || (envDataGlobal.sun_status || '').toLowerCase().includes('sun');

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
            
            const hasShutters = !zone?.windows || zone.windows.length === 0 || zone.windows.some(w => !w.shutter || w.shutter !== 'aucun');
            const hasInteriorCurtains = zone?.windows?.some(w => w.shutter === 'rideau_interieur' || w.shutter === 'store_interieur');
            const hasVmc = zone?.equipment?.vmcSystem && zone.equipment.vmcSystem !== 'aucun' && zone.equipment.vmcSystem !== 'none';

            const adj = zone?.adj || {};
            const hasUnheatedDoor = zone?.hasBufferDoor || adj.hasBufferDoor || 
                                    [1, 2, 3, 4].some(i => adj[`wall${i}`] === 'unheated' && adj[`doorWall${i}`]);

            const hasEastWestWin = zone?.windows?.some(w => ['E', 'W'].includes(w.orient));
            const hasRoofWin = zone?.windows?.some(w => w.tilt === 'inclinee');

            // Helper unifié d'enregistrement avec cycle de vie, occurrence et dépréciation temporelle
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

                let appearedAt = Date.now();
                if (lifecycleState.recos[finalId]) {
                    appearedAt = lifecycleState.recos[finalId].appearedAt || appearedAt;
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
                        nbVerres: recData.nbVerres || 0
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
                    timeInfo: timeInfo
                });
            }

            // --- NIVEAU 1 : ACTIONS IMMÉDIATES (< 1h) ---

            // Aération différentielle unifiée avec le moteur Solstice
            const vent = (engine.calculateDifferentialVentilation ? engine.calculateDifferentialVentilation(zone, roomData, envDataGlobal) : null) || {
                status: (rh > 60 && deltaAh >= 0.4 && ahExt < ahInt) ? 'recommended_dry' : (ahExt >= ahInt ? 'blocked_humid' : 'comfort'),
                verresTxt,
                nbVerres,
                mEau,
                optimalDurationMin: (mainVentType === 'oscillante' || mainVentType === 'oscillo_battante' || mainVentType === 'partial') ? 12 : 6,
                hasVmc,
                canOpenWin: canOpenWindows
            };

            const ventDuration = `${vent.optimalDurationMin || 6} min`;
            const effectiveVerresTxt = vent.verresTxt || verresTxt;
            const effectiveNbVerres = vent.nbVerres || nbVerres;
            const effectiveMEau = vent.mEau !== undefined ? vent.mEau : mEau;

            if (vent.status === 'urgent_dry' || vent.status === 'recommended_dry') {
                if (canOpenWindows) {
                    const titleText = isWetRoom ? `Purge à la source (${effectiveVerresTxt})` : `Aération flash ciblée (${effectiveVerresTxt})`;
                    const actionText = isWetRoom 
                        ? `L'humidité atteint ${rh} %. Ouvrez la fenêtre en grand ${ventDuration} pour évacuer ${effectiveVerresTxt} sans refroidir les parois.`
                        : `Ouvrez la fenêtre en grand ${ventDuration} : vous évacuerez ${effectiveVerresTxt} sans entamer la chaleur des murs massifs.`;
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
                        mEau: effectiveMEau
                    });
                } else if (hasVmc) {
                    const titleText = isWetRoom ? `Boost VMC anti-humidité (${effectiveVerresTxt})` : `Boost VMC anti-humidité`;
                    const actionText = `L'humidité atteint ${rh} % (air ext. asséchant). Passez la VMC en vitesse rapide pour extraire la vapeur d'eau (${effectiveVerresTxt}).`;
                    pushRec({ 
                        id: `${zoneId}_vmc_boost`, 
                        level: 1, 
                        actionKey: 'vmc_boost', 
                        zoneId, 
                        zoneName, 
                        timing: 'immediate', 
                        type: 'type-air', 
                        title: titleText, 
                        text: actionText, 
                        impactWeight: 15,
                        nbVerres: effectiveNbVerres,
                        mEau: effectiveMEau
                    });
                } else {
                    // Pièce sans ouvrant direct vers l'extérieur et sans VMC (Cave, cellier, dégagement)
                    pushRec({
                        id: `${zoneId}_open_door_humidity`,
                        level: 1,
                        actionKey: 'open_door_humidity',
                        zoneId,
                        zoneName,
                        timing: 'immediate',
                        type: 'type-air',
                        title: `🚪 Aération indirecte / Ouvrir porte (${effectiveVerresTxt})`,
                        text: `Pièce sans ouvrant direct vers l'extérieur : ouvrez la porte vers une zone aérée pour chasser ${effectiveVerresTxt} et assainir la pièce tampon.`,
                        impactWeight: 15,
                        nbVerres: effectiveNbVerres,
                        mEau: effectiveMEau
                    });
                }
            } else if (vent.status === 'blocked_humid' && hasVmc && rh > 60) {
                // Air extérieur saturé mais présence de VMC dans une pièce humide
                pushRec({ 
                    id: `${zoneId}_vmc_boost`, 
                    level: 1, 
                    actionKey: 'vmc_boost', 
                    zoneId, 
                    zoneName, 
                    timing: 'immediate', 
                    type: 'type-air', 
                    title: `Boost VMC anti-humidité (${effectiveVerresTxt})`, 
                    text: `L'air extérieur est plus chargé en humidité (${ahExt.toFixed(1)} g/m³). Activez la VMC à la source pour évacuer la vapeur (${effectiveVerresTxt}) sans ouvrir les fenêtres.`, 
                    impactWeight: 15,
                    nbVerres: effectiveNbVerres,
                    mEau: effectiveMEau
                });
            }

            const isOutdoorHeatwaveThreat = tExtMaxDay > (ta + 1.5);
            if (needsCooling && envDataGlobal.t_ext < ta && canOpenWindows && (isOutdoorHeatwaveThreat || ta > 23)) {
                pushRec({ id: `${zoneId}_free_cooling`, level: 1, actionKey: 'free_cooling', zoneId, zoneName, timing: 'immediate', type: 'type-cool', title: 'Surventilation traversante (Free-cooling)', text: `Il fait plus frais dehors (${envDataGlobal.t_ext} °C). Ouvrez pour décharger l'air chaud.`, impactWeight: 20 });
            }

            if (isHeatingSeasonActive && needsHeat && envDataGlobal.t_ext < 10 && (zone?.equipment?.heating?.system && zone.equipment.heating.system !== 'none') && canOpenWindows) {
                pushRec({ id: `${zoneId}_heating_cut_during_ventilation`, level: 1, actionKey: 'heating_cut', zoneId, zoneName, timing: 'immediate', type: 'type-eco', title: 'Coupure du chauffage pendant l\'aération', text: `Coupez le chauffage dans cette pièce pendant l'ouverture des fenêtres.`, impactWeight: 10 });
            }

            if (needsCooling && isSunny && hasShutters) {
                pushRec({ id: `${zoneId}_shutter_close`, level: 1, actionKey: 'shutter_close', zoneId, zoneName, timing: 'immediate', type: 'type-sun', title: 'Bouclier solaire immédiat', text: `Fermez les volets pour bloquer le rayonnement direct avant le vitrage.`, impactWeight: 25 });
            }

            if (needsCooling && isSunny && hasEastWestWin && (isMorning || isAfternoon)) {
                pushRec({ id: `${zoneId}_targeted_orientation_shield`, level: 1, actionKey: 'shutter_close', zoneId, zoneName, timing: 'immediate', type: 'type-sun', title: 'Bouclier solaire orienté Est / Ouest', text: `Fermez les volets de la façade exposée au soleil rasant (${isMorning ? 'Est' : 'Ouest'}).`, impactWeight: 18 });
            }

            if (needsCooling && isSunny && hasRoofWin) {
                pushRec({ id: `${zoneId}_roof_window_shield`, level: 1, actionKey: 'shutter_close', zoneId, zoneName, timing: 'immediate', type: 'type-sun', title: 'Protection prioritaire des fenêtres de toit', text: `Occultez les Velux : le rayonnement sous toiture est la cause principale de surchauffe.`, impactWeight: 22 });
            }

            if (needsHeat && isSunny && envDataGlobal.t_ext < ta) {
                pushRec({ id: `${zoneId}_sun_heat`, level: 1, actionKey: 'sun_heat', zoneId, zoneName, timing: 'immediate', type: 'type-sun', title: 'Chauffage solaire passif', text: `Ouvrez les protections pour laisser le soleil chauffer gratuitement les parois.`, impactWeight: 20 });
            }

            if (needsHeat && !isSunny && isNight) {
                pushRec({ id: `${zoneId}_winter_night_shutters`, level: 1, actionKey: 'shutter_close', zoneId, zoneName, timing: 'immediate', type: 'type-sun', title: 'Bouclier thermique nocturne', text: `Fermez volets et rideaux dès la tombée du jour pour créer une lame d'air isolante.`, impactWeight: 12 });
            }

            if (needsHeat && hasInteriorCurtains && zone?.windows?.some(w => w.glass === 'single' || w.glass === 'double_old')) {
                pushRec({ id: `${zoneId}_single_glass_thermal_curtain`, level: 1, actionKey: 'shutter_close', zoneId, zoneName, timing: 'immediate', type: 'type-heat', title: 'Rideau épais sur vitrage ancien', text: `Tirez les rideaux épais le soir pour isoler la vitre froide et remonter la température radiante.`, impactWeight: 12 });
            }

            if (isHeatingSeasonActive && roomPmv > 0.3 && zone?.equipment?.heating?.regulation?.includes('thermostatic_valve')) {
                pushRec({ id: `${zoneId}_thermostatic_balancing`, level: 1, actionKey: 'heating_cut', zoneId, zoneName, timing: 'immediate', type: 'type-eco', title: 'Équilibrage par robinet thermostatique', text: `Réduisez le robinet d'un cran dans cette pièce pour réorienter l'eau chaude vers les pièces froides.`, impactWeight: 12 });
            }

            if (needsCooling && zone?.equipment?.fanSystem && zone.equipment.fanSystem !== 'aucun') {
                pushRec({ id: `${zoneId}_fan_on`, level: 1, actionKey: 'fan_on', zoneId, zoneName, timing: 'immediate', type: 'type-eco', title: `Activer le brassage d'air (${zone.equipment.fanSystem})`, text: `Le flux d'air rafraîchit le ressenti cutané de 2 °C sans climatisation.`, impactWeight: 18 });
            }

            if (!isBuffer && hasUnheatedDoor) {
                pushRec({ id: `${zoneId}_buffer_door_close`, level: 1, actionKey: 'heating_cut', zoneId, zoneName, timing: 'immediate', type: 'type-eco', title: 'Fermeture de la porte du local non chauffé', text: `Conservez la porte fermée avec le local non chauffé (garage/cellier) pour éviter les fuites thermiques.`, impactWeight: 12 });
            }

            if (isHeatingSeasonActive && reserve.chargeCalories >= 75) {
                pushRec({ id: `${zoneId}_high_calorie_stock_eco`, level: 1, actionKey: 'heating_cut', zoneId, zoneName, timing: 'immediate', type: 'type-eco', title: 'Valorisation de l\'inertie chaude (Calories > 75 %)', text: `Les murs sont gorgés de chaleur (${reserve.chargeCalories} %). Baissez la consigne d'un degré.`, impactWeight: 16 });
            }

            // --- NIVEAU 2 : OPPORTUNISME 24H ---
            if (needsCooling && isSunny && hasShutters && isMorning) {
                pushRec({ id: `${zoneId}_anticipate_sun`, level: 2, actionKey: 'anticipate_sun', zoneId, zoneName, timing: 'anticipated', type: 'type-sun', title: 'Occultation préventive du matin', text: `Fermez les volets dès 10h pour devancer le pic de chaleur de l'après-midi.`, impactWeight: 15 });
            }

            if (isHeatingSeasonActive && needsHeat && zone?.equipment?.heating?.system === 'floor') {
                pushRec({ id: `${zoneId}_floor_inertia`, level: 2, actionKey: 'floor_inertia', zoneId, zoneName, timing: 'anticipated', type: 'type-heat', title: 'Anticipation plancher chauffant', text: `Relancez la consigne 3 heures à l'avance pour compenser la forte inertie.`, impactWeight: 15 });
            }

            if (isHeatingSeasonActive && zone?.usages?.includes('bedroom') && needsHeat && isEvening) {
                pushRec({ id: `${zoneId}_bedroom_temp_drop`, level: 2, actionKey: 'bedroom_temp', zoneId, zoneName, timing: 'anticipated', type: 'type-eco', title: 'Consigne nocturne en chambre (17 °C à 18 °C)', text: `Réglez le thermostat à 17-18 °C 1h avant le coucher.`, impactWeight: 12 });
            }

            // --- NIVEAU 3 : STRATÉGIE MÉTÉO (48h-72h) ---
            const surchauffeInterieure = (tStruct >= 24.0 || ta >= 24.0);
            const vraieSurchauffeExterieure = (envDataGlobal.t_ext >= 22.0 && tExtMinDay >= 18.0);
            const nuitsFraichesOuIntersaison = (tExtMinDay < 18.0 || envDataGlobal.t_ext < 19.0 || isHeatingSeasonActive);

            if (surchauffeInterieure && vraieSurchauffeExterieure && !nuitsFraichesOuIntersaison && reserve.chargeFrigories < 35 && canOpenWindows) {
                pushRec({ id: `${zoneId}_low_frigorie_stock`, level: 3, actionKey: 'free_cooling', zoneId, zoneName, timing: 'strategic', type: 'type-cool', title: 'Décharge nocturne prioritaire (Canicule)', text: `La structure est saturée en chaleur. Ouvrez les fenêtres cette nuit pour refroidir la masse des murs.`, impactWeight: 22 });
            }

            // Stratégie 48h : Pré-charge solaire de la dalle avant vague de froid
            if (isHeatingSeasonActive && isSunny && (tExtMinDay < 8.0 || tExtMaxDay < 13.0)) {
                pushRec({
                    id: `${zoneId}_solar_precharge_cold_snap`,
                    level: 3,
                    actionKey: 'sun_heat',
                    zoneId,
                    zoneName,
                    timing: 'strategic',
                    type: 'type-sun',
                    title: '🧱 Pré-charge solaire de la dalle (Anticipation 48h)',
                    text: `Baisse de température annoncée. Laissez le soleil darder les parois et sols tout l'après-midi pour stocker un maximum de calories gratuites avant la vague de fraîcheur.`,
                    impactWeight: 20
                });
            }

            // Stratégie 48h : Sur-ventilation nocturne profonde avant pic caniculaire
            if (!isHeatingSeasonActive && tExtMaxDay >= 28.0 && envDataGlobal.t_ext < tStruct && canOpenWindows) {
                pushRec({
                    id: `${zoneId}_heatwave_preventive_flush`,
                    level: 3,
                    actionKey: 'free_cooling',
                    zoneId,
                    zoneName,
                    timing: 'strategic',
                    type: 'type-cool',
                    title: '🌊 Sur-ventilation nocturne profonde (Anticipation pic chaud)',
                    text: `Fortes chaleurs annoncées demain (${tExtMaxDay}°C). Faites circuler l'air nocturne (${envDataGlobal.t_ext}°C) pour refroidir la masse des murs (${tStruct.toFixed(1)}°C) et régénérer votre réserve de fraîcheur.`,
                    impactWeight: 25
                });
            }

            return recs.filter(rec => activeProfile.allowedLevels.includes(rec.level));
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

            updateMetrics(recs);
        }

        function renderGroupedCards(groupList, container, emptyText) {
            if (!container) return;
            if (groupList.length === 0) {
                container.innerHTML = `<div style="color: #7f8c8d; font-style: italic; padding: 0.5rem 0;">${emptyText}</div>`;
                return;
            }

            groupList.forEach(group => {
                const totalRooms = group.items.length;

                // ============================================================
                // CAS 1 : UNE SEULE PIÈCE CONCERNÉE (Carte unitaire directe)
                // ============================================================
                if (totalRooms === 1) {
                    const item = group.items[0];
                    const tInfo = item.timeInfo || getActionTimeInfo(item, lifecycleState.recos[item.id]);

                    const card = document.createElement('div');
                    card.className = `reco-card reco-card-single ${item.type || group.type || ''}`;
                    card.onclick = (e) => {
                        if (e.target.tagName !== 'INPUT') {
                            window.solsticeToggleSingle(item.id, e);
                        }
                    };

                    card.innerHTML = `
                        <div style="padding-top: 2px;">
                            <input type="checkbox" 
                                   onchange="window.solsticeToggleSingle('${item.id}', event)" 
                                   style="width: 20px; height: 20px; cursor: pointer; accent-color: #10B981;">
                        </div>
                        <div style="flex: 1;">
                            <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 0.35rem; flex-wrap: wrap;">
                                <span class="level-badge level-${item.level}">Niveau ${item.level}</span>
                                <span class="room-badge-bold">📍 ${item.zoneName}</span>
                                <span class="badge-delay ${tInfo.delayClass}">⏱️ ${tInfo.elapsedText} • ${tInfo.percent}% (+${tInfo.currentPoints} pts)</span>
                                ${item.occurrence > 1 ? `<span class="badge-occurrence">🔁 Interv. #${item.occurrence}</span>` : ''}
                            </div>
                            <div class="reco-title" style="margin-bottom: 0.25rem;">${item.title}</div>
                            <div class="reco-text">${item.text}</div>
                        </div>
                    `;

                    container.appendChild(card);
                    return;
                }

                // ============================================================
                // CAS 2 : PLUSIEURS PIÈCES CONCERNÉES (Carte groupée moderne)
                // ============================================================
                const totalVerres = group.items.reduce((sum, item) => sum + (item.nbVerres || 0), 0);
                const verresGroupTxt = `~${totalVerres} verre${totalVerres > 1 ? 's' : ''} d'eau au total`;

                let groupTitle = group.title;
                let groupText = group.text;

                if (group.actionKey === 'open_win_humidity') {
                    groupTitle = `Aération flash ciblée (${totalRooms} pièces — ${verresGroupTxt})`;
                    groupText = `Ouvrez les fenêtres dans les ${totalRooms} pièces concernées : vous évacuerez ${verresGroupTxt} sans entamer la chaleur des parois massives.`;
                } else if (group.actionKey === 'vmc_boost') {
                    groupTitle = `Boost VMC anti-humidité (${totalRooms} pièces)`;
                    groupText = `L'air extérieur est asséchant. Passez la VMC en vitesse rapide pour extraire la vapeur d'eau générée dans ces ${totalRooms} pièces.`;
                } else if (group.actionKey === 'open_door_humidity') {
                    groupTitle = `Aération indirecte / Ouvrir portes (${totalRooms} pièces)`;
                    groupText = `Ouvrez les portes dans ces ${totalRooms} pièces vers des zones aérées pour chasser l'humidité accumulée.`;
                } else if (group.actionKey === 'shutter_close') {
                    groupTitle = `Bouclier solaire immédiat (${totalRooms} pièces)`;
                    groupText = `Fermez les volets dans les ${totalRooms} pièces exposées pour bloquer le rayonnement direct avant le vitrage.`;
                } else if (group.actionKey === 'free_cooling') {
                    groupTitle = `Surventilation traversante (${totalRooms} pièces)`;
                    groupText = `Il fait plus frais dehors (${envDataGlobal.t_ext} °C). Ouvrez pour créer un courant d'air traversant entre ces ${totalRooms} pièces et décharger l'air chaud.`;
                } else if (group.actionKey === 'sun_heat') {
                    groupTitle = `Chauffage solaire passif (${totalRooms} pièces)`;
                    groupText = `Ouvrez les protections dans ces ${totalRooms} pièces pour laisser le rayonnement chauffer gratuitement les masses intérieures.`;
                }

                const totalGroupCurrentPts = group.items.reduce((sum, item) => {
                    const itInfo = item.timeInfo || getActionTimeInfo(item, lifecycleState.recos[item.id]);
                    return sum + itInfo.currentPoints;
                }, 0);

                const earliestItem = group.items.slice().sort((a, b) => (a.appearedAt || 0) - (b.appearedAt || 0))[0];
                const earliestInfo = earliestItem?.timeInfo || getActionTimeInfo(earliestItem, lifecycleState.recos[earliestItem?.id]);

                const card = document.createElement('div');
                card.className = `reco-card ${group.type || ''}`;
                card.style.cssText = "display: flex; flex-direction: column; width: 100%; box-sizing: border-box;";

                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 0.4rem; flex-wrap: wrap;">
                        <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                            <span class="level-badge level-${group.level}">Niveau ${group.level}</span>
                            <span class="badge-delay ${earliestInfo.delayClass}">⏱️ ${earliestInfo.elapsedText} • ${earliestInfo.percent}%</span>
                            <span class="tag-weight">+${totalGroupCurrentPts} pts (+${group.impactWeightPerRoom} pts / pièce)</span>
                        </div>
                        <button type="button" class="btn-group-toggle" onclick="window.solsticeToggleGroup('${group.groupKey}', true)">
                            ⚡ Tout appliquer (${totalRooms})
                        </button>
                    </div>

                    <div class="reco-title" style="margin-bottom: 0.25rem;">${groupTitle}</div>
                    <div class="reco-text" style="margin-bottom: 0.6rem;">${groupText}</div>

                    <div class="room-chips-container">
                        ${group.items.map(item => {
                            const itInfo = item.timeInfo || getActionTimeInfo(item, lifecycleState.recos[item.id]);
                            const chipVerres = item.nbVerres ? `~${item.nbVerres} verre${item.nbVerres > 1 ? 's' : ''}, ` : '';
                            return `
                                <button type="button" 
                                        class="room-chip chip-pending" 
                                        onclick="window.solsticeToggleSingle('${item.id}', event)"
                                        title="Cliquer pour appliquer dans ${item.zoneName}">
                                    <span class="chip-check">⬜</span>
                                    <span class="chip-name">📍 ${item.zoneName}</span>
                                    <span class="chip-pts">${chipVerres}+${itInfo.currentPoints} pts</span>
                                </button>
                            `;
                        }).join('')}
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
                        </div>
                        <div class="reco-title" style="margin-bottom: 0.25rem; text-decoration: line-through; opacity: 0.85;">${item.title}</div>
                        <div class="reco-text" style="font-size: 0.82rem; color: #64748B;">${item.text}</div>
                    </div>
                `;

                container.appendChild(card);
            });
        }

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
                } else {
                    item.status = 'active';
                    item.completedAt = null;
                    item.earnedPoints = null;
                    item.reactivityPercent = null;
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
            let earnedPointsToday = 0;

            const selectedZone = zoneSelect ? zoneSelect.value : currentZoneId;
            const isCoolingActive = (envDataGlobal.t_ext > 26 || tExtMaxDay > 27);
            const gSol = getSolarIrradiance(); // W/m²

            const completedItems = Object.values(lifecycleState.recos || {}).filter(item => item.status === 'completed');

            completedItems.forEach(item => {
                earnedPointsToday += (item.earnedPoints ?? item.basePoints ?? item.impactWeight ?? 15);
                const reactivityFactor = (item.reactivityPercent !== undefined ? item.reactivityPercent / 100 : 1.0);

                const zoneConfig = houseConfig[item.zoneId] || {};
                const roomName = item.zoneName;
                const roomData = donneesHabitat[roomName] || { ta: 20, rh: 50 };
                const ta = roomData.ta || 20;

                const area = parseFloat(zoneConfig.area) || 15;
                const windowArea = parseFloat(zoneConfig.windowArea) || (area * 0.15);
                const uWindow = parseFloat(zoneConfig.uWindow) || 2.8;
                const deltaR = parseFloat(zoneConfig.shutterDeltaR) || 0.15;
                const etaGen = getGeneratorEfficiency(zoneConfig);
                const eerClim = 3.0;

                let dynamicKwh = 0.0;

                // 1. Fermeture des volets / Protection solaire / Bouclier nocturne
                if (item.actionKey === 'shutter_close' || item.actionKey === 'anticipate_sun') {
                    if (isCoolingActive) {
                        const solEnergyKw = (windowArea * gSol * (0.65 - 0.05) * 6) / 1000;
                        dynamicKwh = solEnergyKw / eerClim;
                    } else if (isHeatingSeasonActive) {
                        const uWithShutter = 1 / ((1 / uWindow) + deltaR);
                        const deltaU = uWindow - uWithShutter;
                        const deltaT = Math.max(0, ta - envDataGlobal.t_ext);
                        const thermalGain = (windowArea * deltaU * deltaT * 10) / 1000;
                        dynamicKwh = thermalGain / etaGen;
                    }
                } 
                // 2. Chauffage solaire passif en hiver
                else if (item.actionKey === 'sun_heat') {
                    if (isHeatingSeasonActive) {
                        const solGainKw = (windowArea * gSol * 0.60 * 5) / 1000;
                        dynamicKwh = solGainKw / etaGen;
                    }
                }
                // 3. Consigne nocturne / Coupure du chauffage
                else if (item.actionKey === 'bedroom_temp' || item.actionKey === 'heating_cut') {
                    if (isHeatingSeasonActive) {
                        const uWall = parseFloat(zoneConfig.uWall) || 0.8;
                        const wallArea = (Math.sqrt(area) * 4 * 2.5);
                        const hTransm = (wallArea * uWall) + (windowArea * uWindow);
                        const hVent = 0.34 * 45;
                        const deltaConsigne = (item.actionKey === 'bedroom_temp') ? 2.0 : 1.5;
                        
                        const thermalSavedKw = ((hTransm + hVent) * deltaConsigne * 8) / 1000;
                        dynamicKwh = thermalSavedKw / etaGen;
                    }
                }
                // 4. Surventilation traversante (Free-cooling)
                else if (item.actionKey === 'free_cooling') {
                    if (isCoolingActive || ta > 23) {
                        const deltaT = Math.max(0, ta - envDataGlobal.t_ext);
                        const flowRate = 350;
                        const thermalExtractedKw = (0.34 * flowRate * deltaT * 3) / 1000;
                        dynamicKwh = thermalExtractedKw / eerClim;
                    }
                }
                // 5. Purge VMC / Aération d'humidité / Ouverture porte Cave
                else if (item.actionKey === 'vmc_boost' || item.actionKey === 'open_win_humidity' || item.actionKey === 'open_door_humidity') {
                    if (isHeatingSeasonActive) {
                        const deltaFlow = (item.actionKey === 'vmc_boost') ? 60 : (item.actionKey === 'open_door_humidity' ? 120 : 200);
                        const deltaT = Math.max(0, ta - envDataGlobal.t_ext);
                        const energyToHeatAir = (0.34 * deltaFlow * deltaT * 0.5) / 1000;
                        dynamicKwh = energyToHeatAir / etaGen;
                    }
                }
                // 6. Inertie et déphasage des dalles
                else if (item.actionKey === 'floor_inertia') {
                    if (isHeatingSeasonActive) {
                        dynamicKwh = (area * 0.12) / etaGen;
                    }
                }

                savedKwhDay += (dynamicKwh * reactivityFactor);
            });

            const costPerKwh = getEnergyCostPerKwh(houseConfig[selectedZone] || null);
            const savedEurDay = savedKwhDay * costPerKwh;
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

            // Alignement strict avec le Tableau de Bord (engine.js)
            if (selectedZone === 'all') {
                let totalVol = 0;
                let weightedPmvInit = 0;
                let weightedPmvSim = 0;

                // 1. Prise en compte dynamique du toggle 'Inclure pièces tampons' du Tableau de Bord
                const includeBuffer = localStorage.getItem('SOLSTICE_INCLUDE_BUFFER') !== 'false';
                const scanData = (store.getScanData && store.getScanData()) || {};

                // 2. Parcours direct des mesures réelles (comme calculateGlobalHabitatMetrics dans engine.js)
                Object.keys(scanData).forEach(nomPiece => {
                    if (nomPiece === '__ENV__' || nomPiece === '__BUFFER_TOGGLE__') return;
                    const rData = scanData[nomPiece];
                    if (!rData || rData.ta === undefined || isNaN(rData.ta) || rData.rh === undefined || isNaN(rData.rh)) return;

                    const zConfig = (engine.getZoneConfigByName ? engine.getZoneConfigByName(nomPiece) : null) 
                                 || houseConfig[nomPiece] 
                                 || Object.values(houseConfig).find(z => z && z.name === nomPiece)
                                 || { area: 15, height: 2.5 };

                    const zId = Object.keys(houseConfig).find(k => houseConfig[k]?.name === nomPiece) || nomPiece.toLowerCase().replace(/[^a-z0-9]/g, '_');

                    // 3. Filtrage identique à engine.js
                    if (engine.isOutdoorZone ? engine.isOutdoorZone(nomPiece, zConfig) : isExteriorZone(zId, zConfig)) return;
                    if (!includeBuffer && (engine.isBufferZone ? engine.isBufferZone(nomPiece, zConfig) : isBufferZone(zId, zConfig))) return;

                    const area = parseFloat(zConfig.area) || 15;
                    const height = parseFloat(zConfig.height) || 2.5;
                    const vol = area * height;

                    const baseTa = rData.ta;
                    const baseRh = rData.rh ?? 50;
                    const baseTr = engine.calculateMeanRadiantTemp ? engine.calculateMeanRadiantTemp(zConfig, baseTa) : baseTa;
                    const baseVel = engine.calculateAirVelocity ? engine.calculateAirVelocity(zConfig, nomPiece) : 0.1;
                    const { met, totalClo } = engine.getBaseCloAndMet ? engine.getBaseCloAndMet(zConfig) : { met: 1.2, totalClo: 1.0 };

                    const pmvI = engine.calculatePMV ? engine.calculatePMV(baseTa, baseTr, baseVel, baseRh, met, totalClo) : 0;

                    // Actions cochées pour cette pièce
                    const checkedActionKeys = [];
                    Object.values(lifecycleState.recos || {}).forEach(item => {
                        if (item.status === 'completed' && (item.zoneId === zId || item.zoneName === nomPiece)) {
                            checkedActionKeys.push(item.actionKey);
                        }
                    });

                    const baseState = { ta: baseTa, tr: baseTr, vel: baseVel, rh: baseRh, met, clo: totalClo };
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
                const baseTr = engine.calculateMeanRadiantTemp ? engine.calculateMeanRadiantTemp(targetZoneConfig, baseTa) : baseTa;
                const baseVel = engine.calculateAirVelocity ? engine.calculateAirVelocity(targetZoneConfig, roomName) : 0.1;
                const { met, totalClo } = engine.getBaseCloAndMet ? engine.getBaseCloAndMet(targetZoneConfig) : { met: 1.2, totalClo: 1.0 };

                const checkedActionKeys = [];
                Object.values(lifecycleState.recos || {}).forEach(item => {
                    if (item.status === 'completed' && (item.zoneId === selectedZone || item.zoneName === roomName)) {
                        checkedActionKeys.push(item.actionKey);
                    }
                });

                const baseState = { ta: baseTa, tr: baseTr, vel: baseVel, rh: roomData.rh, met, clo: totalClo };
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
