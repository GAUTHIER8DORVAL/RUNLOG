/**
 * RunLog — notifications.js
 * Notifie les nouvelles courses des amis via Realtime Supabase.
 * Persiste les compteurs dans localStorage pour survivre aux changements de page.
 */

console.log("[RunLog] notifications.js chargé");

// ─── PERSISTANCE localStorage ─────────────────────────────────────────────────

function lireNotifs() {
  try { return JSON.parse(localStorage.getItem('runlog_notifs') || '{}'); }
  catch(e) { return {}; }
}

function sauvegarderNotifs(obj) {
  try { localStorage.setItem('runlog_notifs', JSON.stringify(obj)); } catch(e) {}
}

function incrementerNotifAmi(amiId) {
  var notifs = lireNotifs();
  notifs[amiId] = (notifs[amiId] || 0) + 1;
  sauvegarderNotifs(notifs);
}

// ─── API PUBLIQUE ─────────────────────────────────────────────────────────────

window.supprimerNotifAmi = function(amiId) {
  var notifs = lireNotifs();
  delete notifs[amiId];
  sauvegarderNotifs(notifs);
  rafraichirTousLesBadges();
};

window.supprimerToutesLesNotifsAmis = function() {
  sauvegarderNotifs({});
  rafraichirTousLesBadges();
};

window.runlogRefreshNotif = function() {
  rafraichirTousLesBadges();
};

// ─── RENDU DES BADGES ─────────────────────────────────────────────────────────

function rafraichirTousLesBadges() {
  var notifs = lireNotifs();
  var total  = Object.values(notifs).reduce(function(a, b){ return a + b; }, 0);

  // 1. Badge nav "Profil" — cherche tous les liens nav susceptibles de pointer vers profil
  var lienProfil = document.querySelector('nav a[href*="profile"], nav a[href*="profil"]');
  majBadgeElement(lienProfil, total, 'runlog-badge-nav');

  // 2. Badge bouton amis sur la page profil
  var btnAmis = document.querySelector('.social-badge[href*="liste-amis"]');
  majBadgeElement(btnAmis, total, 'runlog-badge-btn-amis');

  // 3. Badge onglet "Amis" sur liste-amis.html
  var tabAmis = document.getElementById('tab-amis');
  majBadgeElement(tabAmis, total, 'runlog-badge-tab-amis');

  // 4. Badges individuels sur chaque carte ami
  Object.keys(notifs).forEach(function(amiId) {
    var count = notifs[amiId];
    var carte = document.querySelector('[data-id="' + amiId + '"]');
    if (carte) {
      var zoneInfo = carte.querySelector('.friend-info');
      majBadgeElement(zoneInfo, count, 'runlog-badge-ami-' + amiId);
    }
  });

  // Nettoyer les badges d'amis qui n'ont plus de notifs
  document.querySelectorAll('[class*="runlog-badge-ami-"]').forEach(function(badge) {
    var cls = Array.from(badge.classList).find(function(c){ return c.startsWith('runlog-badge-ami-'); });
    if (!cls) return;
    var amiId = cls.replace('runlog-badge-ami-', '');
    if (!notifs[amiId] || notifs[amiId] === 0) badge.remove();
  });
}

function majBadgeElement(parent, count, className) {
  if (!parent) return;
  var badge = parent.querySelector('.' + className);
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = className;
      if (className === 'runlog-badge-nav') {
        parent.style.position = 'relative';
        parent.style.display  = 'inline-flex';
        Object.assign(badge.style, {
          position:       'absolute',
          top:            '-7px',
          right:          '-10px',
          background:     '#ff4a4a',
          color:          '#fff',
          fontFamily:     "'Barlow Condensed', sans-serif",
          fontWeight:     '900',
          fontSize:       '0.65rem',
          lineHeight:     '1',
          minWidth:       '16px',
          height:         '16px',
          padding:        '0 4px',
          borderRadius:   '8px',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          pointerEvents:  'none',
          zIndex:         '10',
          animation:      'notif-pulse 2s ease-in-out infinite',
        });
      } else {
        Object.assign(badge.style, {
          display:       'inline-block',
          background:    '#ff4a4a',
          color:         '#fff',
          borderRadius:  '9999px',
          padding:       '2px 6px',
          fontSize:      '10px',
          fontWeight:    'bold',
          marginLeft:    '6px',
          verticalAlign: 'middle',
          animation:     'notif-pulse 2s ease-in-out infinite',
        });
      }
      parent.appendChild(badge);
    }
    badge.textContent = count > 9 ? '9+' : count;
  } else {
    if (badge) badge.remove();
  }
}

