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

        if (zone) {
            // 1. Gestion de l'humidité
            if (data.rh_int > 70) {
                let action_vent = "Aérez la pièce.";
                if (zone.vmcSys === 'acceleree') action_vent = "Passez la VMC en mode accéléré pour extraire l'humidité.";
                if (zone.windows && zone.windows[0].vent !== 'fixe') action_vent = `Ouvrez la fenêtre en position ${zone.windows[0].vent} pendant 5 minutes.`;
                pushRec("type-air", "💨 Urgence Humidité (>70%)", action_vent);
            }

            // 2. Besoin de Refroidissement (L'ÉTÉ)
            if (needsCooling) {
                if (data.t_ext < data.t_air_int && zone.windows.some(w => w.vent !== 'fixe')) {
                    pushRec("type-cool", "🌬️ Free-cooling", `Il fait plus frais dehors (${data.t_ext}°C). Ouvrez vos fenêtres pour décharger la chaleur accumulée.`);
                }
                
                if (isSunny && data.t_ext >= data.t_air_int && zone.windows) {
                    const hasExternalShutter = zone.windows.some(w => w.shutter.includes('roulant') || w.shutter === 'battant_bois' || w.shutter === 'store_banne');
                    if(hasExternalShutter) {
                        pushRec("type-sun", "🛡️ Bouclier Solaire", "Baissez vos volets/stores extérieurs. Ils sont les seuls capables de bloquer les infrarouges avant le vitrage.");
                    } else if (zone.windows.some(w => w.glass === 'single')) {
                        pushRec("type-hot", "⚠️ Vitrage Critique", "Vous possédez un simple vitrage sans protection extérieure : fermez immédiatement les rideaux intérieurs pour limiter l'effet de serre, même si leur efficacité est faible.");
                    }
                }

                if (zone.fanSys !== 'aucun') {
                    pushRec("type-eco", "🌪️ Brassage d'air", `Allumez votre ventilateur (${zone.fanSys}). La vitesse de l'air augmente votre zone de confort sans utiliser le compresseur d'une clim.`);
                } else if (zone.coolingSys !== 'aucun') {
                    let conseilClim = "Allumez la climatisation.";
                    if(zone.coolingSys === 'clim_mobile') conseilClim = "Votre clim mobile monobloc crée une dépression et aspire l'air chaud de l'extérieur. Vérifiez l'étanchéité du passage de tuyau.";
                    pushRec("type-cool", "❄️ Refroidissement", conseilClim);
                }
            }

            // 3. Besoin de Chauffage (L'HIVER)
            if (needsHeat) {
                if (isSunny && data.t_ext < data.t_air_int) {
                    pushRec("type-sun", "☀️ Chauffage Solaire", "Ouvrez grand vos protections solaires ! Le soleil va chauffer gratuitement la pièce.");
                }
                
                if (zone.usages.includes('bedroom')) {
                    pushRec("type-eco", "🛏️ Confort Nocturne", "Dans une chambre, 17°C suffisent sous la couette. Ne surchauffez pas.");
                } else {
                    let heatMsg = "Vous pouvez augmenter le chauffage.";
                    if (zone.heatSys === 'floor') heatMsg = "Augmentez légèrement le thermostat. ⚠️ Vu votre plancher chauffant (très forte inertie), la chaleur mettra plusieurs heures à se faire sentir. Ne le poussez pas à fond !";
                    pushRec("type-heat", "🔥 Demande de Chaleur", heatMsg);
                }
            }
        }

        function pushRec(type, title, text) { recommendations.push({ type, title, text }); }

        const container = document.getElementById('recommendations-container');
        if (container) {
            container.innerHTML = ''; 
            if (recommendations.length === 0) {
                container.innerHTML = '<div class="advice-card type-eco"><div class="advice-title">✅ Équilibre Parfait</div><p>Votre confort est optimal.</p></div>';
            } else {
                recommendations.forEach(rec => {
                    const div = document.createElement('div');
                    div.className = `advice-card ${rec.type}`;
                    div.innerHTML = `<div class="advice-title">${rec.title}</div><p>${rec.text}</p>`;
                    container.appendChild(div);
                });
            }
        }

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