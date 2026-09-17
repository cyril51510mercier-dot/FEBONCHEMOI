// ============================================================
// SOLSTICE - MOTEUR DE CALCUL THERMIQUE ET DASHBOARD
// ============================================================

let outdoorTemp = 15, outdoorHumidity = 50, outdoorPressure = 1013, outdoorWind = 0, sunshineStatus = 'Clouds';
let manualCloAdjustment = 0; 
const apiKey = '4ec1eb2b0cc90a4b18a79008b17581a8'; 
let GLOBAL_HOUSE_CONFIG = {};
let DONNEES_HABITAT = {}; 

// Dictionnaire dynamique généré à partir de HOUSE_CONFIG (localStorage)
let capteursMaison = {};

/**
 * Reconstruit la cartographie Nom de Pièce -> ID Capteur depuis le paramétrage expert
 */
function rafraichirCapteursDepuisConfig() {
    capteursMaison = {};
    Object.values(GLOBAL_HOUSE_CONFIG).forEach(zone => {
        if (zone.name && zone.sensorId) {
            capteursMaison[zone.name] = zone.sensorId;
        }
    });
}

function getZoneConfigByName(roomName) { 
    return Object.values(GLOBAL_HOUSE_CONFIG).find(z => z.name === roomName); 
}

window.addEventListener('load', () => {
    const savedConfig = localStorage.getItem('HOUSE_CONFIG');
    if (savedConfig) { 
        GLOBAL_HOUSE_CONFIG = JSON.parse(savedConfig); 
        // Synchronisation dynamique de capteursMaison avec la configuration expert
        for (const key in GLOBAL_HOUSE_CONFIG) {
            const z = GLOBAL_HOUSE_CONFIG[key];
            if (z.name && z.sensorId) {
                capteursMaison[z.name] = z.sensorId;
            }
        }
    }

    const savedSelection = localStorage.getItem('SOLSTICE_SELECTION_PIECES');
    if (savedSelection) {
        SELECTION_PIECES = JSON.parse(savedSelection);
    } else {
        SELECTION_PIECES = Object.keys(capteursMaison).slice(0, 3);
        localStorage.setItem('SOLSTICE_SELECTION_PIECES', JSON.stringify(SELECTION_PIECES));
    }

    genererSelecteurPieces();
    initialiserDashboard(); 
    restoreSessionData();

    const savedLoc = localStorage.getItem('location') || 'Reims';
    const locEl = document.getElementById('location');
    if (locEl) locEl.value = savedLoc;

    fetchWeather(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(savedLoc)}&appid=${apiKey}&units=metric&lang=fr`);

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
                    statusEl.style.color = "var(--status-success, #10B981)";
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
            background: ${isChecked ? '#FDF4F0' : 'white'}; 
            padding: 5px 10px; 
            border-radius: 6px; 
            border: 1px solid ${isChecked ? '#D96B43' : '#CBD5E1'};
            font-size: 0.85em;
            color: #1E293B;
        `;
        label.innerHTML = `
            <input type="checkbox" value="${nomPiece}" ${isChecked ? 'checked' : ''} onchange="onRoomSelectionChange(this)">
            <span>${nomPiece}</span>
        `;
        container.appendChild(label);
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

function initialiserDashboard() {
    const tbody = document.getElementById('dashboard-table-body');
    if (!tbody) return; 
    tbody.innerHTML = ''; 

    if (SELECTION_PIECES.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 30px; color: var(--slate-600);">⚠️ Aucune pièce sélectionnée. Cochez au moins une pièce ci-dessus.</td></tr>`;
        return;
    }

    for (const nomPiece of SELECTION_PIECES) {
        const idCapteur = capteursMaison[nomPiece];
        if (!idCapteur) continue;

        const configActive = getZoneConfigByName(nomPiece);
        const badgeExpert = configActive 
            ? `<span class="badge badge-success" style="font-size: 0.7rem; padding: 2px 6px;">BEM Actif</span>` 
            : `<span class="badge badge-warning" style="font-size: 0.7rem; padding: 2px 6px;">Par défaut</span>`;

        const row = document.createElement('tr');
        row.style.borderBottom = "1px solid var(--border-color, #E2E8F0)";
        row.setAttribute('data-zone-id', idCapteur);

        const safeName = nomPiece.replace(/'/g, "\\'");

        row.innerHTML = `
            <td style="padding: 12px 14px; font-weight: 600; color: var(--slate-900);">
                <div>${nomPiece}</div>
                <div style="margin-top: 2px;">${badgeExpert}</div>
            </td>
            <td style="padding: 12px 10px; text-align: center;">
                <span id="status-${idCapteur}" class="badge" style="background: var(--slate-100); color: var(--slate-600); font-size: 0.75rem;">En attente</span>
            </td>
            <td id="temp-${idCapteur}" style="padding: 12px 10px; text-align: right; font-weight: 700; font-size: 1rem;">-- °C</td>
            <td id="hum-${idCapteur}" style="padding: 12px 10px; text-align: right; font-weight: 600;">-- %</td>
            <td id="ah-${idCapteur}" style="padding: 12px 10px; text-align: right; color: #0284C7;">-- g/m³</td>
            <td style="padding: 12px 10px; text-align: center;">
                <span id="pmv-badge-${idCapteur}" class="badge" style="font-size: 0.85rem; font-weight: 800; padding: 4px 8px;">--</span>
            </td>
            <td id="energy-${idCapteur}" style="padding: 12px 10px; text-align: right; color: #DC2626; font-weight: 600;">-- kWh/j</td>
            <td id="tstruct-${idCapteur}" style="padding: 12px 10px; text-align: right; color: #D97706; font-weight: 600;">-- °C</td>
            <td id="drying-${idCapteur}" style="padding: 12px 10px; text-align: center; font-weight: 500;">--</td>
            <td style="padding: 12px 14px; text-align: center;">
                <button class="btn-primary" style="padding: 5px 10px; font-size: 0.8rem;" onclick="voirRecommandations('${safeName}')">🔍 Diag</button>
            </td>
        `;
        tbody.appendChild(row);
    }
}

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

function getBaseCloAndMet(zoneConfig) {
    let met = 1.2; 
    let baseClo = 1.0; 

    if (outdoorTemp >= 26) baseClo = 0.4;
    else if (outdoorTemp >= 20) baseClo = 0.6;
    else if (outdoorTemp >= 15) baseClo = 0.85;
    else if (outdoorTemp < 5) baseClo = 1.25;

    if (zoneConfig && Array.isArray(zoneConfig.usages)) {
        if (zoneConfig.usages.includes('kitchen')) met = 1.6;
        else if (zoneConfig.usages.includes('office')) met = 1.1;
        else if (zoneConfig.usages.includes('bathroom')) met = 1.3;
        else if (zoneConfig.usages.includes('bedroom')) {
            met = 0.9;
            const currentMonth = new Date().getMonth();
            if ([11, 0, 1].includes(currentMonth)) baseClo = 2.0;
            else if ([5, 6, 7].includes(currentMonth)) baseClo = 0.5;
            else baseClo = 1.2;
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
                'single': { U: 5.7, g: 0.85 }, 'double_old': { U: 2.8, g: 0.75 },
                'double_recent': { U: 1.2, g: 0.60 }, 'triple': { U: 0.7, g: 0.45 }
            };

            const spec = glassProps[win.glass] || glassProps['double_recent'];
            let tWin = getSurfaceTemp('outside', spec.U);
            const maskFactor = { 'none': 1.0, 'partial': 0.5, 'heavy': 0.1 }[win.mask] ?? 1.0;
            const shutterFactor = {
                'aucun': 1.0, 'store_banne': 0.25, 'store_interieur': 0.75, 'rideau_interieur': 0.80,
                'roulant_pvc': 0.10, 'roulant_metal': 0.15, 'battant_bois': 0.10, 'persienne': 0.30
            }[win.shutter] ?? 1.0;

            if (isSunny && maskFactor > 0.1) {
                // Calcul pondéré des orientations de vitrages
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

function isOutdoorZone(nomPiece, zoneConfig) {
    if (nomPiece && (nomPiece.toLowerCase().includes('extér') || nomPiece.toLowerCase().includes('exter'))) {
        return true;
    }
    if (zoneConfig && Array.isArray(zoneConfig.usages) && zoneConfig.usages.includes('outdoor')) {
        return true;
    }
    return false;
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
        const hasPermeableWindow = zoneConfig.windows.some(w => w.glass === 'single' || w.vent === 'oscillante');
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
    const pSat = 611.2 * Math.exp((17.67 * ta) / (ta + 243.5)); 
    const vpd = (pSat * (1 - rh / 100)) / 1000; 

    const dryingIndex = vpd * (1 + 0.5 * vel);

    let status = "Très Mauvais";
    let score = 1;

    if (dryingIndex < 0.4) {
        status = "Très Mauvais";
        score = 1;
    } else if (dryingIndex < 0.8) {
        status = "Moyen";
        score = 2;
    } else if (dryingIndex < 1.3) {
        status = "Bon";
        score = 4;
    } else {
        status = "Excellent";
        score = 5;
    }

    return {
        vpdkPa: parseFloat(vpd.toFixed(3)),
        dryingIndex: parseFloat(dryingIndex.toFixed(3)),
        status: status,
        score: score
    };
}

function calculateDailyThermalBalance(zoneConfig, ta) {
    if (!zoneConfig) return { hTotalWPerK: 0, deperditionskWh: 0, gainsConductionkWh: 0, gainsSolaireskWh: 0, gainsTotauxkWh: 0, bilanNetkWh: 0 };

    // 1. Zone Extérieure : aucun bilan thermique intérieur
    if (Array.isArray(zoneConfig.usages) && zoneConfig.usages.includes('outdoor')) {
        return { hTotalWPerK: 0, deperditionskWh: 0, gainsConductionkWh: 0, gainsSolaireskWh: 0, gainsTotauxkWh: 0, bilanNetkWh: 0 };
    }

    const area = parseFloat(zoneConfig.area) || 15;
    const h = parseFloat(zoneConfig.height) || 2.5;
    const volume = area * h;
    const side = Math.sqrt(area);
    const wallArea = side * h;

    // 2. Coefficients U des parois (W/m².K)
    const uWall = getUValueParoi('wall', zoneConfig.wallMat || 'cinderblock', zoneConfig.insulation || 'iti_recent');
    const uCeiling = getUValueParoi('ceiling', zoneConfig.ceilingMat || 'leger', zoneConfig.ceilingInsulation || 'iti_recent');
    const uFloor = getUValueParoi('floor', zoneConfig.floorMat || 'lourd', zoneConfig.floorInsulation || 'iti_recent');

    // Helper pour le facteur de réduction de température b
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

    // 3. Déperditions / Gains par renouvellement d'air (W/K)
    let ach = 0.5;
    const vmc = zoneConfig.equipment?.vmcSystem;
    if (vmc === 'marche_forcee') ach = 1.0;
    else if (vmc === 'continue_non_pilotable') ach = 0.7;
    else if (vmc === 'trappe') ach = 0.5;
    else if (vmc === 'none') ach = 0.25;

    const hVentilation = 0.34 * volume * ach;
    const hTotal = hSurfacique + hVentilation;

    // 4. Calcul des flux thermiques selon le sens du gradient de température
    let deperditionskWh = 0;
    let gainsConductionkWh = 0;

    if (ta > outdoorTemp) {
        // Pertes de chaleur de l'intérieur vers l'extérieur
        const deltaT_dep = ta - outdoorTemp;
        deperditionskWh = (hTotal * deltaT_dep * 24) / 1000;
    } else {
        // Apports thermiques de l'extérieur vers l'intérieur (Text > Ta)
        const deltaT_gain = outdoorTemp - ta;
        gainsConductionkWh = (hTotal * deltaT_gain * 24) / 1000;
    }

    // 5. Apports solaires quotidiens (kWh/j)
    let gainsSolaireskWh = 0;
    const isSunny = sunshineStatus.toLowerCase().includes('clear') || sunshineStatus.toLowerCase().includes('sun');

    if (Array.isArray(zoneConfig.windows)) {
        const glassMap = { 'single': 0.85, 'double_old': 0.75, 'double_recent': 0.60, 'triple': 0.45 };
        const maskMap = { 'none': 1.0, 'partial': 0.5, 'heavy': 0.1 };
        const shutterMap = {
            'aucun': 1.0,
            'store_interieur': 0.7,
            'rideau_interieur': 0.8,
            'store_banne': 0.3,
            'persienne': 0.3,
            'roulant_pvc': 0.15,
            'roulant_metal': 0.2,
            'battant_bois': 0.15
        };
        const orientMap = { 'S': 3.2, 'SE': 2.5, 'SW': 2.5, 'E': 1.8, 'W': 1.8, 'N': 0.6 };

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

            if (!isSunny) iSolar *= 0.3;

            gainsSolaireskWh += (wArea * gFactor * maskFactor * shutterFactor * iSolar);
        });
    }

    // Gains totaux = apports solaires + apports par conduction/ventilation quand Text > Ta
    const gainsTotauxkWh = gainsSolaireskWh + gainsConductionkWh;
    const bilanNetkWh = gainsTotauxkWh - deperditionskWh;

    return {
        hTotalWPerK: parseFloat(hTotal.toFixed(1)),
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

    let totalDeperditions = 0;
    let totalGainsSolaires = 0;
    let totalBilanNet = 0;

    for (const [nomPiece, data] of Object.entries(DONNEES_HABITAT)) {
        if (!data || isNaN(data.ta) || isNaN(data.rh)) continue;

        const zoneConfig = getZoneConfigByName(nomPiece) || { area: 15, height: 2.5 };
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

        totalDeperditions += energy.deperditionskWh;
        totalGainsSolaires += energy.gainsSolaireskWh;
        totalBilanNet += energy.bilanNetkWh;
    }

    if (totalVolume === 0) return null;

    return {
        avgTemp: parseFloat((weightedTemp / totalVolume).toFixed(1)),
        avgRH: parseFloat((weightedRH / totalVolume).toFixed(0)),
        avgAH: parseFloat((weightedAH / totalVolume).toFixed(2)),
        avgPMV: parseFloat((weightedPMV / totalVolume).toFixed(2)),
        avgTStruct: parseFloat((weightedTStruct / totalVolume).toFixed(1)),
        avgChargePct: Math.round(weightedChargePct / totalVolume),
        totalDeperditionskWh: parseFloat(totalDeperditions.toFixed(2)),
        totalGainsSolaireskWh: parseFloat(totalGainsSolaires.toFixed(2)),
        totalBilanNetkWh: parseFloat(totalBilanNet.toFixed(2)),
        totalVolumeM3: parseFloat(totalVolume.toFixed(1))
    };
}

/**
 * RENDU D'UNE LIGNE DE TABLEAU
 */
function mettreAJourTuile(nomPiece) {
    if (!SELECTION_PIECES.includes(nomPiece)) return;

    const data = DONNEES_HABITAT[nomPiece];
    const idCapteur = capteursMaison[nomPiece];
    if (!data || !idCapteur) return;

    const tempEl = document.getElementById('temp-' + idCapteur);
    const humEl = document.getElementById('hum-' + idCapteur);

    if (tempEl) tempEl.textContent = data.ta.toFixed(1) + " °C";
    if (humEl) humEl.textContent = data.rh.toFixed(0) + " %";

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

    const vel = calculateAirVelocity(zoneConfig, nomPiece);
    const tr = calculateMeanRadiantTemp(zoneConfig, data.ta);
    const { met, totalClo } = getBaseCloAndMet(zoneConfig);

    const ah = calculateAbsoluteHumidity(data.ta, data.rh);
    const drying = calculateDryingPotential(data.ta, data.rh, vel);
    const energyBalance = calculateDailyThermalBalance(zoneConfig, data.ta);

    const tStruct = updateStructureTemperature(nomPiece, data.ta);
    const reserve = calculateStructureReserve(tStruct, data.ta);

    let pmv = calculatePMV(data.ta, tr, vel, data.rh, met, totalClo);

    const ahEl = document.getElementById('ah-' + idCapteur);
    const dryingEl = document.getElementById('drying-' + idCapteur);
    const energyEl = document.getElementById('energy-' + idCapteur);
    const tStructEl = document.getElementById('tstruct-' + idCapteur);

    if (ahEl) ahEl.textContent = ah.toFixed(1) + " g/m³";
    if (dryingEl) {
        dryingEl.textContent = drying.status;
        dryingEl.style.color = drying.score >= 4 ? "#10B981" : (drying.score === 2 ? "#F59E0B" : "#EF4444");
    }
    if (energyEl) energyEl.textContent = energyBalance.deperditionskWh.toFixed(1) + " kWh/j";
    if (tStructEl) tStructEl.textContent = tStruct.toFixed(1) + " °C";

    const pmvBadge = document.getElementById('pmv-badge-' + idCapteur);
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

/**
 * ACTUALISATION DU COCKPIT GLOBAL MAISON
 */
function actualiserCockpitGlobal() {
    const metrics = calculateGlobalHabitatMetrics();

    if (!metrics) {
        if (document.getElementById('global-avg-temp')) document.getElementById('global-avg-temp').textContent = "-- °C";
        if (document.getElementById('global-avg-rh')) document.getElementById('global-avg-rh').textContent = "-- %";
        if (document.getElementById('global-avg-ah')) document.getElementById('global-avg-ah').textContent = "-- g/m³";
        if (document.getElementById('global-pmv-val')) document.getElementById('global-pmv-val').textContent = "--";
        if (document.getElementById('global-dep')) document.getElementById('global-dep').textContent = "-- kWh/j";
        if (document.getElementById('global-gains')) document.getElementById('global-gains').textContent = "-- kWh/j";
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
            pmvStatusEl.className = "badge badge-success";
        } else if (metrics.avgPMV < -0.5) {
            pmvStatusEl.textContent = "Frais Global";
            pmvStatusEl.className = "badge badge-warning";
        } else {
            pmvStatusEl.textContent = "Chaud Global";
            pmvStatusEl.className = "badge badge-danger";
        }
    }

    if (document.getElementById('global-dep')) document.getElementById('global-dep').textContent = `${metrics.totalDeperditionskWh} kWh/j`;
    if (document.getElementById('global-gains')) document.getElementById('global-gains').textContent = `${metrics.totalGainsSolaireskWh} kWh/j`;
    
    const netEl = document.getElementById('global-net');
    if (netEl) {
        netEl.textContent = `${metrics.totalBilanNetkWh > 0 ? '+' : ''}${metrics.totalBilanNetkWh} kWh/j`;
        netEl.style.color = metrics.totalBilanNetkWh >= 0 ? "#4ADE80" : "#F87171";
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
    if (currentCloEl) {
        currentCloEl.textContent = getBaseCloAndMet(null).totalClo.toFixed(2); 
    }
}

// ============================================================
// FLUX MÉTÉO ET RENDER STATUT
// ============================================================

window.rechercherMeteo = function() {
    const city = document.getElementById('location')?.value.trim();
    if (!city) return;
    fetchWeather(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=fr`);
};

window.geolocaliserMeteo = function() {
    if ("geolocation" in navigator) {
        const summaryEl = document.getElementById('weatherSummary');
        if (summaryEl) summaryEl.innerHTML = '<span class="muted-text">📍 Géolocalisation...</span>';
        navigator.geolocation.getCurrentPosition(
            (pos) => fetchWeather(`https://api.openweathermap.org/data/2.5/weather?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&appid=${apiKey}&units=metric&lang=fr`),
            () => updateWeatherUI(false, true, "Accès GPS refusé")
        );
    }
};

function fetchWeather(url) {
    const summaryEl = document.getElementById('weatherSummary');
    if (summaryEl) summaryEl.innerHTML = '<span class="muted-text">⏳ Chargement de la météo...</span>';

    fetch(url)
        .then(res => {
            if (!res.ok) throw new Error("Ville introuvable");
            return res.json();
        })
        .then(data => {
            outdoorTemp = data.main.temp; 
            outdoorHumidity = data.main.humidity;
            outdoorWind = (data.wind.speed * 3.6); 
            sunshineStatus = data.weather[0]?.main || 'Clouds'; 
            
            const locInput = document.getElementById('location');
            if (locInput) locInput.value = data.name;

            localStorage.setItem('location', data.name);
            localStorage.setItem('outdoorTemp', outdoorTemp);
            localStorage.setItem('outdoorHumidity', outdoorHumidity);
            localStorage.setItem('outdoorWind', outdoorWind);
            localStorage.setItem('sunshineStatus', sunshineStatus);

            updateWeatherUI();
            updateClothingDisplay(); 
            recalculerToutLeDashboard(); 
        })
        .catch(err => {
            console.error("Erreur météo:", err);
            updateWeatherUI(false, true, err.message);
        });
}

function updateWeatherUI(loading = false, error = false, errorMsg = "") {
    const summaryEl = document.getElementById('weatherSummary');
    if (!summaryEl) return;

    if (loading) {
        summaryEl.innerHTML = '<span class="muted-text">⏳ Chargement météo...</span>';
        return;
    }
    if (error) {
        summaryEl.innerHTML = `<span style="color: var(--status-danger, #EF4444); font-weight: bold;">❌ ${errorMsg || "Météo indisponible"}</span>`;
        return;
    }

    summaryEl.innerHTML = `
        <span style="color: var(--slate-800, #1E293B); font-weight: 600;">
            🌡️ ${outdoorTemp.toFixed(1)} °C &nbsp;|&nbsp; 💧 ${outdoorHumidity}% HR &nbsp;|&nbsp; 💨 ${outdoorWind.toFixed(0)} km/h (${sunshineStatus})
        </span>
    `;
}

/**
 * SUPER SCAN MAKE.COM
 */
window.synchroniserTouteLaMaison = async function() {
    if (SELECTION_PIECES.length === 0) {
        alert("⚠️ Sélectionnez au moins une pièce à scanner !");
        return;
    }

    const btn = document.getElementById('btn-sync-all');
    if (btn) {
        btn.innerHTML = "⏳ Scan Global en cours...";
        btn.style.backgroundColor = "var(--slate-600, #475569)";
    }

    try {
        const response = await fetch('https://hook.eu1.make.com/0jz9xnz6phk3nmn5pdwkijlylowdxosd');
        if (!response.ok) throw new Error("Erreur Serveur Make");
        
        const dataPack = await response.json();
        for (const capteur of dataPack) {
            const idCapteur = capteur.id;
            const nomPiece = Object.keys(capteursMaison).find(key => capteursMaison[key] === idCapteur);
            
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
                        statusEl.style.color = "var(--status-success, #10B981)";
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
        btn.style.backgroundColor = "var(--terracotta-500, #D96B43)";
    }
};

window.voirRecommandations = function(nomPiece) {
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
// EXTENSION RECOMMANDATIONS & SIMULATION (À intégrer dans engine.js)
// ============================================================

// 1. Ajoute cette méthode dans SolsticeEngine pour calculer le PMV simulé
SolsticeEngine.evaluateSimulatedPMV = function(baseState, checkedActionKeys, envData) {
    let simTa = baseState.ta;
    let simTr = baseState.tr;
    let simVel = baseState.vel;
    let simRh = baseState.rh;

    // Modificateurs d'état physique dosés
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

    // Recalcul ISO 7730 via ta fonction calculatePMV existante
    const pmvSim = this.calculatePMV(simTa, simTr, simVel, simRh, baseState.met, baseState.clo);
    return { pmv: pmvSim, simTa, simTr, simVel, simRh };
};

// 2. Ajoute cette méthode dans SolsticeEngine pour générer les conseils
SolsticeEngine.generateRecommendations = function(zone, zoneId, roomData, envData) {
    const recs = [];
    const zoneName = zone ? (zone.name || zoneId) : zoneId;
    const ta = roomData.ta || 20;
    const rh = roomData.rh || 50;

    // Réutilisation de tes fonctions thermiques existantes
    const tr = this.calculateMeanRadiantTemp(zone, ta);
    const vel = this.calculateAirVelocity(zone, zoneName);
    const { met, totalClo } = this.getBaseCloAndMet(zone);

    const roomPmv = this.calculatePMV(ta, tr, vel, rh, met, totalClo);
    const needsHeat = roomPmv < -0.4;
    const needsCooling = roomPmv > 0.4;
    const isSunny = envData.sun_status.toLowerCase().includes('clear') || envData.sun_status.toLowerCase().includes('sun');

    const hasWindows = !zone || !zone.windows || zone.windows.length === 0 || zone.windows.some(w => w.vent !== 'fixe');
    const hasShutters = !zone || !zone.windows || zone.windows.some(w => !w.shutter || w.shutter !== 'aucun');

    // --- HUMIDITÉ ---
    if (rh > 65) {
        if (zone?.equipment?.vmcSystem === 'acceleree') {
            recs.push({
                id: `${zoneId}_vmc_boost`,
                actionKey: 'vmc_boost',
                zoneId, zoneName, timing: 'immediate', type: 'type-air',
                title: 'Activer la VMC en mode accéléré',
                text: `L'humidité atteint ${rh} %. Basculez la VMC en vitesse rapide.`,
                impactWeight: 15
            });
        } else if (hasWindows) {
            recs.push({
                id: `${zoneId}_open_win_humidity`,
                actionKey: 'open_win_humidity',
                zoneId, zoneName, timing: 'immediate', type: 'type-air',
                title: 'Aération flash ciblée',
                text: `Ouvrez la fenêtre pendant 5 minutes pour évacuer l'humidité.`,
                impactWeight: 12
            });
        }
    }

    // --- SURCHAUFFE ---
    if (needsCooling) {
        if (envData.t_ext < ta && hasWindows) {
            recs.push({
                id: `${zoneId}_free_cooling`,
                actionKey: 'free_cooling',
                zoneId, zoneName, timing: 'immediate', type: 'type-cool',
                title: 'Ventilation traversante (Free-cooling)',
                text: `Il fait plus frais dehors (${envData.t_ext} °C). Ouvrez pour décharger la chaleur accumulée.`,
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
            recs.push({
                id: `${zoneId}_anticipate_sun`,
                actionKey: 'anticipate_sun',
                zoneId, zoneName, timing: 'anticipated', type: 'type-sun',
                title: 'Occultation préventive du matin',
                text: `Anticipez la montée en température : fermez les volets dès 10h demain.`,
                impactWeight: 15
            });
        }

        if (zone?.equipment?.fanSystem && zone.equipment.fanSystem !== 'aucun') {
            recs.push({
                id: `${zoneId}_fan_on`,
                actionKey: 'fan_on',
                zoneId, zoneName, timing: 'immediate', type: 'type-eco',
                title: `Activer le brassage d'air (${zone.equipment.fanSystem})`,
                text: `Allumez le ventilateur. Le flux d'air augmente l'évaporation cutanée.`,
                impactWeight: 18
            });
        }
    }

    // --- FROID ---
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

    // --- ÉQUILIBRE ET ÉCO-GESTES ---
    if (recs.length === 0) {
        recs.push({
            id: `${zoneId}_maintain_vmc`,
            actionKey: 'vmc_boost',
            zoneId, zoneName, timing: 'anticipated', type: 'type-eco',
            title: 'Vérifier l\'extraction des bouches d\'air',
            text: `Le confort est stable. Assurez-vous que les grilles d'aération ne sont pas obstruées.`,
            impactWeight: 10
        });
        recs.push({
            id: `${zoneId}_night_vent`,
            actionKey: 'free_cooling',
            zoneId, zoneName, timing: 'anticipated', type: 'type-cool',
            title: 'Maintien du renouvellement d\'air nocturne',
            text: `Aérez 10 minutes avant le coucher pour maintenir l'équilibre thermo-hygrométrique.`,
            impactWeight: 10
        });
    }

    return recs;
};
