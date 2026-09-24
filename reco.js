/**
 * ==================================================================
 * SOLSTICE — MOTEUR DE RECOMMANDATIONS & FILTRAGE AVANCÉ (V6.5)
 * Modélisation physique BEM, filtrage temporel & cagnotte réactive
 * ==================================================================
 */

document.addEventListener('DOMContentLoaded', function() {
    try {
        const store = window.SolsticeStore;
        const engine = window.SolsticeEngine;

        const houseConfig = store.getZones();
        const donneesHabitat = store.getScanData();
        const envDataGlobal = store.getEnvData();

        let checkedActions = store.getCheckedRecos();
        let currentZoneId = sessionStorage.getItem('currentZoneId') || 'all';

        const zoneSelect = document.getElementById('zoneSelect');
        const containerImmediate = document.getElementById('container-immediate');
        const containerAnticipated = document.getElementById('container-anticipated');
        const containerStrategic = document.getElementById('container-strategic');
        const containerCompleted = document.getElementById('container-completed');
        const profileIndicator = document.getElementById('profileIndicator');

// Configuration Globale & Saison de chauffe
const globalConfig = houseConfig.global || {};
const activeProfileKey = globalConfig.userProfile || 'mid_term';

// Détermination de la Saison de Chauffe (Prise en compte du forçage 'heating' / 'auto')
const forcedSeason = globalConfig.forcedSeason;
const manualHeating = globalConfig.heatingSeasonActive;
const autoHeating = envDataGlobal.t_ext < 15;
const isHeatingSeasonActive = (forcedSeason === 'heating') 
    ? true 
    : ((forcedSeason === 'auto') 
        ? autoHeating 
        : (manualHeating !== undefined && manualHeating !== null ? manualHeating : autoHeating));

// Synchronisation du bouton si présent sur la page de recommandations
const heatingBtn = document.getElementById('btnToggleHeating');
if (heatingBtn) {
    const applyUI = (state) => {
        if (state === 'heating') {
            heatingBtn.textContent = '🔥 Saison de chauffe : FORCÉE';
            heatingBtn.style.backgroundColor = '#e74c3c';
            heatingBtn.style.borderColor = '#c0392b';
            heatingBtn.style.color = '#ffffff';
        } else {
            heatingBtn.textContent = '🌐 Saison de chauffe : AUTO';
            heatingBtn.style.backgroundColor = '#1E293B';
            heatingBtn.style.borderColor = '#334155';
            heatingBtn.style.color = '#F8FAFC';
        }
    };

    const currentState = forcedSeason || (manualHeating ? 'heating' : 'auto');
    applyUI(currentState);

    heatingBtn.addEventListener('click', () => {
        const raw = localStorage.getItem('HOUSE_CONFIG');
        const cfg = raw ? JSON.parse(raw) : {};
        cfg.global = cfg.global || {};
        const newState = (cfg.global.forcedSeason === 'heating') ? 'auto' : 'heating';
        cfg.global.forcedSeason = newState;
        cfg.global.heatingSeasonActive = (newState === 'heating');
        localStorage.setItem('HOUSE_CONFIG', JSON.stringify(cfg));
        applyUI(newState);
        render();
    });
}

            const currentState = globalConfig.forcedSeason || (globalConfig.heatingSeasonActive ? 'heating' : 'auto');
            applyUI(currentState);

            heatingBtn.addEventListener('click', () => {
                const raw = localStorage.getItem('HOUSE_CONFIG');
                const cfg = raw ? JSON.parse(raw) : {};
                cfg.global = cfg.global || {};
                const newState = (cfg.global.forcedSeason === 'heating') ? 'auto' : 'heating';
                cfg.global.forcedSeason = newState;
                cfg.global.heatingSeasonActive = (newState === 'heating');
                localStorage.setItem('HOUSE_CONFIG', JSON.stringify(cfg));
                applyUI(newState);
                render();
            });
        }

        const profilesDef = engine.PROFILES || {
            short_term: { label: "Court termiste", allowedLevels: [1], maxDeltaPmv: 0.0 },
            mid_term: { label: "Moyen termiste", allowedLevels: [1, 2], maxDeltaPmv: 0.3 },
            long_term: { label: "Long termiste", allowedLevels: [1, 2, 3], maxDeltaPmv: 0.6 }
        };
        const activeProfile = profilesDef[activeProfileKey] || profilesDef.mid_term;

        if (profileIndicator) {
            profileIndicator.textContent = `Profil : ${activeProfile.label} (Tolérance PMV ±${activeProfile.maxDeltaPmv})`;
        }

        // Fenêtres temporelles de la journée
        const currentHour = new Date().getHours();
        const isMorning = currentHour >= 6 && currentHour < 12;
        const isAfternoon = currentHour >= 12 && currentHour < 18;
        const isEvening = currentHour >= 17 && currentHour < 23;
        const isNight = currentHour >= 21 || currentHour < 7;

        // Température maximale extérieure prévue aujourd'hui
        const tExtMaxDay = envDataGlobal.t_ext_max || (envDataGlobal.t_ext + 3);

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

        function getVPD(ta, rh) {
            const pSat = 611.2 * Math.exp((17.67 * ta) / (ta + 243.5));
            return (pSat * (1 - rh / 100)) / 1000;
        }

        // Coût du kWh selon la source d'énergie configurée
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

        // Calcul du PMV global moyen de l'habitat (hors extérieurs)
        function calculateGlobalPmv() {
            let totalPmv = 0;
            let count = 0;
            Object.keys(donneesHabitat).forEach(roomName => {
                const zId = roomName.toLowerCase().replace(/[^a-z0-9]/g, '_');
                const zone = houseConfig[zId];
                if (!isExteriorZone(zId, zone)) {
                    const roomData = donneesHabitat[roomName];
                    const ta = roomData.ta || 20;
                    const rh = roomData.rh || 50;
                    const tr = engine.calculateMeanRadiantTemp(zone, ta);
                    const vel = engine.calculateAirVelocity(zone, roomName);
                    const { met, totalClo } = engine.getBaseCloAndMet(zone);
                    totalPmv += engine.calculatePMV(ta, tr, vel, rh, met, totalClo);
                    count++;
                }
            });
            return count > 0 ? (totalPmv / count) : 0;
        }

        const globalHousePmv = calculateGlobalPmv();

        // Menu déroulant (Exclusion stricte des pièces extérieures)
        function getAvailableZonesMap() {
            const zonesMap = {};
            Object.keys(houseConfig).forEach(zId => {
                if (zId !== 'global' && !isExteriorZone(zId, houseConfig[zId])) {
                    zonesMap[zId] = houseConfig[zId].name || zId;
                }
            });
            Object.keys(donneesHabitat).forEach(roomName => {
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
        // MOTEUR DE RECOMMANDATIONS THERMIQUES
        // ============================================================
        function generateRecommendationsForZone(zone, zoneId, roomData) {
            const recs = [];
            
            if (isExteriorZone(zoneId, zone)) return recs;

            const isBuffer = isBufferZone(zoneId, zone);
            const zoneName = zone ? (zone.name || zoneId) : zoneId;
            const ta = roomData.ta || 20;
            const rh = roomData.rh || 50;
            const ahInt = getAbsoluteHumidity(ta, rh);
            const ahExt = getAbsoluteHumidity(envDataGlobal.t_ext, 60);
            const vpdRoom = getVPD(ta, rh);

            const tr = engine.calculateMeanRadiantTemp(zone, ta);
            const vel = engine.calculateAirVelocity(zone, zoneName);
            const { met, totalClo } = engine.getBaseCloAndMet(zone);

            const roomPmv = engine.calculatePMV(ta, tr, vel, rh, met, totalClo);
            const needsHeat = roomPmv < -0.5;
            const needsCooling = roomPmv > 0.5;
            const isSunny = envDataGlobal.sun_status.toLowerCase().includes('clear') || envDataGlobal.sun_status.toLowerCase().includes('sun');

            const hasWindows = !zone || !zone.windows || zone.windows.length === 0 || zone.windows.some(w => w.vent !== 'fixe');
            const mainVentType = zone?.windows?.find(w => w.vent && w.vent !== 'fixe')?.vent || 'battante';
            const hasShutters = !zone || !zone.windows || zone.windows.some(w => w.shutter && w.shutter !== 'aucun');
            
            const hasInteriorCurtains = zone?.windows?.some(w => w.shutter === 'rideau_interieur' || w.shutter === 'store_interieur');
            const hasVentilationSystem = (zone?.equipment?.vmcSystem && zone.equipment.vmcSystem !== 'aucun') || hasWindows;

            // Porte vers local tampon
            const hasBufferDoor = zone?.hasBufferDoor || zone?.adj?.hasBufferDoor || 
                                  (zone?.adj && (zone.adj.wall1 === 'unheated' || zone.adj.wall2 === 'unheated') && zone.adj.hasDoor);

            const hasEastWestWin = zone?.windows?.some(w => ['E', 'W'].includes(w.orient));
            const hasRoofWin = zone?.windows?.some(w => w.tilt === 'inclinee');
            const isHeavyStructure = zone?.wallMat === 'concrete' || zone?.wallMat === 'stone' || zone?.floorMat === 'lourd';

            // --- NIVEAU 1 : ACTIONS IMMÉDIATES (< 1h) ---

            // Humidité & VMC
            if (rh > 65 && ahExt < ahInt) {
                if (zone?.equipment?.vmcSystem === 'acceleree') {
                    recs.push({ id: `${zoneId}_vmc_boost`, level: 1, actionKey: 'vmc_boost', zoneId, zoneName, timing: 'immediate', type: 'type-air', title: 'Boost VMC anti-humidité', text: `L'humidité atteint ${rh} %. Passez la VMC en vitesse rapide.`, impactWeight: 15 });
                } else if (hasWindows) {
                    const dur = (mainVentType === 'oscillante' || mainVentType === 'oscillo_battante') ? '12 à 15 minutes' : '5 minutes';
                    recs.push({ id: `${zoneId}_open_win_humidity`, level: 1, actionKey: 'open_win_humidity', zoneId, zoneName, timing: 'immediate', type: 'type-air', title: 'Aération flash ciblée', text: `Ouvrez la fenêtre ${dur} en position ${mainVentType} pour évacuer la vapeur d'eau.`, impactWeight: 12 });
                }
            }

            // Arbitrage surchauffe / Free-cooling
            const isOutdoorHeatwaveThreat = tExtMaxDay > (ta + 1.5);
            if (needsCooling && envDataGlobal.t_ext < ta && hasWindows && (globalHousePmv >= -0.2 || isOutdoorHeatwaveThreat)) {
                recs.push({ id: `${zoneId}_free_cooling`, level: 1, actionKey: 'free_cooling', zoneId, zoneName, timing: 'immediate', type: 'type-cool', title: 'Surventilation traversante (Free-cooling)', text: `Il fait plus frais dehors (${envDataGlobal.t_ext} °C). Ouvrez pour décharger l'air chaud de la pièce.`, impactWeight: 20 });
            }

            // Purge à la source
            if ((zone?.usages?.includes('kitchen') || zone?.usages?.includes('bath')) && rh > 60 && hasVentilationSystem) {
                recs.push({ id: `${zoneId}_humidity_source_purge`, level: 1, actionKey: 'vmc_boost', zoneId, zoneName, timing: 'immediate', type: 'type-air', title: 'Purge à la source (Cuisine / SDB)', text: `Extraire l'humidité immédiatement pour bloquer sa migration vers le séjour.`, impactWeight: 14 });
            }

            // Coupure du chauffage pendant l'aération
            if (isHeatingSeasonActive && needsHeat && envDataGlobal.t_ext < 10 && (zone?.equipment?.heating?.system && zone.equipment.heating.system !== 'aucun')) {
                recs.push({ id: `${zoneId}_heating_cut_during_ventilation`, level: 1, actionKey: 'heating_cut', zoneId, zoneName, timing: 'immediate', type: 'type-eco', title: 'Coupure du chauffage pendant l\'aération', text: `Coupez le chauffage dans cette pièce pendant l'ouverture des fenêtres.`, impactWeight: 10 });
            }

            // Protections solaires
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

            // Local Tampon
            if (!isBuffer && hasBufferDoor) {
                recs.push({ id: `${zoneId}_buffer_door_close`, level: 1, actionKey: 'heating_cut', zoneId, zoneName, timing: 'immediate', type: 'type-eco', title: 'Isolation de zone tampon froide', text: `Fermez bien la porte de communication avec le local non chauffé (garage/cellier).`, impactWeight: 12 });
                
                if (needsHeat) {
                    recs.push({ id: `${zoneId}_buffer_door_open_heat`, level: 1, actionKey: 'sun_heat', zoneId, zoneName, timing: 'immediate', type: 'type-heat', title: 'Captation de calories sur zone tampon', text: `Si la véranda/espace tampon dépasse la température de la pièce, ouvrez la porte pour capter l'air chaud.`, impactWeight: 12 });
                }
            }

            // Transfert thermique inter-pièces
            if (roomPmv > 0.5 && roomPmv > (globalHousePmv + 0.3)) {
                recs.push({ id: `${zoneId}_inter_room_heat_transfer`, level: 1, actionKey: 'sun_heat', zoneId, zoneName, timing: 'immediate', type: 'type-eco', title: 'Dissipation de chaleur vers le reste du logement', text: `Cette pièce est plus chaude que le reste de la maison (${ta} °C). Ouvrez la porte intérieure pour laisser sa chaleur s'équilibrer avec les pièces plus fraîches.`, impactWeight: 10 });
            }

            // --- NIVEAU 2 : OPPORTUNISME 24H ---

            if (needsCooling && isSunny && hasShutters && isMorning) {
                recs.push({ id: `${zoneId}_anticipate_sun`, level: 2, actionKey: 'anticipate_sun', zoneId, zoneName, timing: 'anticipated', type: 'type-sun', title: 'Occultation préventive du matin', text: `Fermez les volets dès 10h pour devancer le pic de chaleur de l'après-midi.`, impactWeight: 15 });
            }

            if (isHeatingSeasonActive && needsHeat && zone?.equipment?.heating?.system === 'floor') {
                recs.push({ id: `${zoneId}_floor_inertia`, level: 2, actionKey: 'floor_inertia', zoneId, zoneName, timing: 'anticipated', type: 'type-heat', title: 'Anticipation plancher chauffant', text: `Relancez la consigne 3 heures à l'avance pour compenser la forte inertie de la dalle.`, impactWeight: 15 });
            }

            if (isHeatingSeasonActive && zone?.usages?.includes('bedroom') && needsHeat && isEvening) {
                recs.push({ id: `${zoneId}_bedroom_temp_drop`, level: 2, actionKey: 'bedroom_temp', zoneId, zoneName, timing: 'anticipated', type: 'type-eco', title: 'Consigne nocturne en chambre (17 °C à 18 °C)', text: `Réglez le thermostat à 17-18 °C 1h avant le coucher (7 % d'économie par degré).`, impactWeight: 12 });
            }

            if (isHeatingSeasonActive && needsHeat && zone?.equipment?.heating?.system === 'radiator_cast' && isEvening) {
                recs.push({ id: `${zoneId}_cast_iron_radiator_early_cut`, level: 2, actionKey: 'heating_cut', zoneId, zoneName, timing: 'anticipated', type: 'type-eco', title: 'Coupure anticipée émetteurs en fonte', text: `Coupez 45 min avant votre départ ou coucher : l'inertie de la fonte continuera de chauffer.`, impactWeight: 14 });
            }

            if (needsHeat && zone?.equipment?.fanSystem === 'plafond' && isEvening) {
                recs.push({ id: `${zoneId}_destratification_fan`, level: 2, actionKey: 'fan_on', zoneId, zoneName, timing: 'anticipated', type: 'type-heat', title: 'Déstratification hivernale', text: `Faites tourner le brasseur à vitesse lente (sens horaire) pour rabattre l'air chaud au sol.`, impactWeight: 12 });
            }

            if (needsCooling && zone?.adj?.ceiling?.includes('outside') && isEvening) {
                recs.push({ id: `${zoneId}_attic_thermal_lag_ventilation`, level: 2, actionKey: 'free_cooling', zoneId, zoneName, timing: 'anticipated', type: 'type-cool', title: 'Évacuation du déphasage sous toiture', text: `Surventilez en fin de journée pour évacuer la chaleur restituée par l'isolant du plafond.`, impactWeight: 14 });
            }

            // --- NIVEAU 3 : STRATÉGIE MÉTÉO (48h-72h) ---
            if (needsCooling && isHeavyStructure && isNight) {
                recs.push({ id: `${zoneId}_heavy_wall_night_purge`, level: 3, actionKey: 'free_cooling', zoneId, zoneName, timing: 'strategic', type: 'type-cool', title: 'Décharge nocturne des parois lourdes', text: `Maintenez la surventilation nocturne pour refroidir le cœur des murs lourds.`, impactWeight: 18 });
            }

            if (isHeatingSeasonActive && isHeavyStructure && envDataGlobal.t_ext < 5) {
                recs.push({ id: `${zoneId}_cold_wave_pre_heating`, level: 3, actionKey: 'floor_inertia', zoneId, zoneName, timing: 'strategic', type: 'type-heat', title: 'Pré-charge thermique avant vague de froid (48h)', text: `Vague de froid prévue : Remontez la consigne de 1 °C dès aujourd'hui pour charger la masse des murs.`, impactWeight: 20 });
            }

            if (needsCooling && isHeavyStructure && isNight) {
                recs.push({ id: `${zoneId}_deep_precooling_heatwave`, level: 3, actionKey: 'free_cooling', zoneId, zoneName, timing: 'strategic', type: 'type-cool', title: 'Sur-rafraîchissement de masse pré-canicule (48h)', text: `Canicule durable prévue sous 48h : Surventilez au maximum la nuit prochaine pour geler la masse des murs porteurs.`, impactWeight: 22 });
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
            return allRecs;
        }

        function render() {
            const recs = getAllRecommendations();
            if (containerImmediate) containerImmediate.innerHTML = '';
            if (containerAnticipated) containerAnticipated.innerHTML = '';
            if (containerStrategic) containerStrategic.innerHTML = '';
            if (containerCompleted) containerCompleted.innerHTML = '';

            const immediatePending = recs.filter(r => (r.timing === 'immediate' || r.level === 1) && !checkedActions[r.id]);
            const anticipatedPending = recs.filter(r => (r.timing === 'anticipated' || r.level === 2) && !checkedActions[r.id]);
            const strategicPending = recs.filter(r => (r.timing === 'strategic' || r.level === 3) && !checkedActions[r.id]);
            const completedList = recs.filter(r => checkedActions[r.id]);

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
                const isChecked = !!checkedActions[rec.id];
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
            if (cb && cb.checked) {
                checkedActions[id] = true;
            } else {
                delete checkedActions[id];
            }

            store.saveCheckedRecos(checkedActions);
            render();
        }

        // ============================================================
        // CALCUL FINANCIER EN TEMPS RÉEL & CAGNOTTE CUMULÉE
        // ============================================================
        function calculateFinancialImpact(allRecs, checkedActions) {
            let savedKwhDay = 0;
            let earnedPoints = 0;

            const selectedZone = zoneSelect ? zoneSelect.value : currentZoneId;
            const targetZoneConfig = houseConfig[selectedZone] || null;
            const costPerKwh = getEnergyCostPerKwh(targetZoneConfig);

            allRecs.forEach(r => {
                if (checkedActions[r.id]) {
                    earnedPoints += r.impactWeight;
                    
                    if (r.actionKey === 'shutter_close' || r.actionKey === 'anticipate_sun') {
                        savedKwhDay += 2.5;
                    } else if (r.actionKey === 'bedroom_temp' || r.actionKey === 'heating_cut') {
                        savedKwhDay += 1.8;
                    } else if (r.actionKey === 'free_cooling' || r.actionKey === 'vmc_boost') {
                        savedKwhDay += 1.2;
                    } else if (r.actionKey === 'floor_inertia' || r.actionKey === 'sun_heat') {
                        savedKwhDay += 2.0;
                    } else {
                        savedKwhDay += 0.5;
                    }
                }
            });

            const savedEurDay = savedKwhDay * costPerKwh;
            return { savedKwhDay, savedEurDay, earnedPoints };
        }

        function updateCagnotteUI(savedKwhDay, savedEurDay, earnedPoints) {
            const eurDayEl = document.getElementById('disp-daily-savings-eur');
            const kwhDayEl = document.getElementById('disp-daily-savings-kwh');
            if (eurDayEl) eurDayEl.textContent = `${savedEurDay.toFixed(2)} €`;
            if (kwhDayEl) kwhDayEl.textContent = `${savedKwhDay.toFixed(1)} kWh/j évités`;

            let totalCagnotteEur = parseFloat(localStorage.getItem('SOLSTICE_CAGNOTTE_EUR')) || 0.0;
            let totalScorePts = parseInt(localStorage.getItem('SOLSTICE_CAGNOTTE_SCORE_PTS')) || 0;

            const totalEurEl = document.getElementById('disp-cagnotte-total');
            const detailsEl = document.getElementById('disp-cagnotte-details');

            if (totalEurEl) totalEurEl.textContent = `${(totalCagnotteEur + savedEurDay).toFixed(2)} €`;
            if (detailsEl) detailsEl.textContent = `${totalScorePts + earnedPoints} pts d'Éco-Score cumulés`;
        }

        function updateMetrics(allRecs) {
            let totalWeightPossible = 0;
            let earnedWeight = 0;
            const checkedActionKeys = [];

            allRecs.forEach(r => {
                totalWeightPossible += r.impactWeight;
                if (checkedActions[r.id]) {
                    earnedWeight += r.impactWeight;
                    checkedActionKeys.push(r.actionKey);
                }
            });

            const score = totalWeightPossible > 0 ? Math.round((earnedWeight / totalWeightPossible) * 100) : 100;
            const scoreValEl = document.getElementById('scoreVal');
            const scoreBarEl = document.getElementById('scoreBar');
            if (scoreValEl) scoreValEl.textContent = `${score} / 100 pts`;
            if (scoreBarEl) scoreBarEl.style.width = `${score}%`;

            const selectedZone = zoneSelect ? zoneSelect.value : currentZoneId;
            const zonesMap = getAvailableZonesMap();
            const roomName = zonesMap[selectedZone] || selectedZone;
            const roomTitleEl = document.getElementById('roomScoreTitle');

            if (roomTitleEl) {
                roomTitleEl.textContent = selectedZone === 'all'
                    ? `Score d'Éco-Performance (Vue globale)`
                    : `Score d'Éco-Performance — ${roomName}`;
            }

            const targetZoneConfig = houseConfig[selectedZone] || null;
            const roomData = donneesHabitat[roomName] || {
                ta: parseFloat(sessionStorage.getItem('indoorAirTemp')) || 20,
                rh: parseFloat(sessionStorage.getItem('indoorHumidity')) || 50
            };

            const baseTa = roomData.ta;
            const baseTr = engine.calculateMeanRadiantTemp(targetZoneConfig, baseTa);
            const baseVel = engine.calculateAirVelocity(targetZoneConfig, roomName);
            const { met, totalClo } = engine.getBaseCloAndMet(targetZoneConfig);

            const baseState = { ta: baseTa, tr: baseTr, vel: baseVel, rh: roomData.rh, met, clo: totalClo };

            const pmvInit = engine.calculatePMV(baseTa, baseTr, baseVel, roomData.rh, met, totalClo);
            const simulation = engine.evaluateSimulatedPMV(baseState, checkedActionKeys, envDataGlobal);

            const dispInitEl = document.getElementById('disp-pmv-init');
            const simEl = document.getElementById('disp-pmv-sim');

            if (dispInitEl) dispInitEl.textContent = (pmvInit > 0 ? "+" : "") + pmvInit.toFixed(2);
            if (simEl) {
                const pmvSimulated = simulation.pmv;
                simEl.textContent = (pmvSimulated > 0 ? "+" : "") + pmvSimulated.toFixed(2);
                simEl.style.color = Math.abs(pmvSimulated) <= 0.5 ? 'var(--eco, #2ecc71)' : (pmvSimulated > 0.5 ? 'var(--hot, #e74c3c)' : 'var(--cold, #3498db)');
            }

            const { savedKwhDay, savedEurDay, earnedPoints } = calculateFinancialImpact(allRecs, checkedActions);
            updateCagnotteUI(savedKwhDay, savedEurDay, earnedPoints);
        }

        window.resetCagnotte = function() {
            localStorage.removeItem('SOLSTICE_CAGNOTTE_EUR');
            localStorage.removeItem('SOLSTICE_CAGNOTTE_SCORE_PTS');
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
