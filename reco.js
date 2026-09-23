/**
 * ==================================================================
 * SOLSTICE — MOTEUR DE RECOMMANDATIONS & SIMULATION PMV (V6.2)
 * Intégration des 33 règles physiques BEM & modificateurs d'état
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
        const containerCompleted = document.getElementById('container-completed');

        // Calcul de l'humidité absolue (g/m³)
        function getAbsoluteHumidity(ta, rh) {
            const pSat = 6.112 * Math.exp((17.67 * ta) / (ta + 243.5));
            const pv = pSat * (rh / 100);
            return (216.7 * pv) / (ta + 273.15);
        }

        // Calcul du potentiel de séchage / VPD (kPa)
        function getVPD(ta, rh) {
            const pSat = 611.2 * Math.exp((17.67 * ta) / (ta + 243.5));
            return (pSat * (1 - rh / 100)) / 1000;
        }

        // Fusion des sources pour dresser la carte des zones
        function getAvailableZonesMap() {
            const zonesMap = {};
            Object.keys(houseConfig).forEach(zId => {
                zonesMap[zId] = houseConfig[zId].name || zId;
            });
            Object.keys(donneesHabitat).forEach(roomName => {
                const zId = roomName.toLowerCase().replace(/[^a-z0-9]/g, '_');
                if (!zonesMap[zId] && !Object.values(zonesMap).includes(roomName)) {
                    zonesMap[zId] = roomName;
                }
            });
            if (Object.keys(zonesMap).length === 0) {
                zonesMap['salon'] = 'Salon';
            }
            return zonesMap;
        }

        // Filtrage appliqué dans reco.js lors de la génération
function getFilteredRecommendations(zone, zoneId, roomData) {
    // 1. Récupération du profil configuré (par défaut: mid_term)
    const globalConfig = JSON.parse(localStorage.getItem('HOUSE_CONFIG'))?.global || {};
    const userProfileKey = globalConfig.userProfile || 'mid_term';
    const profileDef = SolsticeEngine.PROFILES[userProfileKey];

    // 2. Génération de toutes les recommandations applicables
    const rawRecs = generateRecommendationsForZone(zone, zoneId, roomData);

    // 3. Filtrage selon les niveaux autorisés
    return rawRecs.filter(rec => profileDef.allowedLevels.includes(rec.level));
}
        
        function setupZoneSelector() {
            if (!zoneSelect) return;
            zoneSelect.innerHTML = '';
            const zonesMap = getAvailableZonesMap();

            Object.keys(zonesMap).forEach(zId => {
                const opt = document.createElement('option');
                opt.value = zId;
                opt.textContent = `📍 ${zonesMap[zId]}`;
                if (zId === currentZoneId || zonesMap[zId] === currentZoneId) {
                    opt.selected = true;
                }
                zoneSelect.appendChild(opt);
            });

            const optAll = document.createElement('option');
            optAll.value = 'all';
            optAll.textContent = '🌐 Toutes les pièces';
            if (currentZoneId === 'all') optAll.selected = true;
            zoneSelect.appendChild(optAll);
        }

        // --- GÉNÉRATION DYNAMIQUE DES 33 RECOMMANDATIONS BEM ---
        function generateRecommendationsForZone(zone, zoneId, roomData) {
            const recs = [];
            const zoneName = zone ? (zone.name || zoneId) : zoneId;
            const ta = roomData.ta || parseFloat(sessionStorage.getItem('indoorAirTemp')) || 20;
            const rh = roomData.rh || parseFloat(sessionStorage.getItem('indoorHumidity')) || 50;
            const ahInt = getAbsoluteHumidity(ta, rh);
            const ahExt = getAbsoluteHumidity(envDataGlobal.t_ext, 60);
            const vpdRoom = getVPD(ta, rh);

            const tr = engine.calculateMeanRadiantTemp(zone, ta);
            const vel = engine.calculateAirVelocity(zone, zoneName);
            const { met, totalClo } = engine.getBaseCloAndMet(zone);

            const roomPmv = engine.calculatePMV(ta, tr, vel, rh, met, totalClo);
            const needsHeat = roomPmv < -0.4;
            const needsCooling = roomPmv > 0.4;
            const isSunny = envDataGlobal.sun_status.toLowerCase().includes('clear') || envDataGlobal.sun_status.toLowerCase().includes('sun');

            const hasWindows = !zone || !zone.windows || zone.windows.length === 0 || zone.windows.some(w => w.vent !== 'fixe');
            const mainVentType = zone?.windows?.find(w => w.vent && w.vent !== 'fixe')?.vent || 'battante';
            const hasShutters = !zone || !zone.windows || zone.windows.some(w => w.shutter && w.shutter !== 'aucun');
            const hasEastWestWin = zone?.windows?.some(w => ['E', 'W'].includes(w.orient));
            const hasRoofWin = zone?.windows?.some(w => w.tilt === 'inclinee');
            const isHeavyStructure = zone?.wallMat === 'concrete' || zone?.wallMat === 'stone' || zone?.floorMat === 'lourd';
            const isLightStructure = zone?.wallMat === 'wood' || zone?.floorMat === 'leger';

            // 1. VENTILATION, AÉRATION & AIR
            if (rh > 65 && ahExt < ahInt) {
                if (zone?.equipment?.vmcSystem === 'acceleree') {
                    recs.push({
                        id: `${zoneId}_vmc_boost`, actionKey: 'vmc_boost', zoneId, zoneName, timing: 'immediate', type: 'type-air',
                        title: 'Boost VMC anti-humidité',
                        text: `L'humidité atteint ${rh} % (AH int: ${ahInt.toFixed(1)} g/m³ > AH ext: ${ahExt.toFixed(1)} g/m³). Passez la VMC en vitesse rapide.`,
                        impactWeight: 15
                    });
                } else if (hasWindows) {
                    const durationText = (mainVentType === 'oscillante' || mainVentType === 'oscillo_battante') ? '12 à 15 minutes' : '5 minutes';
                    recs.push({
                        id: `${zoneId}_open_win_humidity`, actionKey: 'open_win_humidity', zoneId, zoneName, timing: 'immediate', type: 'type-air',
                        title: 'Aération flash ciblée',
                        text: `Ouvrez la fenêtre pendant ${durationText} en position ${mainVentType} pour évacuer la vapeur d'eau ambiante.`,
                        impactWeight: 12
                    });
                }
            }

            if (needsCooling && envDataGlobal.t_ext < ta && hasWindows) {
                recs.push({
                    id: `${zoneId}_free_cooling`, actionKey: 'free_cooling', zoneId, zoneName, timing: 'immediate', type: 'type-cool',
                    title: 'Surventilation traversante (Free-cooling)',
                    text: `Il fait plus frais dehors (${envDataGlobal.t_ext} °C). Ouvrez pour décharger la chaleur accumulée dans l'air.`,
                    impactWeight: 20
                });
            }

            if (roomPmv > 0.5 && zone?.windows && zone.windows.length >= 2) {
                recs.push({
                    id: `${zoneId}_flash_cross_vent`, actionKey: 'free_cooling', zoneId, zoneName, timing: 'immediate', type: 'type-cool',
                    title: 'Aération croisée ultra-courte (Purge d\'air)',
                    text: `Ouvrez 3 minutes en traversant pour purger l'air chaud sans refroidir la masse thermique des murs.`,
                    impactWeight: 15
                });
            }

            if ((zone?.usages?.includes('kitchen') || zone?.usages?.includes('bath')) && rh > 60) {
                recs.push({
                    id: `${zoneId}_humidity_source_purge`, actionKey: 'vmc_boost', zoneId, zoneName, timing: 'immediate', type: 'type-air',
                    title: 'Purge à la source (Cuisine / SDB)',
                    text: `Activez l'extraction immédiate pour bloquer la migration de l'humidité absolue vers les pièces de vie.`,
                    impactWeight: 14
                });
            }

            if (needsHeat && envDataGlobal.t_ext < 10 && (zone?.equipment?.heating?.system && zone.equipment.heating.system !== 'aucun')) {
                recs.push({
                    id: `${zoneId}_heating_cut_during_ventilation`, actionKey: 'heating_cut', zoneId, zoneName, timing: 'immediate', type: 'type-eco',
                    title: 'Coupure du chauffage pendant l\'aération',
                    text: `Coupez le chauffage dans cette pièce avant d'aérer pour éviter l'emballement du générateur.`,
                    impactWeight: 10
                });
            }

            // 2. PROTECTIONS SOLAIRES & RAYONNEMENT (Tr)
            if (needsCooling && isSunny && hasShutters) {
                recs.push({
                    id: `${zoneId}_shutter_close`, actionKey: 'shutter_close', zoneId, zoneName, timing: 'immediate', type: 'type-sun',
                    title: 'Bouclier solaire immédiat',
                    text: `Baissez les volets/stores pour bloquer le rayonnement solaire direct avant le vitrage.`,
                    impactWeight: 25
                });
                recs.push({
                    id: `${zoneId}_anticipate_sun`, actionKey: 'anticipate_sun', zoneId, zoneName, timing: 'anticipated', type: 'type-sun',
                    title: 'Occultation préventive du matin',
                    text: `Anticipez le pic thermique de l'après-midi : fermez les protections solaires dès 10h.`,
                    impactWeight: 15
                });
            }

            if (needsCooling && isSunny && hasEastWestWin) {
                recs.push({
                    id: `${zoneId}_targeted_orientation_shield`, actionKey: 'shutter_close', zoneId, zoneName, timing: 'immediate', type: 'type-sun',
                    title: 'Bouclier solaire orienté Est / Ouest',
                    text: `Fermez en priorité les volets de la façade exposée au soleil rasant (Est avant 12h, Ouest après 14h).`,
                    impactWeight: 18
                });
            }

            if (needsCooling && isSunny && hasRoofWin) {
                recs.push({
                    id: `${zoneId}_roof_window_shield`, actionKey: 'shutter_close', zoneId, zoneName, timing: 'immediate', type: 'type-sun',
                    title: 'Protection prioritaire des fenêtres de toit',
                    text: `Occultez en priorité les Velux : le rayonnement sous toit génère la charge thermique la plus forte.`,
                    impactWeight: 22
                });
            }

            if (needsHeat && isSunny && envDataGlobal.t_ext < ta) {
                recs.push({
                    id: `${zoneId}_sun_heat`, actionKey: 'sun_heat', zoneId, zoneName, timing: 'immediate', type: 'type-sun',
                    title: 'Chauffage solaire passif',
                    text: `Ouvrez grand les volets pour laisser le soleil chauffer gratuitement les parois et l'air.`,
                    impactWeight: 20
                });
            }

            if (needsHeat && !isSunny) {
                recs.push({
                    id: `${zoneId}_winter_night_shutters`, actionKey: 'shutter_close', zoneId, zoneName, timing: 'immediate', type: 'type-sun',
                    title: 'Bouclier thermique nocturne',
                    text: `Fermez volets et rideaux dès la tombée du jour pour créer une lame d'air isolante face au vitrage froid.`,
                    impactWeight: 12
                });
            }

            if (needsHeat && zone?.windows?.some(w => w.shutter === 'store_banne')) {
                recs.push({
                    id: `${zoneId}_autumn_solar_unmask`, actionKey: 'sun_heat', zoneId, zoneName, timing: 'immediate', type: 'type-sun',
                    title: 'Relevage des stores bannes en mi-saison',
                    text: `Relevez entièrement les stores extérieurs pour exposer 100 % de la baie au soleil rasant.`,
                    impactWeight: 10
                });
            }

            if (needsHeat && zone?.windows?.some(w => w.glass === 'single' || w.glass === 'double_old')) {
                recs.push({
                    id: `${zoneId}_single_glass_thermal_curtain`, actionKey: 'shutter_close', zoneId, zoneName, timing: 'immediate', type: 'type-heat',
                    title: 'Rideau épais sur vitrage ancien',
                    text: `Tirez les rideaux épais le soir pour couper le courant d'air froid convectif le long de la vitre.`,
                    impactWeight: 12
                });
            }

            // 3. CHAUFFAGE, ÉMETTEURS & RÉGULATION
            if (needsHeat && zone?.equipment?.heating?.system === 'floor') {
                recs.push({
                    id: `${zoneId}_floor_inertia`, actionKey: 'floor_inertia', zoneId, zoneName, timing: 'anticipated', type: 'type-heat',
                    title: 'Anticipation plancher chauffant',
                    text: `Relancez la consigne 3 heures à l'avance pour compenser la forte inertie de la dalle.`,
                    impactWeight: 15
                });
            }

            if (zone?.usages?.includes('bedroom') && needsHeat) {
                recs.push({
                    id: `${zoneId}_bedroom_temp_drop`, actionKey: 'bedroom_temp', zoneId, zoneName, timing: 'anticipated', type: 'type-eco',
                    title: 'Consigne nocturne en chambre (17 °C à 18 °C)',
                    text: `Ajustez le thermostat à 17 °C / 18 °C 1h avant le coucher (gain de 7 % par degré).`,
                    impactWeight: 12
                });
            }

            if (zone?.equipment?.heating?.intermittency === 'continuous' && isHeavyStructure) {
                recs.push({
                    id: `${zoneId}_heating_intermittency_adjust`, actionKey: 'bedroom_temp', zoneId, zoneName, timing: 'anticipated', type: 'type-eco',
                    title: 'Passage en réduit nocturne (Structure lourde)',
                    text: `Passez en réduit la nuit. La réserve thermique des murs lissera la température sans perte de confort.`,
                    impactWeight: 15
                });
            }

            if (needsHeat && isLightStructure) {
                recs.push({
                    id: `${zoneId}_light_wall_quick_boost`, actionKey: 'sun_heat', zoneId, zoneName, timing: 'anticipated', type: 'type-heat',
                    title: 'Chauffe réactive sur structure légère',
                    text: `Inutile d'anticiper la chauffe des heures à l'avance. Une relance rapide au moment de l'occupation suffit.`,
                    impactWeight: 10
                });
            }

            if (roomPmv > 0.3 && zone?.equipment?.heating?.regulation?.includes('thermostatic_valve')) {
                recs.push({
                    id: `${zoneId}_thermostatic_balancing`, actionKey: 'heating_cut', zoneId, zoneName, timing: 'immediate', type: 'type-eco',
                    title: 'Équilibrage par robinet thermostatique',
                    text: `Réduisez la vanne d'un cran dans cette pièce surchauffée pour réorienter l'eau chaude vers les zones froides.`,
                    impactWeight: 12
                });
            }

            if (zone?.equipment?.heating?.regulation?.includes('thermostatic_valve')) {
                recs.push({
                    id: `${zoneId}_thermostatic_unoccupied_drop`, actionKey: 'heating_cut', zoneId, zoneName, timing: 'anticipated', type: 'type-eco',
                    title: 'Réduit ciblé sur zone inoccupée',
                    text: `Réglez la vanne thermostatique sur 1 ou 2 (14 °C à 16 °C) lorsque la pièce est inoccupée.`,
                    impactWeight: 10
                });
            }

            if (needsHeat && zone?.equipment?.heating?.system === 'radiator_cast') {
                recs.push({
                    id: `${zoneId}_cast_iron_radiator_early_cut`, actionKey: 'heating_cut', zoneId, zoneName, timing: 'anticipated', type: 'type-eco',
                    title: 'Coupure anticipée émetteurs en fonte',
                    text: `Coupez la consigne 45 min avant votre départ ou coucher. L'inertie de la fonte continuera de chauffer à coût zéro.`,
                    impactWeight: 14
                });
            }

            // 4. REFROIDISSEMENT, CLIMATISATION & BRASSAGE D'AIR
            if (needsCooling && zone?.equipment?.fanSystem && zone.equipment.fanSystem !== 'aucun') {
                recs.push({
                    id: `${zoneId}_fan_on`, actionKey: 'fan_on', zoneId, zoneName, timing: 'immediate', type: 'type-eco',
                    title: `Activer le brassage d'air (${zone.equipment.fanSystem})`,
                    text: `Allumez le ventilateur. Le flux d'air rafraîchit le ressenti cutané de 2 °C à 3 °C sans climatisation.`,
                    impactWeight: 18
                });
            }

            if (roomPmv > 0.5 && zone?.equipment?.fanSystem === 'plafond') {
                recs.push({
                    id: `${zoneId}_summer_forward_fan`, actionKey: 'fan_on', zoneId, zoneName, timing: 'immediate', type: 'type-eco',
                    title: 'Sens de rotation estival du ventilateur',
                    text: `Vérifiez que le brasseur tourne en sens anti-horaire (direct) pour pousser le flux d'air vers le bas.`,
                    impactWeight: 10
                });
            }

            if (needsHeat && zone?.equipment?.fanSystem === 'plafond') {
                recs.push({
                    id: `${zoneId}_destratification_fan`, actionKey: 'fan_on', zoneId, zoneName, timing: 'anticipated', type: 'type-heat',
                    title: 'Déstratification hivernale',
                    text: `Faites tourner le ventilateur de plafond à vitesse minimale (sens horaire) pour rabattre l'air chaud accumulé en haut.`,
                    impactWeight: 12
                });
            }

            if (needsCooling && zone?.equipment?.cooling?.system === 'clim_mobile') {
                recs.push({
                    id: `${zoneId}_mobile_ac_pressure_seal`, actionKey: 'shutter_close', zoneId, zoneName, timing: 'immediate', type: 'type-cool',
                    title: 'Étanchéité de gaine de clim mobile',
                    text: `Calfeutrez le passage de fenêtre. La dépression du monobloc réaspire sinon l'air chaud extérieur.`,
                    impactWeight: 16
                });
            }

            if (zone?.equipment?.cooling?.system === 'plancher_raf' && rh > 60) {
                recs.push({
                    id: `${zoneId}_cooling_floor_dew_point_guard`, actionKey: 'shutter_close', zoneId, zoneName, timing: 'anticipated', type: 'type-cool',
                    title: 'Garde-fou condensation plancher rafraîchissant',
                    text: `Ne réglez pas la consigne sous 22 °C pour éviter d'atteindre le point de rosée et de condenser au sol.`,
                    impactWeight: 15
                });
            }

            // 5. INERTIE & PAROIS (Tstruct)
            if (needsCooling && isHeavyStructure) {
                recs.push({
                    id: `${zoneId}_heavy_wall_night_purge`, actionKey: 'free_cooling', zoneId, zoneName, timing: 'anticipated', type: 'type-cool',
                    title: 'Décharge nocturne des parois lourdes',
                    text: `Maintenez la surventilation nocturne pour refroidir le cœur des murs lourds et restaurer leur réserve de fraîcheur.`,
                    impactWeight: 18
                });
            }

            if (needsHeat && isSunny && zone?.floorMat === 'lourd') {
                recs.push({
                    id: `${zoneId}_solar_mass_charge`, actionKey: 'sun_heat', zoneId, zoneName, timing: 'immediate', type: 'type-sun',
                    title: 'Stockage solaire sur dalle lourde',
                    text: `Dégagez le sol près des baies Sud pour injecter l'énergie solaire directement dans la dalle en béton.`,
                    impactWeight: 15
                });
            }

            if (zone?.insulation === 'ite_heavy' && needsHeat) {
                recs.push({
                    id: `${zoneId}_ite_heating_anticipation`, actionKey: 'floor_inertia', zoneId, zoneName, timing: 'anticipated', type: 'type-heat',
                    title: 'Relance douce sur isolation extérieure (ITE)',
                    text: `Anticipez la relance de 2h de façon très progressive pour réchauffer la masse murale située dans le volume isolé.`,
                    impactWeight: 12
                });
            }

            if (needsHeat && (tr - ta) > 1.5) {
                recs.push({
                    id: `${zoneId}_wall_heat_restitution_delay`, actionKey: 'floor_inertia', zoneId, zoneName, timing: 'anticipated', type: 'type-heat',
                    title: 'Exploitation du déphasage mural',
                    text: `Retardez l'allumage du chauffage actif : le rayonnement infrarouge des murs froids/chauds maintient le confort.`,
                    impactWeight: 12
                });
            }

            if (needsCooling && zone?.adj?.ceiling?.includes('outside')) {
                recs.push({
                    id: `${zoneId}_attic_thermal_lag_ventilation`, actionKey: 'free_cooling', zoneId, zoneName, timing: 'anticipated', type: 'type-cool',
                    title: 'Évacuation du déphasage sous toiture',
                    text: `Surventilez en fin de journée pour évacuer l'onde de chaleur restituée par l'isolant du plafond.`,
                    impactWeight: 14
                });
            }

            // 6. ESPACES TAMPONS, HUMIDITÉ & TRANSFERTS INTER-PIÈCES
            if (zone?.adj?.wall1 === 'unheated' || zone?.adj?.wall2 === 'unheated' || zone?.adj?.wall3 === 'unheated' || zone?.adj?.wall4 === 'unheated') {
                recs.push({
                    id: `${zoneId}_buffer_door_close`, actionKey: 'heating_cut', zoneId, zoneName, timing: 'immediate', type: 'type-eco',
                    title: 'Isolation de zone tampon froide',
                    text: `Fermez bien la porte de communication avec le local non chauffé (garage/cellier) pour stopper les courants d'air.`,
                    impactWeight: 12
                });
            }

            if (needsHeat && (zone?.adj?.wall1 === 'unheated' || zone?.adj?.wall2 === 'unheated')) {
                recs.push({
                    id: `${zoneId}_buffer_door_open_heat`, actionKey: 'sun_heat', zoneId, zoneName, timing: 'immediate', type: 'type-heat',
                    title: 'Captation de calories sur zone tampon chaude',
                    text: `Si votre véranda ou espace tampon dépasse la température de la pièce, ouvrez la porte pour capter l'air chaud.`,
                    impactWeight: 12
                });
            }

            if (rh < 40 && vpdRoom > 0.8) {
                recs.push({
                    id: `${zoneId}_laundry_dry_humidify`, actionKey: 'vmc_boost', zoneId, zoneName, timing: 'immediate', type: 'type-air',
                    title: 'Humidification passive par le linge',
                    text: `L'air est sec (${rh} %). Étendez le linge humide dans cette pièce pour réhydrater l'air et améliorer le ressenti.`,
                    impactWeight: 10
                });
            } else if (vpdRoom < 0.4) {
                recs.push({
                    id: `${zoneId}_optimal_laundry_zone`, actionKey: 'vmc_boost', zoneId, zoneName, timing: 'anticipated', type: 'type-eco',
                    title: 'Déplacement du séchage de linge',
                    text: `Le potentiel de séchage est faible ici. Déplacez le séchoir dans un local mieux ventilé ou à fort VPD.`,
                    impactWeight: 10
                });
            }

            if (rh > 60 && (zone?.insulation === 'none' || zone?.insulation === 'iti_old') && envDataGlobal.t_ext < 5) {
                recs.push({
                    id: `${zoneId}_cold_wall_dew_prevention`, actionKey: 'vmc_boost', zoneId, zoneName, timing: 'anticipated', type: 'type-air',
                    title: 'Prévention du point de rosée sur paroi froide',
                    text: `Activez une légère circulation d'air pour éviter la condensation superficielle et la moisissure dans les angles froids.`,
                    impactWeight: 15
                });
            }

            if (roomPmv > 0.7) {
                recs.push({
                    id: `${zoneId}_internal_gains_reduction`, actionKey: 'shutter_close', zoneId, zoneName, timing: 'anticipated', type: 'type-eco',
                    title: 'Extinction des apports internes parasites',
                    text: `Éteignez veilles électriques, ordinateurs et éclairages inutiles qui dégagent de la chaleur sensible.`,
                    impactWeight: 10
                });
            }

            return recs;
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

        // RENDU & MIGRATION VERS DÉPARTEMENT ACTIONS EFFECTUÉES
        function render() {
            const recs = getAllRecommendations();
            if (containerImmediate) containerImmediate.innerHTML = '';
            if (containerAnticipated) containerAnticipated.innerHTML = '';
            if (containerCompleted) containerCompleted.innerHTML = '';

            const immediatePending = recs.filter(r => r.timing === 'immediate' && !checkedActions[r.id]);
            const anticipatedPending = recs.filter(r => r.timing === 'anticipated' && !checkedActions[r.id]);
            const completedList = recs.filter(r => checkedActions[r.id]);

            renderGroup(immediatePending, containerImmediate, "Aucune action immédiate requise.");
            renderGroup(anticipatedPending, containerAnticipated, "Aucune action anticipée requise.");
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
                            <span class="room-badge-bold">📍 ${rec.zoneName}</span>
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

        // EVALUATION DU PMV SIMULÉ ISO 7730
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
                simEl.style.color = Math.abs(pmvSimulated) <= 0.5 ? 'var(--eco)' : (pmvSimulated > 0.5 ? 'var(--hot)' : 'var(--cold)');
            }
        }

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
