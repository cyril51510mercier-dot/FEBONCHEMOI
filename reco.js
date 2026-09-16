document.addEventListener('DOMContentLoaded', function() {
    try {
        const store = window.SolsticeStore;
        const engine = window.SolsticeEngine;

        const houseConfig = store.getZones();
        const donneesHabitat = store.getScanData();
        const envDataGlobal = store.getEnvData();

        let checkedActions = store.getCheckedRecos();
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

        function getAllRecommendations() {
            let allRecs = [];
            const selectedZone = zoneSelect ? zoneSelect.value : currentZoneId;

            if (selectedZone === 'all') {
                Object.keys(houseConfig).forEach(zId => {
                    const zone = houseConfig[zId];
                    const roomName = zone.name || zId;
                    const roomData = donneesHabitat[roomName] || { ta: 20, rh: 50 };
                    allRecs = allRecs.concat(engine.generateRecommendations(zone, zId, roomData, envDataGlobal));
                });
            } else if (houseConfig[selectedZone]) {
                const zone = houseConfig[selectedZone];
                const roomName = zone.name || selectedZone;
                const roomData = donneesHabitat[roomName] || { ta: 20, rh: 50 };
                allRecs = engine.generateRecommendations(zone, selectedZone, roomData, envDataGlobal);
            }
            return allRecs;
        }

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
                card.className = `advice-card ${rec.type}`;
                card.style.cssText = "display: flex; align-items: flex-start; gap: 1rem; cursor: pointer; margin-bottom: 10px;";
                
                card.onclick = (e) => toggleAction(rec.id, e);

                card.innerHTML = `
                    <div style="margin-top: 0.25rem;">
                        <input type="checkbox" id="${rec.id}" ${isChecked ? 'checked' : ''} style="width: 20px; height: 20px; cursor: pointer;">
                    </div>
                    <div style="flex: 1;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.3rem;">
                            <span style="font-size: 0.8rem; background: var(--primary); color: white; padding: 2px 8px; border-radius: 4px; font-weight: bold;">📍 ${rec.zoneName}</span>
                            <span style="font-size: 0.8rem; background: #e9f7ef; color: var(--eco); padding: 2px 6px; border-radius: 4px; font-weight: bold;">+${rec.impactWeight} pts</span>
                        </div>
                        <div style="font-weight: bold; font-size: 1rem; ${isChecked ? 'text-decoration: line-through; color: #7f8c8d;' : ''}">${rec.title}</div>
                        <div style="font-size: 0.9rem; color: #555;">${rec.text}</div>
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

            const selectedZoneId = zoneSelect ? zoneSelect.value : currentZoneId;
            const roomTitleEl = document.getElementById('roomScoreTitle');
            const targetZoneConfig = houseConfig[selectedZoneId];
            const roomName = targetZoneConfig ? targetZoneConfig.name : 'Pièce';

            if (roomTitleEl) {
                roomTitleEl.textContent = selectedZoneId === 'all' 
                    ? `Score d'Éco-Performance (Vue globale)` 
                    : `Score d'Éco-Performance — ${roomName}`;
            }

            const roomData = donneesHabitat[roomName] || { ta: 20, rh: 50 };
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