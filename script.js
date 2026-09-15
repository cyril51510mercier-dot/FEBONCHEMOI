// ============================================================
// SOLSTICE - MOTEUR DE CALCUL THERMIQUE ET DASHBOARD (ISO 7730)
// ============================================================

let outdoorTemp = 15, outdoorHumidity = 50, outdoorPressure = 1013, outdoorWind = 0, sunshineStatus = 'Clouds';
let manualCloAdjustment = 0; 
const apiKey = '4ec1eb2b0cc90a4b18a79008b17581a8'; 
let GLOBAL_HOUSE_CONFIG = {};
let DONNEES_HABITAT = {}; 

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
        initialiserDashboard(); 
    } else { 
        alert("Veuillez paramétrer l'habitat dans l'espace Expert."); 
        window.location.href = 'setup.html'; 
        return; 
    }
    
    restoreSessionData();

    const cachedHabitat = sessionStorage.getItem('SOLSTICE_DONNEES_HABITAT');
    if (cachedHabitat) {
        DONNEES_HABITAT = JSON.parse(cachedHabitat);
        recalculerToutLeDashboard();
        for (const [nomPiece, idCapteur] of Object.entries(capteursMaison)) {
            if (DONNEES_HABITAT[nomPiece]) {
                const statusEl = document.getElementById('status-' + idCapteur);
                if (statusEl) {
                    statusEl.textContent = "En mémoire";
                    statusEl.style.color = "var(--status-success, #10B981)";
                }
            }
        }
    }
});

/**
 * 1. RENDU DE LA GRILLE DU TABLEAU DE BORD (HTML + CSS Modernisé)
 */
