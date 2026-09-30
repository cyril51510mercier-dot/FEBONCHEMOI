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
    
    // ... suite du script
    try {
        const store = window.SolsticeStore;
        const engine = window.SolsticeEngine;

        const houseConfig = store.getZones();
        const donneesHabitat = store.getScanData();
        const envDataGlobal = store.getEnvData();

        let currentZoneId = sessionStorage.getItem('currentZoneId') || 'all';

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

        const globalConfig = houseConfig.global || {};
        const activeProfileKey = globalConfig.userProfile || 'mid_term';

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
            mid_term: { label: "Moyen termiste", allowedLevels: [1, 2], maxDeltaPmv: 0.3 },
            long_term: { label: "Long termiste", allowedLevels: [1, 2, 3], maxDeltaPmv: 0.6 }
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
            const id = zId.toLowerCase();
            const name = (zone?.name || '').toLowerCase();
            return id.includes('exterieur') || id.includes('jardin') || id.includes('rue') ||
                   name.includes('extérieur') || name.includes('jardin') || name.includes('rue') ||
                   zone?.usages?.includes('outdoor');
        }

        function isBufferZone(zId, zone) {
            const id = zId.toLowerCase();
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

            const tr = engine.calculateMeanRadiantTemp ? engine.calculateMeanRadiantTemp(zone, ta) : ta;
            const vel = engine.calculateAirVelocity ? engine.calculateAirVelocity(zone, zoneName) : 0.1;
            const { met, totalClo } = engine.getBaseCloAndMet ? engine.getBaseCloAndMet(zone) : { met: 1.2, totalClo: 1.0 };

            const roomPmv = engine.calculatePMV(ta, tr, vel, rh, met, totalClo);
            const needsHeat = roomPmv < -0.4;
            const needsCooling = roomPmv > 0.4;
            const isSunny = envDataGlobal.sun_status.toLowerCase().includes('clear') || envDataGlobal.sun_status.toLowerCase().includes('sun');

            const hasNonFixedWindow = !zone?.windows || zone.windows.length === 0 || zone.windows.some(w => !w.vent || (w.vent !== 'fixe' && w.vent !== 'fixed'));
            const mainVentType = zone?.windows?.find(w => w.vent && w.vent !== 'fixe' && w.vent !== 'fixed')?.vent || 'battante';
            
            const hasShutters = !zone?.windows || zone.windows.length === 0 || zone.windows.some(w => !w.shutter || w.shutter !== 'aucun');
            const hasInteriorCurtains = zone?.windows?.some(w => w.shutter === 'rideau_interieur' || w.shutter === 'store_interieur');
            const hasVmc = zone?.equipment?.vmcSystem && zone.equipment.vmcSystem !== 'aucun' && zone.equipment.vmcSystem !== 'none';

            const adj = zone?.adj || {};
            const hasUnheatedDoor = zone?.hasBufferDoor || adj.hasBufferDoor || 
                                    [1, 2, 3, 4].some(i => adj[`wall${i}`] === 'unheated' && adj[`doorWall${i}`]);

            const hasEastWestWin = zone?.windows?.some(w => ['E', 'W'].includes(w.orient));
            const hasRoofWin = zone?.windows?.some(w => w.tilt === 'inclinee');
            const isHeavyStructure = zone?.wallMat === 'concrete' || zone?.wallMat === 'stone' || zone?.floorMat === 'lourd';

            // --- NIVEAU 1 : ACTIONS IMMÉDIATES (< 1h) ---

            if (rh > 65 && ahExt < ahInt && !isWetRoom) {
                if (hasVmc) {
                    recs.push({ id: `${zoneId}_vmc_boost`, level: 1, actionKey: 'vmc_boost', zoneId, zoneName, timing: 'immediate', type: 'type-air', title: 'Boost VMC anti-humidité', text: `L'humidité atteint ${rh} % (air ext. plus sec). Passez la VMC en vitesse rapide.`, impactWeight: 15 });
                } else if (hasNonFixedWindow) {
                    const dur = (mainVentType === 'oscillante' || mainVentType === 'oscillo_battante' || mainVentType === 'partial') ? '12 à 15 minutes' : '5 minutes';
                    recs.push({ id: `${zoneId}_open_win_humidity`, level: 1, actionKey: 'open_win_humidity', zoneId, zoneName, timing: 'immediate', type: 'type-air', title: 'Aération flash ciblée', text: `Ouvrez la fenêtre (${dur}) pour évacuer la vapeur d'eau.`, impactWeight: 12 });
                }
            }

            if (isWetRoom && rh > 60 && ahExt < ahInt) {
                let purgeText = "";
                if (hasVmc && hasNonFixedWindow) {
                    purgeText = `L'humidité atteint ${rh} %. Passez la VMC en vitesse rapide et/ou ouvrez la fenêtre 5 à 10 min.`;
                } else if (hasVmc) {
                    purgeText = `L'humidité atteint ${rh} %. Passez la VMC en vitesse rapide pour extraire la vapeur d'eau.`;
                } else if (hasNonFixedWindow) {
                    purgeText = `L'humidité atteint ${rh} %. Ouvrez la fenêtre 5 à 10 min pour évacuer la vapeur d'eau localement.`;
                }
                if (purgeText) {
                    recs.push({ id: `${zoneId}_humidity_source_purge`, level: 1, actionKey: hasVmc ? 'vmc_boost' : 'open_win_humidity', zoneId, zoneName, timing: 'immediate', type: 'type-air', title: 'Purge à la source (Cuisine / SDB)', text: purgeText, impactWeight: 14 });
                }
            }

            const isOutdoorHeatwaveThreat = tExtMaxDay > (ta + 1.5);
            if (needsCooling && envDataGlobal.t_ext < ta && hasNonFixedWindow && (isOutdoorHeatwaveThreat || ta > 23)) {
                recs.push({ id: `${zoneId}_free_cooling`, level: 1, actionKey: 'free_cooling', zoneId, zoneName, timing: 'immediate', type: 'type-cool', title: 'Surventilation traversante (Free-cooling)', text: `Il fait plus frais dehors (${envDataGlobal.t_ext} °C). Ouvrez pour décharger l'air chaud.`, impactWeight: 20 });
            }

            if (isHeatingSeasonActive && needsHeat && envDataGlobal.t_ext < 10 && (zone?.equipment?.heating?.system && zone.equipment.heating.system !== 'none') && hasNonFixedWindow) {
                recs.push({ id: `${zoneId}_heating_cut_during_ventilation`, level: 1, actionKey: 'heating_cut', zoneId, zoneName, timing: 'immediate', type: 'type-eco', title: 'Coupure du chauffage pendant l\'aération', text: `Coupez le chauffage dans cette pièce pendant l'ouverture des fenêtres.`, impactWeight: 10 });
            }

            if (needsCooling && isSunny && hasShutters) {
                recs.push({ id: `${zoneId}_shutter_close`, level: 1, actionKey: 'shutter_close', zoneId, zoneName, timing: 'immediate', type: 'type-sun', title: 'Bouclier solaire immédiat', text: `Fermez les volets pour bloquer le rayonnement direct avant le vitrage.`, impactWeight: 25 });
            }

            if (needsCooling && isSunny && hasEastWestWin && (isMorning || isAfternoon)) {
                recs.push({ id: `${zoneId}_targeted_orientation_shield`, level: 1, actionKey: 'shutter_close', zoneId, zoneName, timing: 'immediate', type: 'type-sun', title: 'Bouclier solaire orienté Est / Ouest', text: `Fermez les volets de la façade exposée au soleil rasant (${isMorning ? 'Est' : 'Ouest'}).`, impactWeight: 18 });
            }

            if (needsCooling && isSunny && hasRoofWin) {
                recs.push({ id: `${zoneId}_roof_window_shield`, level: 1, actionKey: 'shutter_close', zoneId, zoneName, timing: 'immediate', type: 'type-sun', title: 'Protection prioritaire des fenêtres de toit', text: `Occultez les Velux : le rayonnement sous toiture est la cause principale de surchauffe.`, impactWeight: 22 });
            }

            if (needsHeat && isSunny && envDataGlobal.t_ext < ta) {
                recs.push({ id: `${zoneId}_sun_heat`, level: 1, actionKey: 'sun_heat', zoneId, zoneName, timing: 'immediate', type: 'type-sun', title: 'Chauffage solaire passif', text: `Ouvrez les protections pour laisser le soleil chauffer gratuitement les parois.`, impactWeight: 20 });
            }

            if (needsHeat && !isSunny && isNight) {
                recs.push({ id: `${zoneId}_winter_night_shutters`, level: 1, actionKey: 'shutter_close', zoneId, zoneName, timing: 'immediate', type: 'type-sun', title: 'Bouclier thermique nocturne', text: `Fermez volets et rideaux dès la tombée du jour pour créer une lame d'air isolante.`, impactWeight: 12 });
            }

            if (needsHeat && hasInteriorCurtains && zone?.windows?.some(w => w.glass === 'single' || w.glass === 'double_old')) {
                recs.push({ id: `${zoneId}_single_glass_thermal_curtain`, level: 1, actionKey: 'shutter_close', zoneId, zoneName, timing: 'immediate', type: 'type-heat', title: 'Rideau épais sur vitrage ancien', text: `Tirez les rideaux épais le soir pour isoler la vitre froide et remonter la température radiante.`, impactWeight: 12 });
            }

            if (isHeatingSeasonActive && roomPmv > 0.3 && zone?.equipment?.heating?.regulation?.includes('thermostatic_valve')) {
                recs.push({ id: `${zoneId}_thermostatic_balancing`, level: 1, actionKey: 'heating_cut', zoneId, zoneName, timing: 'immediate', type: 'type-eco', title: 'Équilibrage par robinet thermostatique', text: `Réduisez le robinet d'un cran dans cette pièce pour réorienter l'eau chaude vers les pièces froides.`, impactWeight: 12 });
            }

            if (needsCooling && zone?.equipment?.fanSystem && zone.equipment.fanSystem !== 'aucun') {
                recs.push({ id: `${zoneId}_fan_on`, level: 1, actionKey: 'fan_on', zoneId, zoneName, timing: 'immediate', type: 'type-eco', title: `Activer le brassage d'air (${zone.equipment.fanSystem})`, text: `Le flux d'air rafraîchit le ressenti cutané de 2 °C sans climatisation.`, impactWeight: 18 });
            }

            if (!isBuffer && hasUnheatedDoor) {
                recs.push({ id: `${zoneId}_buffer_door_close`, level: 1, actionKey: 'heating_cut', zoneId, zoneName, timing: 'immediate', type: 'type-eco', title: 'Fermeture de la porte du local non chauffé', text: `Conservez la porte fermée avec le local non chauffé (garage/cellier) pour éviter les fuites thermiques.`, impactWeight: 12 });
            }

            if (isHeatingSeasonActive && reserve.chargeCalories >= 75) {
                recs.push({ id: `${zoneId}_high_calorie_stock_eco`, level: 1, actionKey: 'heating_cut', zoneId, zoneName, timing: 'immediate', type: 'type-eco', title: 'Valorisation de l\'inertie chaude (Calories > 75 %)', text: `Les murs sont gorgés de chaleur (${reserve.chargeCalories} %). Baissez la consigne d'un degré.`, impactWeight: 16 });
            }

            // --- NIVEAU 2 : OPPORTUNISME 24H ---
            if (needsCooling && isSunny && hasShutters && isMorning) {
                recs.push({ id: `${zoneId}_anticipate_sun`, level: 2, actionKey: 'anticipate_sun', zoneId, zoneName, timing: 'anticipated', type: 'type-sun', title: 'Occultation préventive du matin', text: `Fermez les volets dès 10h pour devancer le pic de chaleur de l'après-midi.`, impactWeight: 15 });
            }

            if (isHeatingSeasonActive && needsHeat && zone?.equipment?.heating?.system === 'floor') {
                recs.push({ id: `${zoneId}_floor_inertia`, level: 2, actionKey: 'floor_inertia', zoneId, zoneName, timing: 'anticipated', type: 'type-heat', title: 'Anticipation plancher chauffant', text: `Relancez la consigne 3 heures à l'avance pour compenser la forte inertie.`, impactWeight: 15 });
            }

            if (isHeatingSeasonActive && zone?.usages?.includes('bedroom') && needsHeat && isEvening) {
                recs.push({ id: `${zoneId}_bedroom_temp_drop`, level: 2, actionKey: 'bedroom_temp', zoneId, zoneName, timing: 'anticipated', type: 'type-eco', title: 'Consigne nocturne en chambre (17 °C à 18 °C)', text: `Réglez le thermostat à 17-18 °C 1h avant le coucher.`, impactWeight: 12 });
            }

            // --- NIVEAU 3 : STRATÉGIE MÉTÉO (48h-72h) ---
            const surchauffeInterieure = (tStruct >= 24.0 || ta >= 24.0);
            const vraieSurchauffeExterieure = (envDataGlobal.t_ext >= 22.0 && tExtMinDay >= 18.0);
            const nuitsFraichesOuIntersaison = (tExtMinDay < 18.0 || envDataGlobal.t_ext < 19.0 || isHeatingSeasonActive);

            if (surchauffeInterieure && vraieSurchauffeExterieure && !nuitsFraichesOuIntersaison && reserve.chargeFrigories < 35) {
                recs.push({ id: `${zoneId}_low_frigorie_stock`, level: 3, actionKey: 'free_cooling', zoneId, zoneName, timing: 'strategic', type: 'type-cool', title: 'Décharge nocturne prioritaire (Canicule)', text: `La structure est saturée en chaleur. Ouvrez les fenêtres cette nuit pour refroidir la masse des murs.`, impactWeight: 22 });
            }

            return recs.filter(rec => activeProfile.allowedLevels.includes(rec.level));
        }

        function getAllRecommendations() {
            let allRecs = [];
            const selectedZone = zoneSelect ? zoneSelect.value : currentZoneId;
            const zonesMap = getAvailableZonesMap();

            if (selectedZone === 'all') {
                Object.keys(zonesMap).forEach(zId => {
                    const roomName = zonesMap[zId];
                    const zone = houseConfig[zId] || { id: zId, name: roomName };
                    const roomData = donneesHabitat[roomName] || { ta: 20, rh: 50 };
                    allRecs = allRecs.concat(generateRecommendationsForZone(zone, zId, roomData));
                });
            } else {
                const roomName = zonesMap[selectedZone] || selectedZone;
                const zone = houseConfig[selectedZone] || { id: selectedZone, name: roomName };
                const roomData = donneesHabitat[roomName] || {
                    ta: parseFloat(sessionStorage.getItem('indoorAirTemp')) || 20,
                    rh: parseFloat(sessionStorage.getItem('indoorHumidity')) || 50
                };
                allRecs = generateRecommendationsForZone(zone, selectedZone, roomData);
            }

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

            const immediatePending = recs.filter(r => (r.timing === 'immediate' || r.level === 1) && lifecycleState.recos[r.id]?.status !== 'completed');
            const anticipatedPending = recs.filter(r => (r.timing === 'anticipated' || r.level === 2) && lifecycleState.recos[r.id]?.status !== 'completed');
            const strategicPending = recs.filter(r => (r.timing === 'strategic' || r.level === 3) && lifecycleState.recos[r.id]?.status !== 'completed');
            const completedList = recs.filter(r => lifecycleState.recos[r.id]?.status === 'completed');

            renderGroup(immediatePending, containerImmediate, "Aucune action immédiate requise.");
            
            if (containerStrategic) {
                renderGroup(anticipatedPending, containerAnticipated, "Aucune action anticipée 24h requise.");
                renderGroup(strategicPending, containerStrategic, "Aucune action stratégique météo 48-72h requise.");
            } else {
                renderGroup([...anticipatedPending, ...strategicPending], containerAnticipated, "Aucune action anticipée ou stratégique requise.");
            }

            renderGroup(completedList, containerCompleted, "Aucune action réalisée pour le moment.");

            updateMetrics(recs);
        }

        function renderGroup(list, container, emptyText) {
            if (!container) return;
            if (list.length === 0) {
                container.innerHTML = `<div style="color: #7f8c8d; font-style: italic; padding: 0.5rem 0;">${emptyText}</div>`;
                return;
            }

            list.forEach(rec => {
                const isChecked = lifecycleState.recos[rec.id]?.status === 'completed';
                const card = document.createElement('div');
                card.className = `reco-card ${isChecked ? 'checked' : ''}`;
                card.onclick = (e) => toggleAction(rec.id, e);

                card.innerHTML = `
                    <div style="margin-top: 0.25rem;">
                        <input type="checkbox" id="${rec.id}" ${isChecked ? 'checked' : ''} style="width: 20px; height: 20px; cursor: pointer;">
                    </div>
                    <div style="flex: 1;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem;">
                            <div style="display: flex; gap: 6px; align-items: center;">
                                <span class="room-badge-bold">📍 ${rec.zoneName}</span>
                                <span class="level-badge level-${rec.level}">Niveau ${rec.level}</span>
                            </div>
                            <span class="tag-weight">+${rec.impactWeight} pts</span>
                        </div>
                        <div class="reco-title">${rec.title}</div>
                        <div class="reco-text">${rec.text}</div>
                    </div>
                `;
                container.appendChild(card);
            });
        }

        function toggleAction(id, event) {
            if (event.target.tagName !== 'INPUT') {
                const cb = document.getElementById(id);
                if (cb) cb.checked = !cb.checked;
            }

            const cb = document.getElementById(id);
            const now = Date.now();

            if (!lifecycleState.recos[id]) {
                lifecycleState.recos[id] = { id, appearedAt: now, completedAt: null, status: 'active' };
            }

            if (cb && cb.checked) {
                lifecycleState.recos[id].status = 'completed';
                lifecycleState.recos[id].completedAt = now;
            } else {
                lifecycleState.recos[id].status = 'active';
                lifecycleState.recos[id].completedAt = null;
            }

            saveRecoLifecycleState(lifecycleState);
            render();
        }

        // ============================================================
        // MOTEUR DE CALCUL THERMODYNAMIQUE DYNAMIQUE
        // ============================================================
        function calculateFinancialImpact(allRecs) {
            let savedKwhDay = 0;
            let earnedPointsToday = 0;

            const selectedZone = zoneSelect ? zoneSelect.value : currentZoneId;
            const isCoolingActive = (envDataGlobal.t_ext > 26 || tExtMaxDay > 27);
            const gSol = getSolarIrradiance(); // W/m²

            allRecs.forEach(r => {
                const item = lifecycleState.recos[r.id];
                if (item && item.status === 'completed') {
                    let reactivityFactor = 1.0;
                    if (item.appearedAt && item.completedAt) {
                        const delayHours = (item.completedAt - item.appearedAt) / (1000 * 3600);
                        if (delayHours > 2) reactivityFactor = 0.85;
                        if (delayHours > 6) reactivityFactor = 0.70;
                    }

                    earnedPointsToday += Math.round(r.impactWeight * reactivityFactor);

                    const zoneConfig = houseConfig[r.zoneId] || {};
                    const roomName = r.zoneName;
                    const roomData = donneesHabitat[roomName] || { ta: 20, rh: 50 };
                    const ta = roomData.ta || 20;

                    // Paramètres physiques réels ou valeurs DPE par défaut
                    const area = parseFloat(zoneConfig.area) || 15;
                    const windowArea = parseFloat(zoneConfig.windowArea) || (area * 0.15); // 15% de la surface si non précisé
                    const uWindow = parseFloat(zoneConfig.uWindow) || 2.8; // W/m².K
                    const deltaR = parseFloat(zoneConfig.shutterDeltaR) || 0.15; // m².K/W
                    const etaGen = getGeneratorEfficiency(zoneConfig);
                    const eerClim = 3.0; // EER clim standard

                    let dynamicKwh = 0.0;

                    // 1. Fermeture des volets / Protection solaire / Bouclier nocturne
                    if (r.actionKey === 'shutter_close' || r.actionKey === 'anticipate_sun') {
                        if (isCoolingActive) {
                            // Énergie solaire évitée en été = A_vitre * G_sol * (g_nu - g_clos) * delta_t / 1000
                            const solEnergyKw = (windowArea * gSol * (0.65 - 0.05) * 6) / 1000; // 6h d'ensoleillement
                            dynamicKwh = solEnergyKw / eerClim;
                        } else if (isHeatingSeasonActive) {
                            // Gain par réduction des déperditions nocturnes (Delta U * A * DeltaT * dt)
                            const uWithShutter = 1 / ((1 / uWindow) + deltaR);
                            const deltaU = uWindow - uWithShutter;
                            const deltaT = Math.max(0, ta - envDataGlobal.t_ext);
                            const thermalGain = (windowArea * deltaU * deltaT * 10) / 1000; // 10h de nuit
                            dynamicKwh = thermalGain / etaGen;
                        }
                    } 
                    // 2. Chauffage solaire passif en hiver
                    else if (r.actionKey === 'sun_heat') {
                        if (isHeatingSeasonActive) {
                            const solGainKw = (windowArea * gSol * 0.60 * 5) / 1000; // 5h d'apports directs
                            dynamicKwh = solGainKw / etaGen;
                        }
                    }
                    // 3. Consigne nocturne / Coupure du chauffage (Réduction de déperdition transm. + vent.)
                    else if (r.actionKey === 'bedroom_temp' || r.actionKey === 'heating_cut') {
                        if (isHeatingSeasonActive) {
                            const uWall = parseFloat(zoneConfig.uWall) || 0.8;
                            const wallArea = (Math.sqrt(area) * 4 * 2.5); // Périmètre x Hauteur
                            const hTransm = (wallArea * uWall) + (windowArea * uWindow);
                            const hVent = 0.34 * 45; // Débit VMC 45 m³/h
                            const deltaConsigne = (r.actionKey === 'bedroom_temp') ? 2.0 : 1.5; // -2°C ou -1.5°C
                            
                            const thermalSavedKw = ((hTransm + hVent) * deltaConsigne * 8) / 1000; // 8h de baisse
                            dynamicKwh = thermalSavedKw / etaGen;
                        }
                    }
                    // 4. Surventilation traversante (Free-cooling)
                    else if (r.actionKey === 'free_cooling') {
                        if (isCoolingActive || ta > 23) {
                            const deltaT = Math.max(0, ta - envDataGlobal.t_ext);
                            const flowRate = 350; // m³/h par aération traversante
                            const thermalExtractedKw = (0.34 * flowRate * deltaT * 3) / 1000; // 3h de surventilation
                            dynamicKwh = thermalExtractedKw / eerClim;
                        }
                    }
                    // 5. Purge VMC / Aération d'humidité
                    else if (r.actionKey === 'vmc_boost' || r.actionKey === 'open_win_humidity') {
                        if (isHeatingSeasonActive) {
                            const deltaFlow = (r.actionKey === 'vmc_boost') ? 60 : 200; // Surdébit m³/h
                            const deltaT = Math.max(0, ta - envDataGlobal.t_ext);
                            const energyToHeatAir = (0.34 * deltaFlow * deltaT * 0.5) / 1000; // 30 min de purge
                            dynamicKwh = energyToHeatAir / etaGen;
                        }
                    }
                    // 6. Inertie et déphasage des dalles
                    else if (r.actionKey === 'floor_inertia') {
                        if (isHeatingSeasonActive) {
                            dynamicKwh = (area * 0.12) / etaGen; // Reprise d'inertie dalle
                        }
                    }

                    savedKwhDay += (dynamicKwh * reactivityFactor);
                }
            });

            const costPerKwh = getEnergyCostPerKwh(houseConfig[selectedZone] || null);
            const savedEurDay = savedKwhDay * costPerKwh;
            return { savedKwhDay, savedEurDay, earnedPointsToday };
        }

        function updateMetrics(allRecs) {
            let totalPossiblePointsToday = 0;
            allRecs.forEach(r => {
                totalPossiblePointsToday += r.impactWeight;
            });

            const { savedKwhDay, savedEurDay, earnedPointsToday } = calculateFinancialImpact(allRecs);

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

            // Alignement strict avec la Synthèse Globale
            if (selectedZone === 'all') {
                let totalVol = 0;
                let weightedPmvInit = 0;
                let weightedPmvSim = 0;

                Object.keys(zonesMap).forEach(zId => {
                    const rName = zonesMap[zId];
                    const zConfig = houseConfig[zId] || { area: 15, height: 2.5 };
                    
                    if (isExteriorZone(zId, zConfig) || isBufferZone(zId, zConfig)) return;

                    const rData = donneesHabitat[rName];
                    if (!rData || rData.ta === undefined) return;

                    const vol = (parseFloat(zConfig.area) || 15) * (parseFloat(zConfig.height) || 2.5);

                    const baseTa = rData.ta;
                    const baseRh = rData.rh ?? 50;
                    const baseTr = engine.calculateMeanRadiantTemp ? engine.calculateMeanRadiantTemp(zConfig, baseTa) : baseTa;
                    const baseVel = engine.calculateAirVelocity ? engine.calculateAirVelocity(zConfig, rName) : 0.1;
                    const { met, totalClo } = engine.getBaseCloAndMet ? engine.getBaseCloAndMet(zConfig) : { met: 1.2, totalClo: 1.0 };

                    const pmvI = engine.calculatePMV(baseTa, baseTr, baseVel, baseRh, met, totalClo);

                    const checkedActionKeys = [];
                    allRecs.filter(r => r.zoneId === zId).forEach(r => {
                        const item = lifecycleState.recos[r.id];
                        if (item && item.status === 'completed') checkedActionKeys.push(r.actionKey);
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
                allRecs.forEach(r => {
                    const item = lifecycleState.recos[r.id];
                    if (item && item.status === 'completed') checkedActionKeys.push(r.actionKey);
                });

                const baseState = { ta: baseTa, tr: baseTr, vel: baseVel, rh: roomData.rh, met, clo: totalClo };
                const pmvInit = engine.calculatePMV(baseTa, baseTr, baseVel, roomData.rh, met, totalClo);
                const simulation = engine.evaluateSimulatedPMV ? engine.evaluateSimulatedPMV(baseState, checkedActionKeys, envDataGlobal) : { pmv: pmvInit };

                if (dispInitEl) dispInitEl.textContent = (pmvInit > 0 ? "+" : "") + pmvInit.toFixed(2);
                if (simEl) {
                    const pmvSimulated = simulation.pmv;
                    simEl.textContent = (pmvSimulated > 0 ? "+" : "") + pmvSimulated.toFixed(2);
                    simEl.style.color = Math.abs(pmvSimulated) <= 0.5 ? 'var(--eco, #2ecc71)' : (pmvSimulated > 0.5 ? 'var(--hot, #e74c3c)' : 'var(--cold, #3498db)');
                }
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
                allRecs.forEach(r => {
                    const item = lifecycleState.recos[r.id];
                    if (item && item.status === 'completed') checkedActionKeys.push(r.actionKey);
                });

                const baseState = { ta: baseTa, tr: baseTr, vel: baseVel, rh: roomData.rh, met, clo: totalClo };
                const pmvInit = engine.calculatePMV(baseTa, baseTr, baseVel, roomData.rh, met, totalClo);
                const simulation = engine.evaluateSimulatedPMV ? engine.evaluateSimulatedPMV(baseState, checkedActionKeys, envDataGlobal) : { pmv: pmvInit };

                if (dispInitEl) dispInitEl.textContent = (pmvInit > 0 ? "+" : "") + pmvInit.toFixed(2);
                if (simEl) {
                    const pmvSimulated = simulation.pmv;
                    simEl.textContent = (pmvSimulated > 0 ? "+" : "") + pmvSimulated.toFixed(2);
                    simEl.style.color = Math.abs(pmvSimulated) <= 0.5 ? 'var(--eco, #2ecc71)' : (pmvSimulated > 0.5 ? 'var(--hot, #e74c3c)' : 'var(--cold, #3498db)');
                }
            }
        }

        window.resetCagnotte = function() {
            localStorage.removeItem('SOLSTICE_CAGNOTTE_EUR');
            localStorage.removeItem('SOLSTICE_CAGNOTTE_SCORE_PTS');
            localStorage.removeItem('SOLSTICE_RECO_LIFECYCLE');
            lifecycleState = { lastDate: TODAY_KEY, recos: {} };
            render();
        };

        if (zoneSelect) {
            zoneSelect.addEventListener('change', (e) => {
                currentZoneId = e.target.value;
                sessionStorage.setItem('currentZoneId', currentZoneId);
                render();
            });
        }

        setupZoneSelector();
        render();

    } catch (err) {
        console.error("Erreur d'initialisation Solstice Recos :", err);
    }
});
