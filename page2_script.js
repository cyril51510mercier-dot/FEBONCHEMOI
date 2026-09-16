<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Solstice - Recommandations & Plan d'Action</title>
  <style>
    :root {
      --primary: #2563eb;
      --eco: #16a34a;
      --hot: #ea580c;
      --cold: #0284c7;
      --bg: #f8fafc;
      --card: #ffffff;
      --border: #e2e8f0;
      --text: #0f172a;
      --text-muted: #64748b;
    }

    body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); padding: 2rem; margin: 0; }
    .container { max-width: 900px; margin: 0 auto; }

    /* Controls & Header */
    .dashboard-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; background: var(--card); padding: 1rem 1.5rem; border-radius: 10px; border: 1px solid var(--border); }
    .filter-group { display: flex; align-items: center; gap: 0.75rem; }
    select { padding: 0.5rem 1rem; border-radius: 6px; border: 1px solid var(--border); font-size: 0.95rem; }

    /* Score & PMV Feedback Gauge */
    .feedback-panel { background: var(--card); padding: 1.5rem; border-radius: 12px; border: 1px solid var(--border); margin-bottom: 2rem; }
    .gauge-header { display: flex; justify-content: space-between; font-weight: 600; margin-bottom: 0.5rem; }
    .progress-bg { width: 100%; height: 14px; background: #e2e8f0; border-radius: 7px; overflow: hidden; margin-bottom: 1rem; }
    .progress-fill { height: 100%; width: 0%; background: linear-gradient(90deg, var(--primary), var(--eco)); transition: width 0.3s ease; }
    .pmv-status { display: flex; gap: 1.5rem; font-size: 0.9rem; color: var(--text-muted); }

    /* Sections Actions */
    .section-title { font-size: 1.15rem; font-weight: 700; margin: 1.5rem 0 1rem 0; display: flex; align-items: center; gap: 0.5rem; }
    .reco-group { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 2rem; }

    /* Cards */
    .reco-card { display: flex; align-items: flex-start; gap: 1rem; background: var(--card); padding: 1.25rem; border-radius: 8px; border: 1px solid var(--border); transition: all 0.2s ease; cursor: pointer; }
    .reco-card:hover { border-color: var(--primary); }
    .reco-card.checked { background: #f0fdf4; border-color: #bbf7d0; opacity: 0.85; }
    .reco-card.checked .reco-title { text-decoration: line-through; color: var(--text-muted); }

    .checkbox-box { margin-top: 0.25rem; }
    .checkbox-box input { width: 20px; height: 20px; accent-color: var(--eco); cursor: pointer; }

    .reco-body { flex: 1; }
    .reco-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem; }
    .reco-title { font-weight: 600; font-size: 1rem; }
    .room-badge { font-size: 0.75rem; background: #f1f5f9; padding: 0.2rem 0.5rem; border-radius: 4px; color: var(--text-muted); }
    .reco-text { font-size: 0.9rem; color: var(--text-muted); line-height: 1.4; }
    
    .reco-meta { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
    .tag { font-size: 0.75rem; padding: 0.15rem 0.4rem; border-radius: 4px; font-weight: 600; }
    .tag-weight { background: #dcfce7; color: var(--eco); }

    /* Types d'actions */
    .type-air { border-left: 4px solid #06b6d4; }
    .type-cool { border-left: 4px solid var(--cold); }
    .type-sun { border-left: 4px solid #f59e0b; }
    .type-heat { border-left: 4px solid var(--hot); }
    .type-eco { border-left: 4px solid var(--eco); }
  </style>
</head>
<body>

<div class="container">

  <!-- Controls -->
  <div class="dashboard-bar">
    <div>
      <h1 style="font-size: 1.3rem; margin: 0;">Plan d'Action & Recommandations</h1>
    </div>
    <div class="filter-group">
      <label for="zoneSelect"><strong>Filtrer par pièce :</strong></label>
      <select id="zoneSelect"></select>
    </div>
  </div>

  <!-- Jauge Dynamique -->
  <div class="feedback-panel">
    <div class="gauge-header">
      <span>Score de Confort Réalisé</span>
      <span id="scoreVal">0 / 100 pts</span>
    </div>
    <div class="progress-bg">
      <div id="scoreBar" class="progress-fill"></div>
    </div>
    <div class="pmv-status">
      <span>PMV Initial : <strong id="disp-pmv-init">--</strong></span>
      <span>PMV Simulé (après actions) : <strong id="disp-pmv-sim">--</strong></span>
    </div>
  </div>

  <!-- Actions Immédiates -->
  <div class="section-title">⚡ Actions Immédiates (Court terme)</div>
  <div id="container-immediate" class="reco-group"></div>

  <!-- Actions Anticipées -->
  <div class="section-title">⏳ Actions Anticipées (Moyen terme / Anticipation)</div>
  <div id="container-anticipated" class="reco-group"></div>

</div>

<script>
document.addEventListener('DOMContentLoaded', function() {
    try {
        // 1. Récupération des données d'environnement et de configuration
        const savedConfig = localStorage.getItem('HOUSE_CONFIG');
        const houseConfig = savedConfig ? JSON.parse(savedConfig) : {};
        
        const envData = {
            pmv: parseFloat(sessionStorage.getItem('calculatedPMV')) || 0,
            t_air_int: parseFloat(sessionStorage.getItem('indoorAirTemp')) || 20,
            rh_int: parseFloat(sessionStorage.getItem('indoorHumidity')) || 50,
            t_ext: parseFloat(sessionStorage.getItem('outdoorTemp')) || 15,
            sun_status: sessionStorage.getItem('sunshineStatus') || 'Clouds',
        };

        let checkedActions = JSON.parse(localStorage.getItem('SOLSTICE_CHECKED_RECOS') || '{}');
        let currentZoneId = sessionStorage.getItem('currentZoneId') || 'all';

        const zoneSelect = document.getElementById('zoneSelect');
        const containerImmediate = document.getElementById('container-immediate');
        const containerAnticipated = document.getElementById('container-anticipated');

        // Populate Sélecteur de pièces
        function setupZoneSelector() {
            zoneSelect.innerHTML = '<option value="all">🌐 Toutes les pièces</option>';
            Object.keys(houseConfig).forEach(zId => {
                const opt = document.createElement('option');
                opt.value = zId;
                opt.textContent = houseConfig[zId].name || `Zone ${zId}`;
                if (zId === currentZoneId) opt.selected = true;
                zoneSelect.appendChild(opt);
            });
        }

        // 2. Moteur de Génération des Recommandations basé sur le paramétrage expert
        function generateRecommendations(zone, zoneId) {
            const recs = [];
            const needsHeat = envData.pmv < -0.5;
            const needsCooling = envData.pmv > 0.5;
            const isSunny = envData.sun_status.toLowerCase().includes('clear');
            const zoneName = zone.name || zoneId;

            // --- 2.1 HUMIDITÉ (>70%) ---
            if (envData.rh_int > 70) {
                if (zone.vmcSys === 'acceleree') {
                    recs.push({
                        id: `${zoneId}_vmc_boost`,
                        zoneId, zoneName, timing: 'immediate', type: 'type-air',
                        title: 'Activer la VMC en mode accéléré',
                        text: `L'humidité dépasse 70%. Passez la VMC en vitesse rapide dans ${zoneName}.`,
                        impactWeight: 15, deltaPmv: -0.2
                    });
                } else if (zone.windows && zone.windows.some(w => w.vent && w.vent !== 'fixe')) {
                    const win = zone.windows.find(w => w.vent && w.vent !== 'fixe');
                    recs.push({
                        id: `${zoneId}_open_win_humidity`,
                        zoneId, zoneName, timing: 'immediate', type: 'type-air',
                        title: 'Aération flash ciblée',
                        text: `Ouvrez la fenêtre en position ${win.vent} pendant 5 minutes pour évacuer la vapeur d'eau.`,
                        impactWeight: 12, deltaPmv: -0.15
                    });
                }
            }

            // --- 2.2 SURCHAUFFE / REFROIDISSEMENT (PMV > 0.5) ---
            if (needsCooling) {
                // Free-cooling immédiat
                if (envData.t_ext < envData.t_air_int && zone.windows && zone.windows.some(w => w.vent !== 'fixe')) {
                    recs.push({
                        id: `${zoneId}_free_cooling`,
                        zoneId, zoneName, timing: 'immediate', type: 'type-cool',
                        title: 'Ventilation traversante (Free-cooling)',
                        text: `Il fait plus frais dehors (${envData.t_ext}°C). Ouvrez la fenêtre de ${zoneName} pour décharger la chaleur.`,
                        impactWeight: 20, deltaPmv: -0.4
                    });
                }

                // Bouclier solaire (Roulant / Battant / Store)
                if (isSunny && zone.windows) {
                    const hasExtShutter = zone.windows.some(w => w.shutter && (w.shutter.includes('roulant') || w.shutter === 'battant_bois' || w.shutter === 'store_banne'));
                    if (hasExtShutter) {
                        recs.push({
                            id: `${zoneId}_shutter_close`,
                            zoneId, zoneName, timing: 'immediate', type: 'type-sun',
                            title: 'Fermer les occultations extérieures',
                            text: `Baissez complètement les volets/stores de ${zoneName} pour stopper le rayonnement avant le vitrage.`,
                            impactWeight: 25, deltaPmv: -0.5
                        });
                        recs.push({
                            id: `${zoneId}_anticipate_sun`,
                            zoneId, zoneName, timing: 'anticipated', type: 'type-sun',
                            title: 'Occultation préventive du matin',
                            text: `Anticipez le pic thermique de l'après-midi : fermez les volets de ${zoneName} dès 10h demain.`,
                            impactWeight: 15, deltaPmv: -0.3
                        });
                    }
                }

                // Brassage d'air (Ventilateur)
                if (zone.fanSys && zone.fanSys !== 'aucun') {
                    recs.push({
                        id: `${zoneId}_fan_on`,
                        zoneId, zoneName, timing: 'immediate', type: 'type-eco',
                        title: `Activer le brassage d'air (${zone.fanSys})`,
                        text: `Allumez votre ventilateur. La vitesse de l'air abaisse la température ressentie de 2°C à 3°C sans climatisation.`,
                        impactWeight: 18, deltaPmv: -0.35
                    });
                }
            }

            // --- 2.3 CHAUFFAGE / FROID (PMV < -0.5) ---
            if (needsHeat) {
                // Apport solaire passif
                if (isSunny && envData.t_ext < envData.t_air_int) {
                    recs.push({
                        id: `${zoneId}_sun_heat`,
                        zoneId, zoneName, timing: 'immediate', type: 'type-sun',
                        title: 'Ouvrir grand les protections solaires',
                        text: `Laissez pénétrer les rayons du soleil dans ${zoneName} pour réchauffer gratuitement la pièce.`,
                        impactWeight: 20, deltaPmv: 0.4
                    });
                }

                // Inertie du plancher chauffant
                if (zone.heatSys === 'floor') {
                    recs.push({
                        id: `${zoneId}_floor_inertia`,
                        zoneId, zoneName, timing: 'anticipated', type: 'type-heat',
                        title: 'Anticiper la forte inertie du plancher chauffant',
                        text: `Ajustez la consigne 3 heures à l'avance. Le plancher met plusieurs heures à restituer la chaleur.`,
                        impactWeight: 15, deltaPmv: 0.25
                    });
                }

                // Usage chambre vs séjour
                if (zone.usages && zone.usages.includes('bedroom')) {
                    recs.push({
                        id: `${zoneId}_bedroom_temp`,
                        zoneId, zoneName, timing: 'anticipated', type: 'type-eco',
                        title: 'Réduction de consigne nocturne',
                        text: `Baissez le thermostat à 17°C/18°C 1h avant le coucher. Idéal pour le sommeil et l'économie d'énergie.`,
                        impactWeight: 10, deltaPmv: 0.15
                    });
                }
            }

            return recs;
        }

        // 3. Récupération de l'ensemble des recommandations
        function getAllRecommendations() {
            let allRecs = [];
            const selectedZone = zoneSelect.value;

            if (selectedZone === 'all') {
                Object.keys(houseConfig).forEach(zId => {
                    allRecs = allRecs.concat(generateRecommendations(houseConfig[zId], zId));
                });
            } else if (houseConfig[selectedZone]) {
                allRecs = generateRecommendations(houseConfig[selectedZone], selectedZone);
            }
            return allRecs;
        }

        // 4. Rendu UI et Calculs d'Impact
        function render() {
            const recs = getAllRecommendations();
            containerImmediate.innerHTML = '';
            containerAnticipated.innerHTML = '';

            const immediateList = recs.filter(r => r.timing === 'immediate');
            const anticipatedList = recs.filter(r => r.timing === 'anticipated');

            renderGroup(immediateList, containerImmediate);
            renderGroup(anticipatedList, containerAnticipated);

            updateMetrics(recs);
        }

        function renderGroup(list, container) {
            if (list.length === 0) {
                container.innerHTML = '<div style="color: var(--text-muted); font-style: italic;">Aucune action requise dans cette catégorie.</div>';
                return;
            }

            list.forEach(rec => {
                const isChecked = !!checkedActions[rec.id];
                const card = document.createElement('div');
                card.className = `reco-card ${rec.type} ${isChecked ? 'checked' : ''}`;
                card.onclick = (e) => toggleAction(rec.id, e);

                card.innerHTML = `
                    <div class="checkbox-box">
                        <input type="checkbox" id="${rec.id}" ${isChecked ? 'checked' : ''} tabindex="-1">
                    </div>
                    <div class="reco-body">
                        <div class="reco-header">
                            <span class="reco-title">${rec.title}</span>
                            <span class="room-badge">${rec.zoneName}</span>
                        </div>
                        <div class="reco-text">${rec.text}</div>
                        <div class="reco-meta">
                            <span class="tag tag-weight">+${rec.impactWeight} pts score</span>
                        </div>
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

            localStorage.setItem('SOLSTICE_CHECKED_RECOS', JSON.stringify(checkedActions));
            render();
        }

        function updateMetrics(allRecs) {
            let totalWeightPossible = 0;
            let earnedWeight = 0;
            let pmvCorrection = 0;

            allRecs.forEach(r => {
                totalWeightPossible += r.impactWeight;
                if (checkedActions[r.id]) {
                    earnedWeight += r.impactWeight;
                    pmvCorrection += r.deltaPmv;
                }
            });

            // Score normalisé sur 100
            const score = totalWeightPossible > 0 ? Math.round((earnedWeight / totalWeightPossible) * 100) : 100;
            document.getElementById('scoreVal').textContent = `${score} / 100 pts`;
            document.getElementById('scoreBar').style.width = `${score}%`;

            // PMV Simulé
            const pmvInit = envData.pmv;
            const pmvSimulated = pmvInit + pmvCorrection;

            document.getElementById('disp-pmv-init').textContent = pmvInit.toFixed(2);
            const simEl = document.getElementById('disp-pmv-sim');
            simEl.textContent = pmvSimulated.toFixed(2);

            if (Math.abs(pmvSimulated) < 0.5) {
                simEl.style.color = 'var(--eco)';
            } else if (pmvSimulated > 0.5) {
                simEl.style.color = 'var(--hot)';
            } else {
                simEl.style.color = 'var(--cold)';
            }
        }

        // 5. Interactivité
        zoneSelect.addEventListener('change', (e) => {
            currentZoneId = e.target.value;
            sessionStorage.setItem('currentZoneId', currentZoneId);
            render();
        });

        // Initialisation
        setupZoneSelector();
        render();

    } catch (err) {
        console.error("Erreur d'initialisation Solstice Recos:", err);
    }
});
</script>
</body>
</html>
