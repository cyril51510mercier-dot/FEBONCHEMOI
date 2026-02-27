/**
 * ==================================================================
 * FÉBONCHÉMOI - LE COACH EXPERT & FINANCIER (Sécurisé)
 * ==================================================================
 */

document.addEventListener('DOMContentLoaded', function() {
    try {
        // 1. RÉCUPÉRATION DES DONNÉES (Session & Base de données Experte)
        const zoneId = sessionStorage.getItem('currentZoneId');
        const savedConfig = localStorage.getItem('HOUSE_CONFIG');
        const houseConfig = savedConfig ? JSON.parse(savedConfig) : {};
        const zone = houseConfig[zoneId] || null;

        // Sécurisation : on force parseFloat à lire 0 si la donnée est vide ou introuvable
        const data = {
            pmv: parseFloat(sessionStorage.getItem('calculatedPMV')) || 0,
            t_op: parseFloat(sessionStorage.getItem('calculatedOperativeTemp')) || 20,
            clo: parseFloat(sessionStorage.getItem('calculatedClo')) || 1.0,
            t_air_int: parseFloat(sessionStorage.getItem('indoorAirTemp')) || 20,
            rh_int: parseFloat(sessionStorage.getItem('indoorHumidity')) || 50,
            t_ext: parseFloat(sessionStorage.getItem('outdoorTemp')) || 15,
            rh_ext: parseFloat(sessionStorage.getItem('outdoorHumidity')) || 50,
            wind_ext: parseFloat(sessionStorage.getItem('outdoorWind')) || 0,
            sun_status: sessionStorage.getItem('sunshineStatus') || 'Clouds',
            
            insulation: sessionStorage.getItem('buildingInsulation') || 'medium', 
            roomType: sessionStorage.getItem('roomType') || 'living',
            heatingSystem: zone ? zone.heatSys : 'convection',
            area: zone ? parseFloat(zone.area) : 20
        };

        // 2. AFFICHAGE DES VALEURS RÉSUMÉES DANS LE HTML
        function safeUpdate(id, text, color = null) {
            const el = document.getElementById(id);
            if (el) {
                el.textContent = text;
                if (color) el.style.color = color;
            }
        }

        const pmvColor = data.pmv < -0.5 ? '#007bff' : (data.pmv > 0.5 ? '#dc3545' : '#28a745');
        safeUpdate('disp-pmv', data.pmv.toFixed(2), pmvColor);
        safeUpdate('disp-top', data.t_op.toFixed(1) + "°C");
        safeUpdate('disp-clo', data.clo.toFixed(1)); 
        safeUpdate('disp-rh', data.rh_int.toFixed(0) + "%");
        safeUpdate('disp-room', zone ? zone.name : "Zone Standard");

        let insulText = "Moyenne";
        if (data.insulation === 'high') insulText = "Forte (ITE/ITI)";
        if (data.insulation === 'low') insulText = "Faible";
        safeUpdate('disp-insul', insulText);

        // 3. MOTEUR DE RECOMMANDATIONS & CALCULS FINANCIERS
        const recommendations = [];
        let heatSysName = "votre chauffage";
        if (data.heatingSystem === 'convection') heatSysName = "vos convecteurs électriques";
        if (data.heatingSystem === 'radiator_steel' || data.heatingSystem === 'radiator_cast') heatSysName = "vos radiateurs";
        if (data.heatingSystem === 'floor') heatSysName = "votre plancher chauffant";

        const needsHeat = data.pmv < -0.5;
        const needsCooling = data.pmv > 0.5;
        const isSunny = data.sun_status && data.sun_status.toLowerCase().includes('clear');
        const now = new Date();
        const isNight = now.getHours() < 8 || now.getHours() > 19;

        if (data.rh_int > 70) {
            pushRec("type-air", "💨 Urgence Humidité", `Humidité critique (>70%). Ouvrez 5 min. L'air sec chauffe plus vite : vous économiserez sur ${heatSysName} ensuite.`);
        }

        if (needsCooling && data.t_ext < 15) {
            const diffDeg = Math.min(2, Math.floor(data.t_air_int - 20)); 
            if (diffDeg > 0) {
                const savings = diffDeg * 7;
                pushRec("type-eco", "💰 Chauffage Excessif", 
                `Vous avez chaud (PMV > 0.5) alors qu'il fait froid dehors. Baissez le thermostat de ${diffDeg}°C.<br>
                <strong style="color:#27ae60;">Gain financier : ~${savings}% d'économie sur la consommation de cette zone (${data.area} m²).</strong>`);
            }
        }

        if (needsHeat) {
            if (isSunny && !isNight) {
                pushRec("type-sun", "☀️ Chauffage Gratuit", "Ouvrez grand les rideaux ! Laissez le soleil chauffer la pièce avant d'allumer le chauffage.");
            } 
            if (data.clo < 1.0) {
                pushRec("type-eco", "👕 Le 'Pull Rentable'", 
                `Vous avez frais, mais vous êtes légèrement vêtu. Au lieu de monter ${heatSysName}, ajoutez une couche (pull).<br>
                <strong style="color:#27ae60;">Gain financier : Éviter de monter de 1°C sauve 7% d'énergie.</strong>`);
            } 
            else if (data.pmv < -1.0) {
                if (data.heatingSystem === 'floor') {
                    pushRec("type-heat", "🌡️ Anticipation requise", `Montez le thermostat. ⚠️ Vu votre plancher chauffant (très forte inertie), la chaleur mettra plusieurs heures à se faire sentir. Ne le poussez pas à fond !`);
                } else {
                    pushRec("type-heat", "🌡️ Chauffage Requis", `Le confort n'est pas atteint. Vous pouvez augmenter ${heatSysName} de 1°C.`);
                }
            }
        }

        if (data.roomType === 'bedroom' && !needsCooling) {
            pushRec("type-eco", "🛏️ Mode Nuit Rentable", 
            `Dans une chambre, la température idéale pour dormir est de 16°C à 17°C (votre couette isole).<br>
            <strong style="color:#27ae60;">Gain financier : Réduire la nuit peut baisser la facture globale de la maison de 10 à 15%.</strong>`);
        }

        function pushRec(type, title, text) {
            recommendations.push({ type, title, text });
        }

        const container = document.getElementById('recommendations-container');
        if (container) {
            container.innerHTML = ''; 
            if (recommendations.length === 0) {
                container.innerHTML = '<div class="advice-card type-eco"><div class="advice-title">✅ Bilan Parfait</div><p>Votre confort est optimal et votre gestion de l\'énergie est parfaite.</p></div>';
            } else {
                recommendations.forEach(rec => {
                    const div = document.createElement('div');
                    div.className = `advice-card ${rec.type}`;
                    div.innerHTML = `<div class="advice-title">${rec.title}</div><p>${rec.text}</p>`;
                    container.appendChild(div);
                });
            }
        }

        // 4. GESTION DE L'HISTORIQUE
        const historyTableBody = document.getElementById('historyTableBody');
        const saveHistoryBtn = document.getElementById('saveHistoryBtn');
        
        function loadHistory() {
            if (!historyTableBody) return;
            const allHistory = JSON.parse(localStorage.getItem('COMFORT_HISTORY')) || [];
            const zoneHistory = allHistory.filter(entry => entry.zoneId === zoneId);
            
            historyTableBody.innerHTML = ''; 
            
            if (zoneHistory.length === 0) {
                historyTableBody.innerHTML = '<tr><td colspan="4" style="padding: 10px; text-align: center; color: #7f8c8d; font-style: italic;">Aucune mesure enregistrée.</td></tr>';
                return;
            }

            const recentHistory = zoneHistory.slice(-5).reverse();
            recentHistory.forEach(entry => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = "1px solid #eee";
                let pmvColor = "#28a745"; 
                if (entry.pmv < -0.5) pmvColor = "#007bff"; 
                if (entry.pmv > 0.5) pmvColor = "#dc3545"; 

                tr.innerHTML = `
                    <td style="padding: 10px; color: #555;">${entry.date}</td>
                    <td style="padding: 10px;"><strong>${entry.t_air}°C</strong></td>
                    <td style="padding: 10px; color: #7f8c8d;">${entry.t_ext}°C</td>
                    <td style="padding: 10px; color: ${pmvColor}; font-weight: bold;">${entry.pmv}</td>
                `;
                historyTableBody.appendChild(tr);
            });
        }

        loadHistory();

        if (saveHistoryBtn) {
            saveHistoryBtn.addEventListener('click', () => {
                const allHistory = JSON.parse(localStorage.getItem('COMFORT_HISTORY')) || [];
                const newEntry = {
                    zoneId: zoneId,
                    date: new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
                    t_air: data.t_air_int.toFixed(1),
                    t_ext: data.t_ext.toFixed(1),
                    pmv: data.pmv.toFixed(2)
                };
                allHistory.push(newEntry);
                localStorage.setItem('COMFORT_HISTORY', JSON.stringify(allHistory));
                
                saveHistoryBtn.textContent = "✅ Bilan enregistré !";
                saveHistoryBtn.style.backgroundColor = "#27ae60";
                saveHistoryBtn.disabled = true; 
                
                loadHistory();
            });
        }
    } catch (error) {
        console.error("Erreur critique détectée :", error);
    }
});