function initialiserDashboard() {
    const grid = document.getElementById('dashboard-grid');
    if (!grid) return; 
    grid.innerHTML = ''; 

    for (const [nomPiece, idCapteur] of Object.entries(capteursMaison)) {
        const tuile = document.createElement('article');
        tuile.className = 'room-tile';
        tuile.setAttribute('data-zone-id', idCapteur);

        const configActive = getZoneConfigByName(nomPiece);
        const badgeExpert = configActive 
            ? `<span class="badge badge-success">Modèle Actif</span>` 
            : `<span class="badge badge-danger">Non paramétré</span>`;

        tuile.innerHTML = `
            <div class="tile-header">
                <div>
                    <h3>${nomPiece}</h3>
                    <div style="margin-top: 4px;">${badgeExpert}</div>
                </div>
                <span id="status-${idCapteur}" class="badge" style="background: var(--slate-100); color: var(--slate-600);">En attente</span>
            </div>

            <!-- Mesures Principales -->
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

            <!-- Pavé Synthèse Confort PMV -->
            <div id="pmv-box-${idCapteur}" style="text-align: center; margin-bottom: 14px; padding: 12px; background: var(--slate-50); border: 1px solid var(--border-color); border-radius: 8px;">
                <div style="font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted);">Indice PMV</div>
                <div id="pmv-${idCapteur}" style="font-size: 1.5rem; font-weight: 800; color: var(--slate-800);">--</div>
                <div id="pmv-text-${idCapteur}" style="font-size: 0.8rem; font-weight: 600; margin-top: 2px; color: var(--text-muted);">En attente de calcul...</div>
            </div>

            <!-- Données Moteur Physical BEM -->
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
    const loc = sessionStorage.getItem('location');
    if (loc && document.getElementById('location')) document.getElementById('location').value = loc;
    if (sessionStorage.getItem('outdoorTemp')) {
        outdoorTemp = parseFloat(sessionStorage.getItem('outdoorTemp'));
        outdoorHumidity = parseFloat(sessionStorage.getItem('outdoorHumidity'));
        sunshineStatus = sessionStorage.getItem('sunshineStatus');
    }
    if (sessionStorage.getItem('manualCloAdjustment')) manualCloAdjustment = parseFloat(sessionStorage.getItem('manualCloAdjustment'));
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
    const mapInsulationR = {
        'ite_recent': 3.8,
        'iti_recent': 3.2,
        'ite_old': 1.8,
        'iti_old': 1.4,
        'low': 0.6,
        'none': 0.0
    };

    const mapLambda = {
        'cinderblock': 1.3,
        'brick': 0.45,
        'concrete': 1.7,
        'stone': 2.3,
        'wood': 0.13,
        'leger': 0.15,
        'lourd': 1.8
    };

    const rIns = mapInsulationR[isolation] ?? 2.0;
    const lambda = mapLambda[materiau] ?? 1.0;
    const epaisseurMetre = 0.20;

    let rSurface = 0.17;
    if (typeParoi === 'ceiling') rSurface = 0.14;
    if (typeParoi === 'floor') rSurface = 0.21;

    const rBrut = epaisseurMetre / lambda;
    const rTotal = rSurface + rBrut + rIns;

    return 1 / rTotal;
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

// ============================================================
// MODÈLE SOLSTICE - TEMPÉRATURE RADIANTE MOYENNE (Tr)
// ============================================================

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

    const wallsAdj = [
        zone.adj?.wall1, 
        zone.adj?.wall2, 
        zone.adj?.wall3, 
        zone.adj?.wall4
    ];

    wallsAdj.forEach(adj => {
        const tSurf = getSurfaceTemp(adj, uWall);
        sumAreaTemp += (tSurf * wallArea);
        totalArea += wallArea;
    });

    const tCeiling = getSurfaceTemp(zone.adj?.ceiling, uCeiling);
    sumAreaTemp += (tCeiling * floorArea);

    const tFloor = getSurfaceTemp(zone.adj?.floor, uFloor);
    sumAreaTemp += (tFloor * floorArea);

    totalArea += (floorArea * 2);

    if (Array.isArray(zone.windows) && zone.windows.length > 0) {
        const isSunny = sunshineStatus.toLowerCase().includes('clear') || sunshineStatus.toLowerCase().includes('sun');

        zone.windows.forEach(win => {
            const wArea = parseFloat(win.area) || 0;
            if (wArea <= 0) return;

            const glassProps = {
                'single': { U: 5.7, g: 0.85 },
                'double_old': { U: 2.8, g: 0.75 },
                'double_recent': { U: 1.2, g: 0.60 },
                'triple': { U: 0.7, g: 0.45 }
            };

            const spec = glassProps[win.glass] || glassProps['double_recent'];
            let tWin = getSurfaceTemp('outside', spec.U);

            const maskFactor = { 'none': 1.0, 'partial': 0.5, 'heavy': 0.1 }[win.mask] ?? 1.0;
            const shutterFactor = {
                'aucun': 1.0,
                'store_banne': 0.25,
                'store_interieur': 0.75,
                'rideau_interieur': 0.80,
                'roulant_pvc': 0.10,
                'roulant_metal': 0.15,
                'battant_bois': 0.10,
                'persienne': 0.30
            }[win.shutter] ?? 1.0;

            if (isSunny && maskFactor > 0.1) {
                const orientFactor = { 'S': 3.5, 'SE': 2.8, 'SW': 2.8, 'E': 1.8, 'W': 1.8, 'N': 0.4 }[win.orient] ?? 1.0;
                const tiltFactor = { 'verticale': 1.0, 'inclinee': 1.3, 'horizontale': 1.5 }[win.tilt] ?? 1.0;

                const deltaTSolaire = (spec.g * orientFactor * tiltFactor * maskFactor * shutterFactor * 5.0);
                tWin += deltaTSolaire;
            }

            sumAreaTemp -= (getSurfaceTemp('outside', uWall) * wArea);
            sumAreaTemp += (tWin * wArea);
        });
    }

    return sumAreaTemp / totalArea;
}

// ============================================================
// ÉCOULEMENT ET VITESSE DE L'AIR (v_air)
// ============================================================

function calculateAirVelocity(zoneConfig) {
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

// ============================================================
// SOLVEUR ITÉRATIF PMV STANDARD (ISO 7730 / FANGER)
// ============================================================

function calculatePMV(ta, tr, vel, rh, met, clo) {
    if (ta === undefined || ta === null || isNaN(ta)) return -99;

    const M = met * 58.15; 
    const W = 0; 
    const Icl = 0.155 * clo; 
    const fcl = (clo <= 0.5) ? (1.0 + 0.2 * clo) : (1.05 + 0.1 * clo);

    const pa = rh * 10 * Math.exp(16.6536 - 4030.183 / (ta + 235));

    const hcFree = (t) => 2.38 * Math.pow(Math.abs(t - ta), 0.25);
    const hcForced = 12.1 * Math.sqrt(Math.max(vel, 0.001));

    let tcl = (ta + tr) / 2;
    for (let i = 0; i < 30; i++) {
        const hc = Math.max(hcFree(tcl), hcForced);
        const tclNext = (35.7 - 0.028 * (M - W) + Icl * fcl * (3.96e-8 * Math.pow(tr + 273.15, 4) + hc * ta)) / 
                        (1 + Icl * fcl * (3.96e-8 * Math.pow(tcl + 273.15, 3) + hc));
        if (Math.abs(tclNext - tcl) < 0.001) {
            tcl = tclNext;
            break;
        }
        tcl = (tcl + tclNext) / 2;
    }

    const hcFinal = Math.max(hcFree(tcl), hcForced);

    const pVapeurPeau = 3.05 * 0.001 * (5733 - 6.99 * (M - W) - pa);
    const pSueur = (M - W > 58.15) ? 0.42 * ((M - W) - 58.15) : 0;
    const pRespLatente = 1.7e-5 * M * (5867 - pa);
    const pRespSensible = 0.0014 * M * (34 - ta);
    const pRayonnement = 3.96e-8 * fcl * (Math.pow(tcl + 273.15, 4) - Math.pow(tr + 273.15, 4));
    const pConvection = fcl * hcFinal * (tcl - ta);

    const thermalSensationTransfer = 0.303 * Math.exp(-0.036 * M) + 0.028;
    const L = (M - W) - pVapeurPeau - pSueur - pRespLatente - pRespSensible - pRayonnement - pConvection;

    return thermalSensationTransfer * L;
}

// ============================================================
// HUMIDITÉ ABSOLUE (g/m³)
// ============================================================
function calculateAbsoluteHumidity(ta, rh) {
    if (ta === undefined || rh === undefined || isNaN(ta) || isNaN(rh)) return 0;
    
    const pSat = 611.2 * Math.exp((17.67 * ta) / (ta + 243.5));
    const pv = pSat * (rh / 100);
    const ah = (216.7 * pv) / (ta + 273.15);
    
    return parseFloat(ah.toFixed(2));
}

// ============================================================
// ESTIMATION DE L'INERTIE EFFECTIVE
// ============================================================
function estimateThermalInertia(nomPiece, previousTemp, previousTimestampMs) {
    const currentData = DONNEES_HABITAT[nomPiece];
    if (!currentData || !previousTemp || !previousTimestampMs) return { status: "Indéterminé", coeff: 0 };

    const nowMs = Date.now();
    const dtHours = (nowMs - previousTimestampMs) / (1000 * 3600);
    if (dtHours < 0.25) return { status: "Données insuffisantes", coeff: 0 }; 

    const deltaTint = Math.abs(currentData.ta - previousTemp);
    const deltaText = Math.abs(currentData.ta - outdoorTemp);

    if (deltaText < 1.0) return { status: "Écart T_int/T_ext trop faible", coeff: 0 };

    const alphaDerive = (deltaTint / dtHours) / deltaText;

    let inertieCat = "Moyenne";
    if (alphaDerive < 0.015) {
        inertieCat = "Très Lourde (Forte inertie)";
    } else if (alphaDerive < 0.035) {
        inertieCat = "Lourde / Inertie Moyenne";
    } else {
        inertieCat = "Faible (Dérive rapide / Parois légères)";
    }

    return {
        status: inertieCat,
        alphaDerive: parseFloat(alphaDerive.toFixed(4))
    };
}

// ============================================================
// POTENTIEL DE SÉCHAGE DU LINGE (VPD & Drying Index)
// ============================================================
function calculateDryingPotential(ta, rh, vel = 0.1) {
    const pSat = 611.2 * Math.exp((17.67 * ta) / (ta + 243.5)); 
    const vpd = (pSat * (1 - rh / 100)) / 1000; 

    const dryingIndex = vpd * (1 + 0.5 * vel);

    let status = "Très Léthargique";
    let score = 1; 

    if (vpd < 0.4) {
        status = "Très Mauvais (Moisissures)";
        score = 1;
    } else if (vpd < 0.8) {
        status = "Moyen (Lent)";
        score = 2;
    } else if (vpd < 1.3) {
        status = "Bon (Optimal)";
        score = 4;
    } else {
        status = "Excellent (Rapide)";
        score = 5;
    }

    return {
        vpdkPa: parseFloat(vpd.toFixed(3)),
        dryingIndex: parseFloat(dryingIndex.toFixed(3)),
        status: status,
        score: score
    };
}

// ============================================================
// BILAN ÉNERGÉTIQUE JOURNALIER (kWh/jour)
// ============================================================
function calculateDailyThermalBalance(zoneConfig, ta) {
    if (!zoneConfig) return { deperditionskWh: 0, gainsSolaireskWh: 0, bilanNetkWh: 0 };

    const area = parseFloat(zoneConfig.area) || 16;
    const h = parseFloat(zoneConfig.height) || 2.5;
    const volume = area * h;
    const side = Math.sqrt(area);
    const wallArea = side * h;
    const floorArea = area;

    const uWall = getUValueParoi('wall', zoneConfig.wallMat, zoneConfig.insulation);
    const uCeiling = getUValueParoi('ceiling', zoneConfig.ceilingMat, zoneConfig.ceilingInsulation);
    const uFloor = getUValueParoi('floor', zoneConfig.floorMat, zoneConfig.floorInsulation);

    let hSurfacique = (uWall * wallArea * 4) + (uCeiling * floorArea) + (uFloor * floorArea);

    let ach = 0.5; 
    const vmc = zoneConfig.equipment?.vmcSystem;
    if (vmc === 'double_flux') ach = 0.15; 
    else if (vmc === 'hygro_b') ach = 0.35;
    else if (vmc === 'aucun') ach = 0.8;

    const hVentilation = 0.34 * (volume * ach);
    const hTotal = hSurfacique + hVentilation;

    const deltaT = Math.max(0, ta - outdoorTemp);
    const deperditionskWh = (hTotal * deltaT * 24) / 1000;

    let gainsSolaireskWh = 0;
    const isSunny = sunshineStatus.toLowerCase().includes('clear') || sunshineStatus.toLowerCase().includes('sun');

    if (Array.isArray(zoneConfig.windows)) {
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

/**
 * 2. MISE À JOUR DYNAMIQUE D'UNE TUILE (Injection dans le DOM)
 */
function mettreAJourTuile(nomPiece) {
    const data = DONNEES_HABITAT[nomPiece];
    const idCapteur = capteursMaison[nomPiece];
    if (!data || !idCapteur) return; 

    // Données brutes capteurs
    const tempEl = document.getElementById('temp-' + idCapteur);
    const humEl = document.getElementById('hum-' + idCapteur);

    if (tempEl) tempEl.textContent = data.ta.toFixed(1) + " °C";
    if (humEl) humEl.textContent = data.rh.toFixed(0) + " %";

    const zoneConfig = getZoneConfigByName(nomPiece);
    if (!zoneConfig) return;

    // Calculs Thermiques et Aérauliques
    const vel = calculateAirVelocity(zoneConfig);
    const tr = calculateMeanRadiantTemp(zoneConfig, data.ta);
    const { met, totalClo } = getBaseCloAndMet(zoneConfig);

    // Calculs des indicateurs dérivés
    const ah = calculateAbsoluteHumidity(data.ta, data.rh);
    const drying = calculateDryingPotential(data.ta, data.rh, vel);
    const energyBalance = calculateDailyThermalBalance(zoneConfig, data.ta);

    let pmv = calculatePMV(data.ta, tr, vel, data.rh, met, totalClo);
    pmv = Math.max(-3, Math.min(3, pmv)); 

    // Injection dans le DOM
    const ahEl = document.getElementById('ah-' + idCapteur);
    const dryingEl = document.getElementById('drying-' + idCapteur);
    const energyEl = document.getElementById('energy-' + idCapteur);

    if (ahEl) ahEl.textContent = ah.toFixed(1) + " g/m³";
    if (dryingEl) {
        dryingEl.textContent = drying.status;
        dryingEl.style.color = drying.score >= 4 ? "var(--status-success, #10B981)" : 
                               (drying.score === 2 ? "var(--status-warning, #F59E0B)" : "var(--status-danger, #EF4444)");
    }
    if (energyEl) energyEl.textContent = energyBalance.deperditionskWh.toFixed(1) + " kWh/j";

    // Pavé PMV et Badging visuel
    const pmvBox = document.getElementById('pmv-box-' + idCapteur);
    const pmvVal = document.getElementById('pmv-' + idCapteur);
    const pmvText = document.getElementById('pmv-text-' + idCapteur);

    if (pmvVal) pmvVal.textContent = (pmv > 0 ? "+" : "") + pmv.toFixed(2);

    if (pmvBox && pmvVal && pmvText) {
        if (pmv < -0.75) { 
            pmvBox.style.backgroundColor = "#E0F2FE"; 
            pmvBox.style.borderColor = "#BAE6FD";
            pmvVal.style.color = "#0369A1"; 
            pmvText.textContent = "Sensation Froide 🥶";
        } else if (pmv < -0.2) {
            pmvBox.style.backgroundColor = "#F0F9FF"; 
            pmvBox.style.borderColor = "#E0F2FE";
            pmvVal.style.color = "#0284C7"; 
            pmvText.textContent = "Légèrement Frais 🌬️";
        } else if (pmv > 0.75) { 
            pmvBox.style.backgroundColor = "#FEE2E2"; 
            pmvBox.style.borderColor = "#FCA5A5";
            pmvVal.style.color = "#B91C1C"; 
            pmvText.textContent = "Sensation Chaude 🥵";
        } else if (pmv > 0.2) {
            pmvBox.style.backgroundColor = "#FEF3C7"; 
            pmvBox.style.borderColor = "#FDE68A";
            pmvVal.style.color = "#B45309"; 
            pmvText.textContent = "Légèrement Chaud ☀️";
        } else { 
            pmvBox.style.backgroundColor = "#D1FAE5"; 
            pmvBox.style.borderColor = "#A7F3D0";
            pmvVal.style.color = "#047857"; 
            pmvText.textContent = "Zone Neutre (Confort) ✅";
        }
    }
}

function recalculerToutLeDashboard() { 
    for (const nomPiece in DONNEES_HABITAT) { 
        mettreAJourTuile(nomPiece); 
    } 
}

function adjustClothing(amount) { 
    manualCloAdjustment += amount; 
    sessionStorage.setItem('manualCloAdjustment', manualCloAdjustment);
    updateClothingDisplay(); 
    recalculerToutLeDashboard(); 
}

function resetClothing() { 
    manualCloAdjustment = 0; 
    sessionStorage.setItem('manualCloAdjustment', 0);
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
// FLUX MÉTÉO ET SYNCHRONISATION
// ============================================================

document.getElementById('getWeatherButton')?.addEventListener('click', () => {
    const city = document.getElementById('location').value.trim();
    if (!city) return;
    fetchWeather(`https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric&lang=fr`);
});

document.getElementById('geoLocateButton')?.addEventListener('click', () => {
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (pos) => fetchWeather(`https://api.openweathermap.org/data/2.5/weather?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&appid=${apiKey}&units=metric&lang=fr`),
            () => alert("📍 Accès GPS refusé.")
        );
    }
});