// ─── REALTIME SUPABASE ────────────────────────────────────────────────────────

var _realtimeActif = false;

function activerRealtime(client) {
  if (_realtimeActif) return; // éviter les doubles abonnements
  _realtimeActif = true;

  client.auth.getUser().then(function(res) {
    var user = res.data && res.data.user;
    if (!user) { _realtimeActif = false; return; }

    console.log("[RunLog] Realtime actif pour :", user.email);

    if (window._runlogCanal) {
      try { window._runlogCanal.unsubscribe(); } catch(e) {}
    }

    window._runlogCanal = client
      .channel('runlog-notifs-courses')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'courses' },
        async function(payload) {
          var course = payload.new;
          if (!course || course.user_id === user.id) return;

          try {
            var verif = await client
              .from('amis')
              .select('id', { count: 'exact', head: true })
              .eq('statut', 'accepte')
              .or(
                'and(demandeur_id.eq.' + course.user_id + ',receveur_id.eq.' + user.id + '),' +
                'and(demandeur_id.eq.' + user.id + ',receveur_id.eq.' + course.user_id + ')'
              );

            if (!verif.error && verif.count > 0) {
              console.log("[RunLog] Nouvelle course d'un ami :", course.user_id);
              incrementerNotifAmi(course.user_id);
              rafraichirTousLesBadges();
            }
          } catch(err) {
            console.error("[RunLog] Erreur vérification ami :", err);
          }
        }
      )
      .subscribe();
  });
}

// ─── DÉMARRAGE ────────────────────────────────────────────────────────────────
// CORRECTION PRINCIPALE : on ne dépend plus uniquement de supabaseClientInstance.
// On essaie d'abord window.supabaseClientInstance, et si indisponible on crée
// nous-mêmes le client depuis SUPABASE_URL / SUPABASE_ANON_KEY définis dans
// supabase-config.js (chargé avant nous sur toutes les pages).

function demarrerRealtime() {
  // Cas 1 : le client a déjà été créé par la page courante
  if (window.supabaseClientInstance) {
    activerRealtime(window.supabaseClientInstance);
    return;
  }
  // Cas 2 : la page a les variables de config mais n'a pas créé de client
  if (typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_ANON_KEY !== 'undefined' && window.supabase) {
    var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.supabaseClientInstance = client;
    activerRealtime(client);
    return;
  }
  // Cas 3 : attendre que l'un ou l'autre soit disponible (max 10s)
  var tentatives = 0;
  var intervalle = setInterval(function() {
    tentatives++;
    if (window.supabaseClientInstance) {
      clearInterval(intervalle);
      activerRealtime(window.supabaseClientInstance);
      return;
    }
    if (typeof SUPABASE_URL !== 'undefined' && typeof SUPABASE_ANON_KEY !== 'undefined' && window.supabase) {
      clearInterval(intervalle);
      var c = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      window.supabaseClientInstance = c;
      activerRealtime(c);
      return;
    }
    if (tentatives > 100) {
      clearInterval(intervalle);
      console.warn("[RunLog] Supabase introuvable après 10s, Realtime désactivé.");
    }
  }, 100);
}

// Premier rendu des badges dès que le DOM est prêt
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() {
    rafraichirTousLesBadges();
    demarrerRealtime();
  });
} else {
  rafraichirTousLesBadges();
  demarrerRealtime();
}

// Re-rendu léger toutes les 2s pour les pages où le DOM change dynamiquement
setInterval(rafraichirTousLesBadges, 2000);
