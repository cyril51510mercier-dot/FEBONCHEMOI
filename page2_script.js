/**
 * ==================================================================
 * FÉBONCHÉMOI - LE COACH EXPERT & FINANCIER (V5)
 * ==================================================================
 */

document.addEventListener('DOMContentLoaded', function() {

    // 1. RÉCUPÉRATION DES DONNÉES (Session & Base de données Experte)
    const zoneId = sessionStorage.getItem('currentZoneId');
    const houseConfig = JSON.parse(localStorage.getItem('HOUSE_CONFIG')) || {};
    const zone = houseConfig[zoneId] || null;

    const data = {
        pmv: parseFloat(sessionStorage.getItem('calculatedPMV')),
        t_op: parseFloat(sessionStorage.getItem('calculatedOperativeTemp')),
        clo: parseFloat(sessionStorage.getItem('calculatedClo')),
        t_air_int: parseFloat(sessionStorage.getItem('indoorAirTemp')),
        rh_int: parseFloat(sessionStorage.getItem('indoorHumidity')),
        t_ext: parseFloat(sessionStorage.getItem('outdoorTemp')),
        rh_ext: parseFloat(sessionStorage.getItem('outdoorHumidity')),
        wind_ext: parseFloat(sessionStorage.getItem('outdoorWind')) || 0,
        sun_status: sessionStorage.getItem('sunshineStatus') || 'Clouds',
        
        // Données expertes de la zone
        insulation: sessionStorage.getItem('buildingInsulation') || 'medium', 
        roomType: sessionStorage.getItem('roomType') || 'living',
        heatingSystem: zone ? zone.heatSys : 'convection',
        area: zone ? parseFloat(zone.area) : 20
    };

        // --- NOUVEAU : CALCUL DE L'HUMIDITÉ ABSOLUE (Formule de Tetens en g/m³) ---
    function getAbsoluteHumidity(t, rh) {
        // Pression de vapeur saturante (hPa)
        const pSat = 6.112 * Math.exp((17.67 * t) / (t + 243.5)); 
        // Pression de vapeur réelle
        const pVap = pSat * (rh / 100.0); 
        // Humidité absolue en g/m³
        return (2.16679 * pVap * 100.0) / (273.15 + t); 
    }

    const ah_int = getAbsoluteHumidity(data.t_air_int, data.rh_int);
    const ah_ext = getAbsoluteHumidity(data.t_ext, data.rh_ext);
    

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
    
    // Règle thermique standard : 1°C en moins = 7% d'économie de chauffage
    // On adapte le texte selon le type d'émetteur
    let heatSysName = "votre chauffage";
    if (data.heatingSystem === 'convection') heatSysName = "vos convecteurs électriques";
    if (data.heatingSystem === 'radiator_steel' || data.heatingSystem === 'radiator_cast') heatSysName = "vos radiateurs";
    if (data.heatingSystem === 'floor') heatSysName = "votre plancher chauffant";

    const needsHeat = data.pmv < -0.5;
    const needsCooling = data.pmv > 0.5;
    // NOUVEAU CODE DYNAMIQUE :
const isSunny = data.sun_status && data.sun_status.toLowerCase().includes('clear');
const now = new Date().getTime(); // L'heure exacte en millisecondes

// On récupère les heures du soleil de l'API (avec une sécurité par défaut si l'API a échoué)
const sunrise = parseInt(sessionStorage.getItem('sunriseTime')) || new Date().setHours(8,0,0,0);
const sunset = parseInt(sessionStorage.getItem('sunsetTime')) || new Date().setHours(19,0,0,0);

// Il fait nuit si l'heure actuelle est avant le lever OU après le coucher du soleil
const isNight = now < sunrise || now > sunset;
    

        // --- A. HYGIÈNE ET HUMIDITÉ (Croisement Absolu) ---
    if (data.rh_int > 65) {
        if (ah_ext < ah_int) {
            pushRec("type-air", "💨 Assèchement Gratuit", 
            `Alerte Humidité (${data.rh_int}%). L'air extérieur est plus sec (${ah_ext.toFixed(1)} g/m³ dehors vs ${ah_int.toFixed(1)} g/m³ dedans). <strong>Ouvrez les fenêtres 10 min !</strong> L'air sec chauffera plus vite ensuite.`);
        } else {
            pushRec("type-warning", "🌧️ Confinement Requis", 
            `Alerte Humidité (${data.rh_int}%). Ne ventilez pas par les fenêtres ! L'air extérieur est plus chargé en eau (${ah_ext.toFixed(1)} g/m³). Laissez la VMC agir ou utilisez un déshumidificateur.`);
        }
    }

    // --- B. FREE COOLING & SURCHAUFFE (Croisement Température) ---
    if (needsCooling) {
        if (data.t_ext < data.t_air_int - 1) {
            // S'il fait plus frais dehors, on ouvre (Free Cooling)
            pushRec("type-air", "🌬️ Climatisation Naturelle", 
            `Vous avez chaud (PMV > 0.5) et il fait plus frais dehors (${data.t_ext}°C). <strong>Ouvrez grand les fenêtres</strong> pour rafraîchir la pièce gratuitement !`);
        } else if (data.t_ext < 15) {
            // S'il fait froid dehors, c'est le chauffage qui est trop fort
            const diffDeg = Math.min(2, Math.floor(data.t_air_int - 20)); 
            if (diffDeg > 0) {
                const savings = diffDeg * 7;
                pushRec("type-eco", "💰 Chauffage Excessif", 
                `Il fait froid dehors (${data.t_ext}°C) mais vous avez chaud dedans. Baissez le thermostat de ${diffDeg}°C.<br>
                <strong style="color:#27ae60;">Gain financier : ~${savings}% d'économie sur la consommation de cette zone.</strong>`);
            }
        } else {
            // S'il fait chaud dedans ET encore plus chaud dehors (Canicule)
             pushRec("type-heat", "🥵 Chaleur Bloquée", 
            `Vous avez chaud mais il fait encore plus chaud dehors (${data.t_ext}°C). Gardez fenêtres et volets fermés !`);
        }
    }


    // --- C. SOLLICITATION DU CHAUFFAGE (Froid) ---
    if (needsHeat) {
        // Apports Solaires Passifs
        if (isSunny && !isNight) {
            pushRec("type-sun", "☀️ Chauffage Gratuit", "Ouvrez grand les rideaux ! Laissez le soleil chauffer la pièce avant d'allumer le chauffage.");
        } 
        
        // Comportement Vestimentaire (Le Nudge)
        if (data.clo < 1.0) {
            pushRec("type-eco", "👕 Le 'Pull Rentable'", 
            `Vous avez frais, mais vous êtes légèrement vêtu. Au lieu de monter ${heatSysName}, ajoutez une couche (pull).<br>
            <strong style="color:#27ae60;">Gain financier : Éviter de monter de 1°C sauve 7% d'énergie.</strong>`);
        } 
        // L'habitant a froid MALGRÉ le fait qu'il soit bien habillé (Clo >= 1.0)
        else {
            if (data.heatingSystem === 'floor') {
                pushRec("type-heat", "🌡️ Anticipation requise", `Vous avez frais. ⚠️ Vu votre plancher chauffant (très forte inertie), la chaleur mettra plusieurs heures à se faire sentir. Montez le thermostat de 1°C maximum et patientez.`);
            } else {
                pushRec("type-heat", "🌡️ Chauffage Requis", `Le confort n'est pas atteint (vous avez légèrement frais). Même avec une tenue adaptée, vous pouvez augmenter ${heatSysName} d'environ 1°C.`);
            }
        }
    }


    // --- D. SPÉCIFIQUE NUIT / CHAMBRE ---
    if (data.roomType === 'bedroom' && !needsCooling) {
        pushRec("type-eco", "🛏️ Mode Nuit Rentable", 
        `Dans une chambre, la température idéale pour dormir est de 16°C à 17°C (votre couette isole).<br>
        <strong style="color:#27ae60;">Gain financier : Réduire la nuit peut baisser la facture globale de la maison de 10 à 15%.</strong>`);
    }

    // --- RENDU FINAL ---
    function pushRec(type, title, text) {
        recommendations.push({ type, title, text });
    }

    const container = document.getElementById('recommendations-container');
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

// ==================================================================
    // 4. GESTION DE L'HISTORIQUE (PHASE 6)
    // ==================================================================
    
    const historyTableBody = document.getElementById('historyTableBody');
    const saveHistoryBtn = document.getElementById('saveHistoryBtn');
    
    // Fonction pour charger et afficher l'historique de la zone courante
    function loadHistory() {
        const allHistory = JSON.parse(localStorage.getItem('COMFORT_HISTORY')) || [];
        // On filtre pour ne garder que l'historique de la zone actuelle
        const zoneHistory = allHistory.filter(entry => entry.zoneId === zoneId);
        
        historyTableBody.innerHTML = ''; // On vide le tableau
        
        if (zoneHistory.length === 0) {
            historyTableBody.innerHTML = '<tr><td colspan="4" style="padding: 10px; text-align: center; color: #7f8c8d; font-style: italic;">Aucune mesure enregistrée pour cette zone.</td></tr>';
            return;
        }

        // On affiche les 5 dernières mesures (en inversant l'ordre pour avoir la plus récente en haut)
        const recentHistory = zoneHistory.slice(-5).reverse();

        recentHistory.forEach(entry => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = "1px solid #eee";
            
            // Code couleur pour le PMV dans l'historique
            let pmvColor = "#28a745"; // Vert par défaut
            if (entry.pmv < -0.5) pmvColor = "#007bff"; // Bleu si froid
            if (entry.pmv > 0.5) pmvColor = "#dc3545"; // Rouge si chaud

            tr.innerHTML = `
                <td style="padding: 10px; color: #555;">${entry.date}</td>
                <td style="padding: 10px;"><strong>${entry.t_air}°C</strong></td>
                <td style="padding: 10px; color: #7f8c8d;">${entry.t_ext}°C</td>
                <td style="padding: 10px; color: ${pmvColor}; font-weight: bold;">${entry.pmv}</td>
            `;
            historyTableBody.appendChild(tr);
        });
    }

    // Afficher l'historique au chargement de la page
    loadHistory();

    // Action du bouton Sauvegarder
    if (saveHistoryBtn) {
        saveHistoryBtn.addEventListener('click', () => {
            const allHistory = JSON.parse(localStorage.getItem('COMFORT_HISTORY')) || [];
            
            // Création de la nouvelle entrée
            const newEntry = {
                zoneId: zoneId,
                date: new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
                t_air: data.t_air_int.toFixed(1),
                t_ext: data.t_ext.toFixed(1),
                pmv: data.pmv.toFixed(2)
            };

            // Ajout et sauvegarde
            allHistory.push(newEntry);
            localStorage.setItem('COMFORT_HISTORY', JSON.stringify(allHistory));
            
            // Retour visuel
            saveHistoryBtn.textContent = "✅ Bilan enregistré !";
            saveHistoryBtn.style.backgroundColor = "#27ae60";
            saveHistoryBtn.disabled = true; // Empêche de cliquer 10 fois de suite
            
            // Recharger le tableau pour voir la nouvelle ligne
            loadHistory();
        });
    }


});