function fetchWeather(url) {
    fetch(url)
        .then(res => res.json())
        .then(data => {
            outdoorTemp = data.main.temp; 
            outdoorHumidity = data.main.humidity;
            outdoorWind = (data.wind.speed * 3.6); 
            sunshineStatus = data.weather[0].main; 
            
            const locInput = document.getElementById('location');
            if (locInput) locInput.value = data.name;

            sessionStorage.setItem('location', data.name);
            sessionStorage.setItem('outdoorTemp', outdoorTemp);
            sessionStorage.setItem('outdoorHumidity', outdoorHumidity);
            sessionStorage.setItem('sunshineStatus', sunshineStatus);

            updateClothingDisplay(); 
            recalculerToutLeDashboard(); 
        })
        .catch(err => console.error("Erreur météo:", err));
}

async function synchroniserTouteLaMaison() {
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
                mettreAJourTuile(nomPiece);
                
                const statusEl = document.getElementById('status-' + idCapteur);
                if (statusEl) {
                    const now = new Date();
                    statusEl.textContent = "Actuel (" + now.getHours() + "h" + (now.getMinutes() < 10 ? '0' : '') + now.getMinutes() + ")";
                    statusEl.style.color = "var(--status-success, #10B981)";
                }
            }
        }

        sessionStorage.setItem('SOLSTICE_DONNEES_HABITAT', JSON.stringify(DONNEES_HABITAT));
        
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
    const zoneConfig = getZoneConfigByName(nomPiece);
    if (!zoneConfig) { 
        alert("⚠️ Pièce non configurée dans l'Espace Expert."); 
        return; 
    }

    const zoneKey = Object.keys(GLOBAL_HOUSE_CONFIG).find(key => GLOBAL_HOUSE_CONFIG[key].name === nomPiece);
    const pmv = document.getElementById('pmv-' + capteursMaison[nomPiece])?.textContent || "0";

    sessionStorage.setItem('currentZoneId', zoneKey); 
    sessionStorage.setItem('calculatedPMV', pmv);
    sessionStorage.setItem('indoorAirTemp', DONNEES_HABITAT[nomPiece].ta);
    sessionStorage.setItem('indoorHumidity', DONNEES_HABITAT[nomPiece].rh);
    sessionStorage.setItem('outdoorTemp', outdoorTemp);
    sessionStorage.setItem('sunshineStatus', sunshineStatus);

    window.location.href = 'page2.html';
}
