// ============================================================
// SOLSTICE - MOTEUR DE CALCUL THERMIQUE ET DASHBOARD (ISO 7730)
// ============================================================

let outdoorTemp = 15, outdoorHumidity = 50, outdoorPressure = 1013, outdoorWind = 0, sunshineStatus = 'Clouds';
let manualCloAdjustment = 0; 
const apiKey = '4ec1eb2b0cc90a4b18a79008b17581a8'; 
let GLOBAL_HOUSE_CONFIG = {};
let DONNEES_HABITAT = {}; 
let SELECTION_PIECES = []; 

const capteursMaison = {
    "Cuisine": "98e2d34a-769f-4296-93ed-6083772e703e",
    "Chambre parents": "051291b5-d2d0-43a8-b783-08b8509d2c84",
    "Chambre Orso": "c432fd4b-3836-4d98-94fd-3e6822aa96c5",
    "Garage": "762dd667-b30a-4bed-8bf6-2fc2a09fc29b",
    "Entrée": "598d83ea-cfcd-43f8-89f6-cfed3a4517d4",
    "Cave": "d8906d8b-68d2-4100-a074-03129a672ae1",
    "Chambre Ysée": "5ac8836a-c232-4225-a688-f161dcca60f6",
    "Extérieur - Jardin": "50ad97e0-a6e1-4b54-9b6a-dc306df7c068",
    "Salle de bain - Haut": "322388c4-c9b2-475d-9c68-3e13e501ce6a",
    "Extérieur - Rue": "c755bde8-9f8a-4ea4-ac2e-2fea154e9c09",
    "Salon": "20fee90c-95f2-47ea-b477-e3d8a6058440",
    "Salle de bain - Bas": "a70def7d-7071-4950-99d1-3a16e9759eee"
};

function getZoneConfigByName(roomName) { 
    return Object.values(GLOBAL_HOUSE_CONFIG).find(z => z.name === roomName); 
}

