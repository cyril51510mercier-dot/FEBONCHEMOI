document.addEventListener('DOMContentLoaded', function() {
    try {
        const savedConfig = localStorage.getItem('HOUSE_CONFIG');
        const houseConfig = savedConfig ? JSON.parse(savedConfig) : {};
        
        // Récupération des données globales de l'habitat issues du scanner ou du cache
        const donneesHabitatRaw = localStorage.getItem('SOLSTICE_DONNEES_HABITAT') || sessionStorage.getItem('SOLSTICE_DONNEES_HABITAT');
        const donneesHabitat = donneesHabitatRaw ? JSON.parse(donneesHabitatRaw) : {};

        const envDataGlobal = {
            t_ext: parseFloat(localStorage.getItem('outdoorTemp')) || parseFloat(sessionStorage.getItem('outdoorTemp')) || 15,
            sun_status: localStorage.getItem('sunshineStatus') || sessionStorage.getItem('sunshineStatus') || 'Clouds',
        };

        let checkedActions = JSON.parse(localStorage.getItem('SOLSTICE_CHECKED_RECOS') || '{}');
        let currentZoneId = sessionStorage.getItem('currentZoneId') || Object.keys(houseConfig)[0] || 'all';

        const zoneSelect = document.getElementById('zoneSelect');
        const containerImmediate = document.getElementById('container-immediate');
        const containerAnticipated = document.getElementById('container-anticipated');
        const containerCompleted = document.getElementById('container-completed');

        function setupZoneSelector() {
            if (!zoneSelect) return;
            zoneSelect.innerHTML = '';
            
            Object.keys(houseConfig).forEach(zId => {
                const opt = document.createElement('option');
                opt.value = zId;
                opt.textContent = houseConfig[zId].name || `Zone ${zId}`;
                if (zId === currentZoneId) opt.selected = true;
                zoneSelect.appendChild(opt);
            });
            
            const optAll = document.createElement('option');
            optAll.value = 'all';
            optAll.textContent = '🌐 Toutes les pièces';
            if (currentZoneId === 'all') optAll.selected = true;
            zoneSelect.appendChild(optAll);
        }

        // Génération des conseils basée sur l'équipement de la pièce
        function generateRecommendations(zone, zoneId) {
            const recs = [];
            const zoneName = zone.name || zoneId;
            const roomData = donneesHabitat[zoneName] || {
                ta: parseFloat(sessionStorage.getItem('indoorAirTemp')) || 20,
                rh: parseFloat(sessionStorage.getItem('indoorHumidity')) || 50
            };

            const engine = window.SolsticeEngine;
            const tr = engine ? engine.calculateMeanRadiantTemp(zone, roomData.ta) : roomData.ta;
            const vel = engine ? engine.calculateAirVelocity(zone, zoneName) : 0.08;
            const { met, totalClo } = engine ? engine.getBaseCloAndMet(zone) : { met: 1.2, totalClo: 1.0 };
            
            const roomPmv = engine ? engine.calculatePMV(roomData.ta, tr, vel, roomData.rh, met, totalClo) : 0;

            const needsHeat = roomPmv < -0.5;
            const needsCooling = roomPmv > 0.5;
            const isSunny = envDataGlobal.sun_status.toLowerCase().includes('clear') || envDataGlobal.sun_status.toLowerCase().includes('sun');

            // --- HUMIDITÉ ---
            if (roomData.rh > 70) {
                if (zone.vmcSys === 'acceleree') {
                    recs.push({
                        id: `${zoneId}_vmc_boost`,
                        actionKey: 'vmc_boost',
                        zoneId, zoneName, timing: 'immediate', type: 'type-air',
                        title: 'Activer la VMC en mode accéléré',
                        text: `L'humidité atteint ${roomData.rh}%. Basculez la VMC en vitesse rapide.`,
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

            // --- SURCHAUFFE ---
            if (needsCooling) {
                if (envDataGlobal.t_ext < roomData.ta && zone.windows && zone.windows.some(w => w.vent !== 'fixe')) {
                    recs.push({
                        id: `${zoneId}_free_cooling`,
                        actionKey: 'free_cooling',
                        zoneId, zoneName, timing: 'immediate', type: 'type-cool',
                        title: 'Ventilation traversante (Free-cooling)',
                        text: `Il fait plus frais dehors (${envDataGlobal.t_ext}°C). Ouvrez la fenêtre pour décharger la chaleur.`,
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
                            text: `Baissez complètement les volets/stores pour stopper le rayonnement incident avant le vitrage.`,
                            impactWeight: 25
                        });
                        recs.push({
                            id: `${zoneId}_anticipate_sun`,
                            actionKey: 'anticipate_sun',
                            zoneId, zoneName, timing: 'anticipated', type: 'type-sun',
                            title: 'Occultation préventive du matin',
                            text: `Anticipez le pic thermique de l'après-midi : fermez les volets dès 10h demain.`,
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
                        text: `Allumez votre ventilateur. L'augmentation contrôlée de la vitesse de l'air rafraîchit sans clim.`,
                        impactWeight: 18
                    });
                }
            }

            // --- FROID ---
            if (needsHeat) {
                if (isSunny && envDataGlobal.t_ext < roomData.ta) {
                    recs.push({
                        id: `${zoneId}_sun_heat`,
                        actionKey: 'sun_heat',
                        zoneId, zoneName, timing: 'immediate', type: 'type-sun',
                        title: 'Ouvrir grand les protections solaires',
                        text: `Laissez pénétrer les rayons du soleil pour réchauffer les parois de la pièce.`,
                        impactWeight: 20
                    });
                }

                if (zone.heatSys === 'floor') {
                    recs.push({
                        id: `${zoneId}_floor_inertia`,
                        actionKey: 'floor_inertia',
                        zoneId, zoneName, timing: 'anticipated', type: 'type-heat',
                        title: 'Anticiper l\'inertie du plancher chauffant',
                        text: `Ajustez la consigne 3 heures à l'avance pour laisser la dalle restituer sa chaleur.`,
                        impactWeight: 15
                    });
                }

                if (zone.usages && zone.usages.includes('bedroom')) {
                    recs.push({
                        id: `${zoneId}_bedroom_temp`,
                        actionKey: 'bedroom_temp',
                        zoneId, zoneName, timing: 'anticipated', type: 'type-eco',
                        title: 'Réduction de consigne nocturne',
                        text: `Baissez le thermostat à 17°C/18°C 1h avant le coucher.`,
                        impactWeight: 10
                    });
                }
            }

            return recs;
        }

        function getAllRecommendations() {
            let allRecs = [];
            const selectedZone = zoneSelect ? zoneSelect.value : currentZoneId;

            if (selectedZone === 'all') {
                Object.keys(houseConfig).forEach(zId => {
                    allRecs = allRecs.concat(generateRecommendations(houseConfig[zId], zId));
                });
            } else if (houseConfig[selectedZone]) {
                allRecs = generateRecommendations(houseConfig[selectedZone], selectedZone);
            }
            return allRecs;
        }

        // Rendu de l'interface & décomposition en 3 zones (Immédiate, Anticipée, Effectuée)
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
                container.innerHTML = `<div style="color: var(--text-muted); font-style: italic; padding: 0.5rem 0;">${emptyText}</div>`;
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
                            <span class="room-badge-bold">📍 ${rec.zoneName}</span>
                            <span class="tag tag-weight">+${rec.impactWeight} pts</span>
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

            localStorage.setItem('SOLSTICE_CHECKED_RECOS', JSON.stringify(checkedActions));
            render();
        }

        // Calcul du PMV ciblé par pièce et mise à jour de la jauge de progression
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

            // Score d'éco-performance
            const score = totalWeightPossible > 0 ? Math.round((earnedWeight / totalWeightPossible) * 100) : 100;
            const scoreValEl = document.getElementById('scoreVal');
            const scoreBarEl = document.getElementById('scoreBar');
            if (scoreValEl) scoreValEl.textContent = `${score} / 100 pts`;
            if (scoreBarEl) scoreBarEl.style.width = `${score}%`;

            const engine = window.SolsticeEngine;
            const selectedZoneId = zoneSelect ? zoneSelect.value : currentZoneId;
            const roomTitleEl = document.getElementById('roomScoreTitle');

            // Récupération ciblée des données thermiques de la pièce sélectionnée
            let targetZoneConfig = houseConfig[selectedZoneId];
            let roomName = targetZoneConfig ? targetZoneConfig.name : 'Pièce';
            
            if (roomTitleEl) {
                roomTitleEl.textContent = selectedZoneId === 'all' 
                    ? `Score d'Éco-Performance (Vue globale)` 
                    : `Score d'Éco-Performance — ${roomName}`;
            }

            let roomData = donneesHabitat[roomName] || {
                ta: parseFloat(sessionStorage.getItem('indoorAirTemp')) || 20,
                rh: parseFloat(sessionStorage.getItem('indoorHumidity')) || 50
            };

            const baseTa = roomData.ta;
            const baseTr = engine ? engine.calculateMeanRadiantTemp(targetZoneConfig, baseTa) : baseTa;
            const baseVel = engine ? engine.calculateAirVelocity(targetZoneConfig, roomName) : 0.08;
            const { met, totalClo } = engine ? engine.getBaseCloAndMet(targetZoneConfig) : { met: 1.2, totalClo: 1.0 };

            const baseState = {
                ta: baseTa,
                tr: baseTr,
                vel: baseVel,
                rh: roomData.rh,
                met,
                clo: totalClo
            };

            // PMV Mesuré ciblé
            const pmvInit = engine ? engine.calculatePMV(baseTa, baseTr, baseVel, roomData.rh, met, totalClo) : 0;
            
            // PMV Simulé calibré
            const simulation = engine 
                ? engine.evaluateSimulatedPMV(baseState, checkedActionKeys, envDataGlobal)
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
