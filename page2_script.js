document.addEventListener('DOMContentLoaded', function() {
    try {
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

        function setupZoneSelector() {
            if (!zoneSelect) return;
            zoneSelect.innerHTML = '<option value="all">🌐 Toutes les pièces</option>';
            Object.keys(houseConfig).forEach(zId => {
                const opt = document.createElement('option');
                opt.value = zId;
                opt.textContent = houseConfig[zId].name || `Zone ${zId}`;
                if (zId === currentZoneId) opt.selected = true;
                zoneSelect.appendChild(opt);
            });
        }

        // Génération dynamique des recommandations selon le paramétrage expert
        function generateRecommendations(zone, zoneId) {
            const recs = [];
            const needsHeat = envData.pmv < -0.5;
            const needsCooling = envData.pmv > 0.5;
            const isSunny = envData.sun_status.toLowerCase().includes('clear');
            const zoneName = zone.name || zoneId;

            // --- 1. HUMIDITÉ (>70%) ---
            if (envData.rh_int > 70) {
                if (zone.vmcSys === 'acceleree') {
                    recs.push({
                        id: `${zoneId}_vmc_boost`,
                        actionKey: 'vmc_boost',
                        zoneId, zoneName, timing: 'immediate', type: 'type-air',
                        title: 'Activer la VMC en mode accéléré',
                        text: `L'humidité dépasse 70%. Passez la VMC en vitesse rapide dans ${zoneName}.`,
                        impactWeight: 15
                    });
                } else if (zone.windows && zone.windows.some(w => w.vent && w.vent !== 'fixe')) {
                    const win = zone.windows.find(w => w.vent && w.vent !== 'fixe');
                    recs.push({
                        id: `${zoneId}_open_win_humidity`,
                        actionKey: 'open_win_humidity',
                        zoneId, zoneName, timing: 'immediate', type: 'type-air',
                        title: 'Aération flash ciblée',
                        text: `Ouvrez la fenêtre en position ${win.vent} pendant 5 minutes pour évacuer la vapeur d'eau.`,
                        impactWeight: 12
                    });
                }
            }

            // --- 2. SURCHAUFFE (PMV > 0.5) ---
            if (needsCooling) {
                if (envData.t_ext < envData.t_air_int && zone.windows && zone.windows.some(w => w.vent !== 'fixe')) {
                    recs.push({
                        id: `${zoneId}_free_cooling`,
                        actionKey: 'free_cooling',
                        zoneId, zoneName, timing: 'immediate', type: 'type-cool',
                        title: 'Ventilation traversante (Free-cooling)',
                        text: `Il fait plus frais dehors (${envData.t_ext}°C). Ouvrez la fenêtre de ${zoneName} pour décharger la chaleur.`,
                        impactWeight: 20
                    });
                }

                if (isSunny && zone.windows) {
                    const hasExtShutter = zone.windows.some(w => w.shutter && (w.shutter.includes('roulant') || w.shutter === 'battant_bois' || w.shutter === 'store_banne'));
                    if (hasExtShutter) {
                        recs.push({
                            id: `${zoneId}_shutter_close`,
                            actionKey: 'shutter_close',
                            zoneId, zoneName, timing: 'immediate', type: 'type-sun',
                            title: 'Fermer les occultations extérieures',
                            text: `Baissez complètement les volets/stores de ${zoneName} pour stopper le rayonnement incident avant le vitrage.`,
                            impactWeight: 25
                        });
                        recs.push({
                            id: `${zoneId}_anticipate_sun`,
                            actionKey: 'anticipate_sun',
                            zoneId, zoneName, timing: 'anticipated', type: 'type-sun',
                            title: 'Occultation préventive du matin',
                            text: `Anticipez le pic thermique de l'après-midi : fermez les volets de ${zoneName} dès 10h demain.`,
                            impactWeight: 15
                        });
                    }
                }

                if (zone.fanSys && zone.fanSys !== 'aucun') {
                    recs.push({
                        id: `${zoneId}_fan_on`,
                        actionKey: 'fan_on',
                        zoneId, zoneName, timing: 'immediate', type: 'type-eco',
                        title: `Activer le brassage d'air (${zone.fanSys})`,
                        text: `Allumez votre ventilateur. La vitesse de l'air augmente les pertes convectives et la sudation sans climatisation.`,
                        impactWeight: 18
                    });
                }
            }

            // --- 3. FROID / CHAUFFAGE (PMV < -0.5) ---
            if (needsHeat) {
                if (isSunny && envData.t_ext < envData.t_air_int) {
                    recs.push({
                        id: `${zoneId}_sun_heat`,
                        actionKey: 'sun_heat',
                        zoneId, zoneName, timing: 'immediate', type: 'type-sun',
                        title: 'Ouvrir grand les protections solaires',
                        text: `Laissez pénétrer les rayons du soleil dans ${zoneName} pour réchauffer les parois et l'air intérieur.`,
                        impactWeight: 20
                    });
                }

                if (zone.heatSys === 'floor') {
                    recs.push({
                        id: `${zoneId}_floor_inertia`,
                        actionKey: 'floor_inertia',
                        zoneId, zoneName, timing: 'anticipated', type: 'type-heat',
                        title: 'Anticiper l\'inertie du plancher chauffant',
                        text: `Ajustez le thermostat 3 heures à l'avance pour laisser le temps au fluide de restituer sa chaleur.`,
                        impactWeight: 15
                    });
                }

                if (zone.usages && zone.usages.includes('bedroom')) {
                    recs.push({
                        id: `${zoneId}_bedroom_temp`,
                        actionKey: 'bedroom_temp',
                        zoneId, zoneName, timing: 'anticipated', type: 'type-eco',
                        title: 'Réduction de consigne nocturne',
                        text: `Baissez le thermostat à 17°C/18°C 1h avant le coucher dans cette chambre.`,
                        impactWeight: 10
                    });
                }
            }

            return recs;
        }

        function getAllRecommendations() {
            let allRecs = [];
            const selectedZone = zoneSelect ? zoneSelect.value : 'all';

            if (selectedZone === 'all') {
                Object.keys(houseConfig).forEach(zId => {
                    allRecs = allRecs.concat(generateRecommendations(houseConfig[zId], zId));
                });
            } else if (houseConfig[selectedZone]) {
                allRecs = generateRecommendations(houseConfig[selectedZone], selectedZone);
            }
            return allRecs;
        }

        function render() {
            const recs = getAllRecommendations();
            if (containerImmediate) containerImmediate.innerHTML = '';
            if (containerAnticipated) containerAnticipated.innerHTML = '';

            const immediateList = recs.filter(r => r.timing === 'immediate');
            const anticipatedList = recs.filter(r => r.timing === 'anticipated');

            renderGroup(immediateList, containerImmediate);
            renderGroup(anticipatedList, containerAnticipated);

            updateMetrics(recs);
        }

        function renderGroup(list, container) {
            if (!container) return;
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

        // Calcul exact de l'état thermique et simulation PMV ISO 7730
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

            // Score d'éco-performance sur 100
            const score = totalWeightPossible > 0 ? Math.round((earnedWeight / totalWeightPossible) * 100) : 100;
            const scoreValEl = document.getElementById('scoreVal');
            const scoreBarEl = document.getElementById('scoreBar');
            if (scoreValEl) scoreValEl.textContent = `${score} / 100 pts`;
            if (scoreBarEl) scoreBarEl.style.width = `${score}%`;

            // Récupération du moteur SolsticeEngine
            const engine = window.SolsticeEngine;
            const selectedZoneId = zoneSelect ? zoneSelect.value : 'all';
            const targetZoneConfig = houseConfig[selectedZoneId] || Object.values(houseConfig)[0] || null;

            // Détermination de l'état thermodynamique initial
            const baseTa = envData.t_air_int;
            const baseTr = engine ? engine.calculateMeanRadiantTemp(targetZoneConfig, baseTa) : baseTa;
            const baseVel = engine ? engine.calculateAirVelocity(targetZoneConfig) : 0.08;
            const { met, totalClo } = engine ? engine.getBaseCloAndMet(targetZoneConfig) : { met: 1.2, totalClo: 1.0 };

            const baseState = {
                ta: baseTa,
                tr: baseTr,
                vel: baseVel,
                rh: envData.rh_int,
                met,
                clo: totalClo
            };

            // PMV Initial
            const pmvInit = engine ? engine.calculatePMV(baseTa, baseTr, baseVel, envData.rh_int, met, totalClo) : envData.pmv;
            
            // PMV Simulé via modificateurs physiques
            const simulation = engine 
                ? engine.evaluateSimulatedPMV(baseState, checkedActionKeys, envData)
                : { pmv: pmvInit };

            const dispInitEl = document.getElementById('disp-pmv-init');
            const simEl = document.getElementById('disp-pmv-sim');

            if (dispInitEl) dispInitEl.textContent = (pmvInit > 0 ? "+" : "") + pmvInit.toFixed(2);
            
            if (simEl) {
                const pmvSimulated = simulation.pmv;
                simEl.textContent = (pmvSimulated > 0 ? "+" : "") + pmvSimulated.toFixed(2);

                if (Math.abs(pmvSimulated) <= 0.5) {
                    simEl.style.color = 'var(--eco)';
                } else if (pmvSimulated > 0.5) {
                    simEl.style.color = 'var(--hot)';
                } else {
                    simEl.style.color = 'var(--cold)';
                }
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
        console.error("Erreur d'initialisation Solstice Recos:", err);
    }
});