window.addEventListener('load', () => {
    const savedConfig = localStorage.getItem('HOUSE_CONFIG');
    if (savedConfig) { 
        GLOBAL_HOUSE_CONFIG = JSON.parse(savedConfig); 
    }

    const savedSelection = localStorage.getItem('SOLSTICE_SELECTION_PIECES');
    if (savedSelection) {
        SELECTION_PIECES = JSON.parse(savedSelection);
    } else {
        SELECTION_PIECES = ["Cuisine", "Salon", "Chambre parents"];
        localStorage.setItem('SOLSTICE_SELECTION_PIECES', JSON.stringify(SELECTION_PIECES));
    }

    genererSelecteurPieces();
    initialiserDashboard(); 
    restoreSessionData();

    const savedLoc = localStorage.getItem('location') || 'Reims';
    if (document.getElementById('location')) document.getElementById('location').value = savedLoc;
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

function onRoomSelectionChange(checkbox) {
    if (checkbox.checked) {
        if (!SELECTION_PIECES.includes(checkbox.value)) SELECTION_PIECES.push(checkbox.value);
    } else {
        SELECTION_PIECES = SELECTION_PIECES.filter(p => p !== checkbox.value);
    }
    localStorage.setItem('SOLSTICE_SELECTION_PIECES', JSON.stringify(SELECTION_PIECES));
    genererSelecteurPieces();
    initialiserDashboard();
    recalculerToutLeDashboard();
}

function toggleAllRooms(selectState) {
    SELECTION_PIECES = selectState ? Object.keys(capteursMaison) : [];
    localStorage.setItem('SOLSTICE_SELECTION_PIECES', JSON.stringify(SELECTION_PIECES));
    genererSelecteurPieces();
    initialiserDashboard();
    recalculerToutLeDashboard();
}

function initialiserDashboard() {
    const grid = document.getElementById('dashboard-grid');
    if (!grid) return; 
    grid.innerHTML = ''; 

    if (SELECTION_PIECES.length === 0) {
        grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--slate-600);">⚠️ Aucune pièce sélectionnée. Cochez au moins une pièce ci-dessus.</div>`;
        return;
    }

    for (const nomPiece of SELECTION_PIECES) {
        const idCapteur = capteursMaison[nomPiece];
        if (!idCapteur) continue;

        const tuile = document.createElement('article');
        tuile.className = 'room-tile';
        tuile.setAttribute('data-zone-id', idCapteur);

        const configActive = getZoneConfigByName(nomPiece);
        const badgeExpert = configActive 
            ? `<span class="badge badge-success">Modèle Actif</span>` 
            : `<span class="badge badge-warning">Par défaut</span>`;

        tuile.innerHTML = `
            <div class="tile-header">
                <div>
                    <h3>${nomPiece}</h3>
                    <div style="margin-top: 4px;">${badgeExpert}</div>
                </div>
                <span id="status-${idCapteur}" class="badge" style="background: var(--slate-100); color: var(--slate-600);">En attente</span>
            </div>

            <div class="tile-metrics-primary">
                <div class="metric">
                    <span class="metric-label">Température</span>
                    <span id="temp-${idCapteur}" class="metric-value">-- °C</span>
                </div>
                <div class="metric">
                    <span class="metric-label">Humidité Rel.</span>
                    <span id="hum-${idCapteur}" class="metric-value">-- %</span>
                </div>
            </div>

            <div id="pmv-box-${idCapteur}" style="text-align: center; margin-bottom: 14px; padding: 12px; background: var(--slate-50); border: 1px solid var(--border-color); border-radius: 8px;">
                <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">Indice PMV</div>
                <div id="pmv-${idCapteur}" style="font-size: 1.5rem; font-weight: 800; color: var(--slate-800);">--</div>
                <div id="pmv-text-${idCapteur}" style="font-size: 0.8rem; font-weight: 600; margin-top: 2px; color: var(--text-muted);">En attente de calcul...</div>
            </div>

            <div class="tile-metrics-secondary">
                <div class="sub-metric">
                    <span>Humidité Absolue :</span>
                    <strong id="ah-${idCapteur}">-- g/m³</strong>
                </div>
                <div class="sub-metric">
                    <span>Potentiel Séchage :</span>
                    <strong id="drying-${idCapteur}">--</strong>
                </div>
                <div class="sub-metric">
                    <span>Déperditions (Est.) :</span>
                    <strong id="energy-${idCapteur}">-- kWh/j</strong>
                </div>
                <div class="sub-metric">
                    <span>Inertie C<sub>eff</sub> :</span>
                    <strong id="storage-${idCapteur}">-- kWh/K</strong>
                </div>
            </div>

            <div class="tile-actions">
                <button class="btn-primary btn-block" onclick="voirRecommandations('${nomPiece}')">
                    🔍 Lancer le diagnostic
                </button>
            </div>
        `;
        grid.appendChild(tuile);
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
                const orientFactor = { 'S': 3.5, 'SE': 2.8, 'SW': 2.8, 'E': 1.8, 'W': 1.8, 'N': 0.4 }[win.orient] ?? 1.0;
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
        status = "Très Mauvais (Moisissures)";
        score = 1;
    } else if (dryingIndex < 0.8) {
        status = "Moyen (Séchage lent)";
        score = 2;
    } else if (dryingIndex < 1.3) {
        status = "Bon (Optimal)";
        score = 4;
    } else {
        status = "Excellent (Très rapide)";
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
    const area = parseFloat(zoneConfig?.area) || 15;
    const h = parseFloat(zoneConfig?.height) || 2.5;
    const volume = area * h;
    const side = Math.sqrt(area);
    const wallArea = side * h;

    const uWall = getUValueParoi('wall', zoneConfig?.wallMat || 'cinderblock', zoneConfig?.insulation || 'iti_recent');
    const uCeiling = getUValueParoi('ceiling', zoneConfig?.ceilingMat || 'concrete', zoneConfig?.ceilingInsulation || 'iti_recent');
    const uFloor = getUValueParoi('floor', zoneConfig?.floorMat || 'concrete', zoneConfig?.floorInsulation || 'low');

    const hSurfacique = (uWall * wallArea * 4) + (uCeiling * area) + (uFloor * area);
    const hVentilation = 0.34 * (volume * 0.5);
    const hTotal = hSurfacique + hVentilation;

    const deltaT = Math.max(0, ta - outdoorTemp);
    const deperditionskWh = (hTotal * deltaT * 24) / 1000;

    let gainsSolaireskWh = 0;
    const isSunny = sunshineStatus.toLowerCase().includes('clear') || sunshineStatus.toLowerCase().includes('sun');

    if (Array.isArray(zoneConfig?.windows)) {
        zoneConfig.windows.forEach(win => {
            const wArea = parseFloat(win.area) || 0;
            if (wArea <= 0) return;

            const gFactor = { 'single': 0.85, 'double_old': 0.75, 'double_recent': 0.60, 'triple': 0.45 }[win.glass] ?? 0.60;
            const maskFactor = { 'none': 1.0, 'partial': 0.5, 'heavy': 0.1 }[win.mask] ?? 1.0;
            const shutterFactor = { 'aucun': 1.0, 'store_interieur': 0.7, 'roulant_pvc': 0.2 }[win.shutter] ?? 1.0;

            let iSolar = { 'S': 3.2, 'SE': 2.5, 'SW': 2.5, 'E': 1.8, 'W': 1.8, 'N': 0.6 }[win.orient] ?? 1.5;
            if (!isSunny) iSolar *= 0.3; 

            gainsSolaireskWh += (wArea * gFactor * maskFactor * shutterFactor * iSolar);
        });
    }

    const bilanNetkWh = gainsSolaireskWh - deperditionskWh;

    return {
        hTotalWPerK: parseFloat(hTotal.toFixed(1)),
        deperditionskWh: parseFloat(deperditionskWh.toFixed(2)),
        gainsSolaireskWh: parseFloat(gainsSolaireskWh.toFixed(2)),
        bilanNetkWh: parseFloat(bilanNetkWh.toFixed(2))
    };
}

// ============================================================
// CALCUL DE LA CAPACITÉ ET CHARGE EN ÉNERGIE (STOCKAGE THERMIQUE)
// ============================================================
const PROPRIETES_MATERIAUX = {
    'concrete':    { rho: 2300, cp: 1.0 },
    'cinderblock': { rho: 1300, cp: 1.0 },
    'brick':       { rho: 1800, cp: 0.9 },
    'stone':       { rho: 2400, cp: 0.8 },
    'wood':        { rho: 500,  cp: 1.6 },
    'lourd':       { rho: 2200, cp: 1.0 },
    'leger':       { rho: 400,  cp: 1.4 }
};

function calculateZoneThermalStorage(zoneConfig, currentTa) {
    if (!zoneConfig) return { cEffkWhPerK: 0, maxStorageCapacitykWh: 0 };

    const area = parseFloat(zoneConfig.area) || 16;
    const h = parseFloat(zoneConfig.height) || 2.5;
    const side = Math.sqrt(area);
    const wallArea = side * h;
    const dEff = 0.08; 

    let cEffKJPerK = 0; 

    const floorMat = PROPRIETES_MATERIAUX[zoneConfig.floorMat] || PROPRIETES_MATERIAUX['lourd'];
    if (zoneConfig.floorInsulation !== 'iti_recent' && zoneConfig.floorInsulation !== 'iti_old') {
        cEffKJPerK += (area * dEff) * floorMat.rho * floorMat.cp;
    }

    const ceilingMat = PROPRIETES_MATERIAUX[zoneConfig.ceilingMat] || PROPRIETES_MATERIAUX['leger'];
    if (zoneConfig.ceilingInsulation !== 'iti_recent' && zoneConfig.ceilingInsulation !== 'iti_old') {
        cEffKJPerK += (area * dEff) * ceilingMat.rho * ceilingMat.cp;
    }

    const wallMat = PROPRIETES_MATERIAUX[zoneConfig.wallMat] || PROPRIETES_MATERIAUX['cinderblock'];
    const isITI = zoneConfig.insulation === 'iti_recent' || zoneConfig.insulation === 'iti_old';

    if (!isITI) {
        cEffKJPerK += (wallArea * 4 * dEff) * wallMat.rho * wallMat.cp;
    }

    const cEffkWhPerK = cEffKJPerK / 3600;
    const deltaTPrecharge = 2.0;
    const maxStorageCapacitykWh = cEffkWhPerK * deltaTPrecharge;

    return {
        cEffkWhPerK: parseFloat(cEffkWhPerK.toFixed(2)),
        maxStorageCapacitykWh: parseFloat(maxStorageCapacitykWh.toFixed(2))
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

        totalVolume += volume;
        weightedTemp += data.ta * volume;
        weightedRH += data.rh * volume;
        weightedAH += ah * volume;
        weightedPMV += pmv * volume;

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
        totalDeperditionskWh: parseFloat(totalDeperditions.toFixed(2)),
        totalGainsSolaireskWh: parseFloat(totalGainsSolaires.toFixed(2)),
        totalBilanNetkWh: parseFloat(totalBilanNet.toFixed(2)),
        totalVolumeM3: parseFloat(totalVolume.toFixed(1))
    };
}

/**
 * RENDU D'UNE TUILE INDIVIDUELLE
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
    const storage = calculateZoneThermalStorage(zoneConfig, data.ta);

    let pmv = calculatePMV(data.ta, tr, vel, data.rh, met, totalClo);

    const ahEl = document.getElementById('ah-' + idCapteur);
    const dryingEl = document.getElementById('drying-' + idCapteur);
    const energyEl = document.getElementById('energy-' + idCapteur);
    const storageEl = document.getElementById('storage-' + idCapteur);

    if (ahEl) ahEl.textContent = ah.toFixed(1) + " g/m³";
    if (dryingEl) {
        dryingEl.textContent = drying.status;
        dryingEl.style.color = drying.score >= 4 ? "var(--status-success, #10B981)" : 
                               (drying.score === 2 ? "var(--status-warning, #F59E0B)" : "var(--status-danger, #EF4444)");
    }
    if (energyEl) energyEl.textContent = energyBalance.deperditionskWh.toFixed(1) + " kWh/j";
    if (storageEl) storageEl.textContent = storage.cEffkWhPerK.toFixed(2) + " kWh/K";

    const pmvBox = document.getElementById('pmv-box-' + idCapteur);
    const pmvVal = document.getElementById('pmv-' + idCapteur);
    const pmvText = document.getElementById('pmv-text-' + idCapteur);

    if (pmvVal) pmvVal.textContent = (pmv > 0 ? "+" : "") + pmv.toFixed(2);

    if (pmvBox && pmvVal && pmvText) {
        if (pmv < -0.75) { 
            pmvBox.style.backgroundColor = "#E0F2FE"; pmvBox.style.borderColor = "#BAE6FD";
            pmvVal.style.color = "#0369A1"; pmvText.textContent = "Sensation Froide 🥶";
        } else if (pmv < -0.2) {
            pmvBox.style.backgroundColor = "#F0F9FF"; pmvBox.style.borderColor = "#E0F2FE";
            pmvVal.style.color = "#0284C7"; pmvText.textContent = "Légèrement Frais 🌬️";
        } else if (pmv > 0.75) { 
            pmvBox.style.backgroundColor = "#FEE2E2"; pmvBox.style.borderColor = "#FCA5A5";
            pmvVal.style.color = "#B91C1C"; pmvText.textContent = "Sensation Chaude 🥵";
        } else if (pmv > 0.2) {
            pmvBox.style.backgroundColor = "#FEF3C7"; pmvBox.style.borderColor = "#FDE68A";
            pmvVal.style.color = "#B45309"; pmvText.textContent = "Légèrement Chaud ☀️";
        } else { 
            pmvBox.style.backgroundColor = "#D1FAE5"; pmvBox.style.borderColor = "#A7F3D0";
            pmvVal.style.color = "#047857"; pmvText.textContent = "Zone Neutre (Confort) ✅";
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
        if (document.getElementById('global-ceff')) document.getElementById('global-ceff').textContent = "-- kWh/K";
        if (document.getElementById('global-storage')) document.getElementById('global-storage').textContent = "-- kWh";
        return;
    }

    let totalCEff = 0;
    let totalMaxStorage = 0;
    for (const [nomPiece, data] of Object.entries(DONNEES_HABITAT)) {
        if (!data || isNaN(data.ta)) continue;
        const zoneConfig = getZoneConfigByName(nomPiece) || { area: 15, height: 2.5 };
        const storage = calculateZoneThermalStorage(zoneConfig, data.ta);
        totalCEff += storage.cEffkWhPerK;
        totalMaxStorage += storage.maxStorageCapacitykWh;
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

    if (document.getElementById('global-ceff')) document.getElementById('global-ceff').textContent = `${totalCEff.toFixed(2)} kWh/K`;
    if (document.getElementById('global-storage')) document.getElementById('global-storage').textContent = `${totalMaxStorage.toFixed(2)} kWh`;
}

function recalculerToutLeDashboard() { 
    for (const nomPiece of SELECTION_PIECES) { 
        mettreAJourTuile(nomPiece); 
    } 
    actualiserCockpitGlobal();
}

function adjustClothing(amount) { 
    manualCloAdjustment += amount; 
    localStorage.setItem('manualCloAdjustment', manualCloAdjustment);
    updateClothingDisplay(); 
    recalculerToutLeDashboard(); 
}

function resetClothing() { 
    manualCloAdjustment = 0; 
    localStorage.setItem('manualCloAdjustment', 0);
    updateClothingDisplay(); 
    recalculerToutLeDashboard(); 
}

function updateClothingDisplay() { 
    const currentCloEl = document.getElementById('currentCloValue');
    if (currentCloEl) {
        currentCloEl.textContent = getBaseCloAndMet(null).totalClo.toFixed(2); 
    }
}

// ============================================================
// FLUX MÉTÉO ET RENDER STATUT
// ============================================================

document.getElementById('getWeatherButton')?.addEventListener('click', () => {
    const city = document.getElementById('location').value.trim();
    if (!city) return;
    fetchWeather(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric&lang=fr`);
});

document.getElementById('geoLocateButton')?.addEventListener('click', () => {
    if ("geolocation" in navigator) {
        const summaryEl = document.getElementById('weatherSummary');
        if (summaryEl) summaryEl.innerHTML = '<span class="muted-text">📍 Géolocalisation...</span>';
        navigator.geolocation.getCurrentPosition(
            (pos) => fetchWeather(`https://api.openweathermap.org/data/2.5/weather?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&appid=${apiKey}&units=metric&lang=fr`),
            () => updateWeatherUI(false, true, "Accès GPS refusé")
        );
    }
});

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
            sunshineStatus = data.weather[0].main; 
            
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
async function synchroniserTouteLaMaison() {
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
}

function voirRecommandations(nomPiece) {
    if (!DONNEES_HABITAT[nomPiece]) { 
        alert("Actualisez d'abord les capteurs !"); 
        return; 
    }

    const zoneKey = Object.keys(GLOBAL_HOUSE_CONFIG).find(key => GLOBAL_HOUSE_CONFIG[key].name === nomPiece) || nomPiece;
    const idCapteur = capteursMaison[nomPiece];
    const pmv = document.getElementById('pmv-' + idCapteur)?.textContent || "0";

    sessionStorage.setItem('currentZoneId', zoneKey); 
    sessionStorage.setItem('calculatedPMV', pmv);
    sessionStorage.setItem('indoorAirTemp', DONNEES_HABITAT[nomPiece].ta);
    sessionStorage.setItem('indoorHumidity', DONNEES_HABITAT[nomPiece].rh);
    sessionStorage.setItem('outdoorTemp', outdoorTemp);
    sessionStorage.setItem('sunshineStatus', sunshineStatus);

    window.location.href = `page2.html?zone=${encodeURIComponent(zoneKey)}`;
}
