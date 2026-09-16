/**
 * ==================================================================
 * SOLSTICE - CORE ENGINE & STORE (V6)
 * Moteur thermique BEM, Calcul PMV, Simulation & Stockage
 * ==================================================================
 */

const SolsticeStore = {
    KEYS: {
        CONFIG: 'HOUSE_CONFIG',
        SCAN: 'SOLSTICE_DONNEES_HABITAT',
        CHECKED_RECOS: 'SOLSTICE_CHECKED_RECOS',
        OUTDOOR_TEMP: 'outdoorTemp',
        SUN_STATUS: 'sunshineStatus'
    },

    getZones() {
        try {
            const raw = localStorage.getItem(this.KEYS.CONFIG);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            console.error("[SolsticeStore] Erreur lecture configuration :", e);
            return {};
        }
    },

    getZone(zoneId) {
        const zones = this.getZones();
        return zones[zoneId] || null;
    },

    saveZone(zoneId, zoneData) {
        if (!zoneId) return false;
        const zones = this.getZones();
        zones[zoneId] = zoneData;
        try {
            localStorage.setItem(this.KEYS.CONFIG, JSON.stringify(zones));
            return true;
        } catch (e) {
            console.error("[SolsticeStore] Erreur sauvegarde zone :", e);
            return false;
        }
    },

    getScanData() {
        try {
            const raw = localStorage.getItem(this.KEYS.SCAN) || sessionStorage.getItem(this.KEYS.SCAN);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    },

    getCheckedRecos() {
        try {
            const raw = localStorage.getItem(this.KEYS.CHECKED_RECOS);
            return raw ? JSON.parse(raw) : {};
        } catch (e) {
            return {};
        }
    },

    saveCheckedRecos(checkedMap) {
        try {
            localStorage.setItem(this.KEYS.CHECKED_RECOS, JSON.stringify(checkedMap));
            return true;
        } catch (e) {
            return false;
        }
    },

    getEnvData() {
        return {
            t_ext: parseFloat(localStorage.getItem(this.KEYS.OUTDOOR_TEMP)) || parseFloat(sessionStorage.getItem(this.KEYS.OUTDOOR_TEMP)) || 15,
            sun_status: localStorage.getItem(this.KEYS.SUN_STATUS) || sessionStorage.getItem(this.KEYS.SUN_STATUS) || 'Clouds'
        };
    }
};

const SolsticeEngine = {
    // Calcul de la Température Radiante Moyenne (Tr)
    calculateMeanRadiantTemp(zoneConfig, tAir) {
        if (!zoneConfig) return tAir;
        let deltaTr = 0;

        // Isolation des murs
        const ins = zoneConfig.insulation || 'iti_recent';
        if (ins === 'none') deltaTr -= 1.8;
        else if (ins === 'iti_old') deltaTr -= 0.8;
        else if (ins === 'ite_heavy') deltaTr += 0.5;

        // Influence des surfaces vitrées (Sud vs Nord)
        if (Array.isArray(zoneConfig.windows)) {
            zoneConfig.windows.forEach(w => {
                const area = parseFloat(w.area) || 0;
                if (w.orient === 'N') deltaTr -= area * 0.15;
                if (['S', 'SE', 'SW'].includes(w.orient) && w.mask === 'none') deltaTr += area * 0.2;
            });
        }

        return Math.round((tAir + deltaTr) * 10) / 10;
    },

    // Vitesse de l'air estimée
    calculateAirVelocity(zoneConfig, roomName) {
        if (!zoneConfig) return 0.08;
        let vel = 0.08; // Vitesse naturelle standard (m/s)

        if (zoneConfig.equipment?.fanSystem === 'plafond') vel += 0.4;
        else if (zoneConfig.equipment?.fanSystem === 'mobile') vel += 0.25;

        if (zoneConfig.equipment?.vmcSystem === 'acceleree') vel += 0.05;
        return vel;
    },

    // Métabolisme (MET) et Habillement (CLO) selon usages
    getBaseCloAndMet(zoneConfig) {
        let met = 1.2;  // Activité de repos / assise
        let totalClo = 1.0; // Habillement mi-saison / intérieur standard

        if (!zoneConfig || !Array.isArray(zoneConfig.usages)) {
            return { met, totalClo };
        }

        if (zoneConfig.usages.includes('bedroom')) {
            met = 0.9;
            totalClo = 1.2;
        } else if (zoneConfig.usages.includes('office')) {
            met = 1.1;
            totalClo = 0.9;
        } else if (zoneConfig.usages.includes('kitchen')) {
            met = 1.6;
            totalClo = 0.7;
        }

        return { met, totalClo };
    },

    // Indice PMV (Predicted Mean Vote) selon la norme ISO 7730
    calculatePMV(ta, tr, vel, rh, met, clo) {
        const fnps = (t) => Math.exp(16.6536 - 4030.18 / (t + 235));
        const pa = (rh / 100) * fnps(ta) * 10; // Pression de vapeur d'eau en kPa

        const icl = 0.155 * clo;
        const m = met * 58.15; // W/m²
        const w = 0; // Travail mécanique
        const mw = m - w;

        // Facteur de surface du vêtement (fcl)
        const fcl = icl <= 0.078 ? 1.0 + 1.29 * icl : 1.05 + 0.645 * icl;

        const hcf = 12.1 * Math.sqrt(vel);
        const tclInitial = ta + (35.5 - ta) / (3.5 * (icl + 0.1));

        let tcl = tclInitial;
        for (let i = 0; i < 10; i++) {
            const hc = Math.max(2.38 * Math.pow(Math.abs(tcl - ta), 0.25), hcf);
            tcl = (35.7 - 0.028 * mw + icl * (fcl * hc * ta + 3.96e-8 * fcl * (Math.pow(tr + 273, 4)))) /
                  (1 + icl * fcl * hc + 3.96e-8 * fcl * Math.pow(tr + 273, 3));
        }

        const hc = Math.max(2.38 * Math.pow(Math.abs(tcl - ta), 0.25), hcf);
        const radLoss = 3.96e-8 * fcl * (Math.pow(tcl + 273, 4) - Math.pow(tr + 273, 4));
        const convLoss = fcl * hc * (tcl - ta);
        const diffLoss = 3.05 * 0.001 * (5733 - 6.99 * mw - pa);
        const sweatLoss = mw > 58.15 ? 0.42 * (mw - 58.15) : 0;
        const latentRespir = 1.7e-5 * m * (5867 - pa);
        const dryRespir = 0.0014 * m * (34 - ta);

        const thermalLoad = mw - diffLoss - sweatLoss - latentRespir - dryRespir - radLoss - convLoss;
        const pmv = (0.303 * Math.exp(-0.036 * m) + 0.028) * thermalLoad;

        return parseFloat(Math.max(-3, Math.min(3, pmv)).toFixed(2));
    },

    // Simulation de l'impact des actions cochées
    evaluateSimulatedPMV(baseState, checkedActionKeys, envData) {
        let simTa = baseState.ta;
        let simTr = baseState.tr;
        let simVel = baseState.vel;
        let simRh = baseState.rh;

        if (checkedActionKeys.includes('shutter_close') || checkedActionKeys.includes('anticipate_sun')) {
            simTr -= 1.5;
            simTa -= 0.5;
        }
        if (checkedActionKeys.includes('free_cooling')) {
            simTa = Math.max(envData.t_ext, simTa - 1.2);
            simTr -= 1.0;
        }
        if (checkedActionKeys.includes('fan_on')) {
            simVel += 0.35;
        }
        if (checkedActionKeys.includes('vmc_boost') || checkedActionKeys.includes('open_win_humidity')) {
            simRh = Math.max(45, simRh - 12);
        }
        if (checkedActionKeys.includes('sun_heat')) {
            simTr += 1.2;
        }

        const pmvSim = this.calculatePMV(simTa, simTr, simVel, simRh, baseState.met, baseState.clo);
        return { pmv: pmvSim, simTa, simTr, simVel, simRh };
    },

    // Générateur de recommandations ciblées
    generateRecommendations(zone, zoneId, roomData, envData) {
        const recs = [];
        const zoneName = zone ? (zone.name || zoneId) : zoneId;
        const ta = roomData.ta || 20;
        const rh = roomData.rh || 50;

        const tr = this.calculateMeanRadiantTemp(zone, ta);
        const vel = this.calculateAirVelocity(zone, zoneName);
        const { met, totalClo } = this.getBaseCloAndMet(zone);

        const roomPmv = this.calculatePMV(ta, tr, vel, rh, met, totalClo);
        const needsHeat = roomPmv < -0.5;
        const needsCooling = roomPmv > 0.5;
        const isSunny = envData.sun_status.toLowerCase().includes('clear') || envData.sun_status.toLowerCase().includes('sun');

        // Humidité
        if (rh > 65) {
            if (zone?.equipment?.vmcSystem === 'acceleree') {
                recs.push({
                    id: `${zoneId}_vmc_boost`,
                    actionKey: 'vmc_boost',
                    zoneId, zoneName, timing: 'immediate', type: 'type-air',
                    title: 'Activer la VMC en mode accéléré',
                    text: `L'humidité atteint ${rh}%. Basculez la VMC en vitesse rapide pour renouveler l'air.`,
                    impactWeight: 15
                });
            } else if (zone?.windows?.some(w => w.vent && w.vent !== 'fixe')) {
                const win = zone.windows.find(w => w.vent && w.vent !== 'fixe');
                recs.push({
                    id: `${zoneId}_open_win_humidity`,
                    actionKey: 'open_win_humidity',
                    zoneId, zoneName, timing: 'immediate', type: 'type-air',
                    title: 'Aération flash ciblée',
                    text: `Ouvrez la fenêtre en position ${win.vent} pendant 5 minutes pour évacuer l'humidité.`,
                    impactWeight: 12
                });
            }
        }

        // Surchauffe
        if (needsCooling) {
            if (envData.t_ext < ta && zone?.windows?.some(w => w.vent !== 'fixe')) {
                recs.push({
                    id: `${zoneId}_free_cooling`,
                    actionKey: 'free_cooling',
                    zoneId, zoneName, timing: 'immediate', type: 'type-cool',
                    title: 'Ventilation traversante (Free-cooling)',
                    text: `Il fait plus frais dehors (${envData.t_ext}°C). Ouvrez pour décharger la chaleur accumulée.`,
                    impactWeight: 20
                });
            }

            if (isSunny && zone?.windows) {
                const hasShutter = zone.windows.some(w => w.shutter && w.shutter !== 'aucun');
                if (hasShutter) {
                    recs.push({
                        id: `${zoneId}_shutter_close`,
                        actionKey: 'shutter_close',
                        zoneId, zoneName, timing: 'immediate', type: 'type-sun',
                        title: 'Fermer les occultations extérieures',
                        text: `Baissez les volets ou stores pour bloquer le rayonnement solaire direct.`,
                        impactWeight: 25
                    });
                    recs.push({
                        id: `${zoneId}_anticipate_sun`,
                        actionKey: 'anticipate_sun',
                        zoneId, zoneName, timing: 'anticipated', type: 'type-sun',
                        title: 'Occultation préventive du matin',
                        text: `Anticipez la montée en température : fermez les volets dès 10h demain matin.`,
                        impactWeight: 15
                    });
                }
            }

            if (zone?.equipment?.fanSystem && zone.equipment.fanSystem !== 'aucun') {
                recs.push({
                    id: `${zoneId}_fan_on`,
                    actionKey: 'fan_on',
                    zoneId, zoneName, timing: 'immediate', type: 'type-eco',
                    title: `Activer le brassage d'air (${zone.equipment.fanSystem})`,
                    text: `Allumez le ventilateur. Le flux d'air augmente l'évaporation cutanée sans consommer de clim.`,
                    impactWeight: 18
                });
            }
        }

        // Froid
        if (needsHeat) {
            if (isSunny && envData.t_ext < ta) {
                recs.push({
                    id: `${zoneId}_sun_heat`,
                    actionKey: 'sun_heat',
                    zoneId, zoneName, timing: 'immediate', type: 'type-sun',
                    title: 'Ouvrir les protections solaires',
                    text: `Laissez pénétrer les rayons du soleil pour réchauffer naturellement les parois.`,
                    impactWeight: 20
                });
            }

            if (zone?.equipment?.heating?.system === 'floor') {
                recs.push({
                    id: `${zoneId}_floor_inertia`,
                    actionKey: 'floor_inertia',
                    zoneId, zoneName, timing: 'anticipated', type: 'type-heat',
                    title: 'Anticiper l\'inertie du plancher chauffant',
                    text: `Relancez la consigne 3 heures à l'avance pour laisser la dalle restituer sa chaleur.`,
                    impactWeight: 15
                });
            }
        }

        return recs;
    }
};

window.SolsticeStore = SolsticeStore;
window.SolsticeEngine = SolsticeEngine;