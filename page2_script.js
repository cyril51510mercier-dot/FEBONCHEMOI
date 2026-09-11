/**
 * ==================================================================
 * SOLSTICE - MOTEUR DE RECOMMANDATIONS INTELLIGENTES
 * ==================================================================
 */

document.addEventListener('DOMContentLoaded', function() {
    try {
        const zoneId = sessionStorage.getItem('currentZoneId');
        const savedConfig = localStorage.getItem('HOUSE_CONFIG');
        const houseConfig = savedConfig ? JSON.parse(savedConfig) : {};
        const zone = houseConfig[zoneId] || null;

        const data = {
            pmv: parseFloat(sessionStorage.getItem('calculatedPMV')) || 0,
            t_air_int: parseFloat(sessionStorage.getItem('indoorAirTemp')) || 20,
            rh_int: parseFloat(sessionStorage.getItem('indoorHumidity')) || 50,
            t_ext: parseFloat(sessionStorage.getItem('outdoorTemp')) || 15,
            sun_status: sessionStorage.getItem('sunshineStatus') || 'Clouds',
        };

        function safeUpdate(id, text, color = null) {
            const el = document.getElementById(id);
            if (el) { el.textContent = text; if (color) el.style.color = color; }
        }

        const pmvColor = data.pmv < -0.5 ? 'var(--cold)' : (data.pmv > 0.5 ? 'var(--hot)' : 'var(--eco)');
        safeUpdate('disp-pmv', data.pmv.toFixed(2), pmvColor);
        safeUpdate('disp-rh', data.rh_int.toFixed(0) + "%");
        safeUpdate('disp-room', zone ? zone.name : "Zone Inconnue");

        const recommendations = [];
        const needsHeat = data.pmv < -0.5;
        const needsCooling = data.pmv > 0.5;
        const isSunny = data.sun_status.toLowerCase().includes('clear');

        // --- INTELLIGENCE : CROISEMENT DONNÉES EXPERTES ET CAPTEURS ---
        if (zone) {
            // 1. Gestion de l'humidité
            if (data.rh_int > 70) {
                let action_vent = "Aérez la pièce.";
                if (zone.vmcSys === 'acceleree') action_vent = "Passez la VMC en mode accéléré pour extraire l'humidité.";
                if (zone.windows && zone.windows[0].vent !== 'fixe') action_vent = `Ouvrez la fenêtre (${zone.windows[0].vent}) pendant 5 minutes.`;
                pushRec("type-air", "💨 Urgence Humidité (>70%)", action_vent);
            }

            // 2. Besoin de Refroidissement (L'ÉTÉ)
            if (needsCooling) {
                // Free-cooling nocturne/matinal
                if (data.t_ext < data.t_air_int) {
                    pushRec("type-cool", "🌬️ Rafraîchissement gratuit", `Il fait plus frais dehors (${data.t_ext}°C). Ouvrez vos fenêtres pour décharger la chaleur accumulée.`);
                }
                
                // Bouclier solaire
                if (isSunny && data.t_ext >= data.t_air_int && zone.windows) {
                    const hasExternalShutter = zone.windows.some(w => w.shutter.includes('roulant') || w.shutter === 'battant_bois' || w.shutter === 'store_banne');
                    if(hasExternalShutter) {
                        pushRec("type-sun", "🛡️ Bouclier Solaire", "Fermez vos protections solaires extérieures. Elles bloquent la chaleur avant qu'elle ne traverse le vitrage.");
                    } else {
                        pushRec("type-sun", "☀️ Impact Solaire", "Fermez vos rideaux. Vous n'avez pas de protection extérieure, la chaleur rentre par effet de serre.");
                    }
                }

                // Brassage et Climatisation
                if (zone.fanSys !== 'aucun') {
                    pushRec("type-eco", "🌪️ Activer le brassage", `Allumez votre ventilateur (${zone.fanSys}). Cela améliore la sensation thermique sans consommer comme une clim.`);
                } else if (zone.coolingSys !== 'aucun') {
                    let conseilClim = "Allumez la climatisation.";
                    if(zone.coolingSys === 'clim_mobile') conseilClim = "Votre clim mobile crée une dépression (fait entrer de l'air chaud). Pensez à bien calfeutrer le tuyau.";
                    pushRec("type-cool", "❄️ Refroidissement Actif", conseilClim);
                }
            }

            // 3. Besoin de Chauffage (L'HIVER)
            if (needsHeat) {
                if (isSunny && data.t_ext < data.t_air_int) {
                    pushRec("type-sun", "☀️ Apport Solaire Gratuit", "Ouvrez grand vos volets ! Le soleil va chauffer gratuitement la pièce par effet de serre.");
                }
                
                let heatMsg = "Augmentez le chauffage d'un degré.";
                if (zone.heatSys === 'floor') heatMsg = "Augmentez légèrement le thermostat. Attention : votre plancher chauffant a une très forte inertie, la chaleur mettra plusieurs heures à se faire sentir.";
                pushRec("type-heat", "🔥 Confort Non Atteint", heatMsg);
            }
        }

        function pushRec(type, title, text) { recommendations.push({ type, title, text }); }

        const container = document.getElementById('recommendations-container');
        if (container) {
            container.innerHTML = ''; 
            if (recommendations.length === 0) {
                container.innerHTML = '<div class="advice-card type-eco"><div class="advice-title">✅ Bilan Parfait</div><p>Votre confort est optimal.</p></div>';
            } else {
                recommendations.forEach(rec => {
                    const div = document.createElement('div');
                    div.className = `advice-card ${rec.type}`;
                    div.innerHTML = `<div class="advice-title">${rec.title}</div><p>${rec.text}</p>`;
                    container.appendChild(div);
                });
            }
        }

        // --- HISTORIQUE (Pour l'apprentissage Machine Learning plus tard) ---
        const historyTableBody = document.getElementById('historyTableBody');
        const saveHistoryBtn = document.getElementById('saveHistoryBtn');
        
        function loadHistory() {
            if (!historyTableBody) return;
            const allHistory = JSON.parse(localStorage.getItem('SOLSTICE_HISTORY')) || [];
            const zoneHistory = allHistory.filter(entry => entry.zoneId === zoneId);
            
            historyTableBody.innerHTML = ''; 
            if (zoneHistory.length === 0) {
                historyTableBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #7f8c8d;">Aucune mesure enregistrée.</td></tr>';
                return;
            }

            zoneHistory.slice(-5).reverse().forEach(entry => {
                const tr = document.createElement('tr');
                let pmvColor = "var(--eco)"; 
                if (entry.pmv < -0.5) pmvColor = "var(--cold)"; 
                if (entry.pmv > 0.5) pmvColor = "var(--hot)"; 

                tr.innerHTML = `
                    <td style="color: #555;">${entry.date}</td>
                    <td><strong>${entry.t_air}°C</strong></td>
                    <td style="color: #7f8c8d;">${entry.t_ext}°C</td>
                    <td style="color: ${pmvColor}; font-weight: bold;">${entry.pmv}</td>
                `;
                historyTableBody.appendChild(tr);
            });
        }
        loadHistory();

        if (saveHistoryBtn) {
            saveHistoryBtn.addEventListener('click', () => {
                const allHistory = JSON.parse(localStorage.getItem('SOLSTICE_HISTORY')) || [];
                allHistory.push({
                    zoneId: zoneId,
                    date: new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
                    t_air: data.t_air_int.toFixed(1),
                    t_ext: data.t_ext.toFixed(1),
                    pmv: data.pmv.toFixed(2)
                });
                localStorage.setItem('SOLSTICE_HISTORY', JSON.stringify(allHistory));
                saveHistoryBtn.textContent = "✅ Mesure enregistrée !";
                saveHistoryBtn.disabled = true; 
                loadHistory();
            });
        }
    } catch (error) { console.error("Erreur critique détectée :", error); }
});