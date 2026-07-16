/* =====================================================================
 * flkr — app.js (Vanilla JS, no dependencies)
 * ---------------------------------------------------------------------
 * Responsibilities:
 *   1. Load FACTS + ADS datasets.
 *   2. Build a feed of cards (1 ad after every 5 facts).
 *   3. Lazy-load images via IntersectionObserver (+200px rootMargin).
 *   4. Shimmer placeholder, broken-image gradient fallback.
 *   5. Sticky header: brand, heart toggle, search (200ms debounce),
 *      horizontal category chips.
 *   6. Gestures:
 *        - Tap card -> fact overlay slides up
 *        - Swipe right (>60px) -> like
 *        - Swipe left  (>60px) -> share
 *        - Long-press 700ms -> copy fact + 10ms haptic + toast
 *   7. localStorage: likes set + daily view counter (incremented per session).
 *   8. Admin modal: login (password + OTP), then JSON paste to add fact.
 *        - JSON parse error -> red border + toast.
 *   9. Offline-first: viewed images + core files cached via Cache API
 *      and a Service Worker (registered in index.html).
 * ===================================================================== */

(function () {
  'use strict';

  // -------------------- 0. Constants & state --------------------
  var IMG_BASE       = 'https://picsum.photos/seed/';
  var IMG_W          = 600;
  var IMG_H          = 700;
  var FALLBACK_SEED  = 'flkr-fallback';

  var SWIPE_THRESHOLD = 60;   // px
  var LONGPRESS_MS    = 700;
  var HAPTIC_MS       = 10;
  var DEBOUNCE_MS     = 200;
  var ADS_EVERY       = 5;

  var LS_LIKES        = 'flkr_likes';      // array of fact ids
  var LS_VIEWS        = 'flkr_views';      // { date: 'YYYY-MM-DD', count: N }

  var API_BASE        = (location.origin && location.port === '8787')
                        ? location.origin
                        : (location.origin.replace(/:\d+$/, '') + ':8787');

  var state = {
    facts:        [],  // source of truth
    ads:          [],
    feed:         [],  // merged: [fact|ad, fact|ad, ...]
    filtered:     [],  // currently visible slice
    activeCat:    'All',
    likesOnly:    false,
    query:        '',
    likes:        loadLikes(),
    adminToken:   null,
  };

  // -------------------- 1. DOM refs --------------------
  var $feed     = document.getElementById('feed');
  var $end      = document.getElementById('feedEnd');
  var $chips    = document.getElementById('chips');
  var $search   = document.getElementById('search');
  var $sClear   = document.getElementById('searchClear');
  var $likesT   = document.getElementById('likesToggle');
  var $adminBtn = document.getElementById('adminBtn');
  var $adminMod = document.getElementById('adminModal');
  var $overlay  = document.getElementById('overlay');
  var $oText    = document.getElementById('overlayText');
  var $oSrc     = document.getElementById('overlaySource');
  var $oCopy    = document.getElementById('overlayCopy');
  var $oShare   = document.getElementById('overlayShare');
  var $toast    = document.getElementById('toast');

  // -------------------- 2. Utilities --------------------
  function loadLikes() {
    try {
      var raw = localStorage.getItem(LS_LIKES);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function saveLikes() {
    try { localStorage.setItem(LS_LIKES, JSON.stringify(state.likes)); } catch (e) {}
  }
  function isLiked(id) { return state.likes.indexOf(id) !== -1; }
  function toggleLike(id) {
    if (isLiked(id)) {
      var i = state.likes.indexOf(id);
      state.likes.splice(i, 1);
    } else {
      state.likes.push(id);
    }
    saveLikes();
    return isLiked(id);
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function bumpDailyViews() {
    var views;
    try { views = JSON.parse(localStorage.getItem(LS_VIEWS) || '{}'); }
    catch (e) { views = {}; }
    var today = todayStr();
    if (views.date !== today) {
      views = { date: today, count: 0 };
    }
    views.count += 1;
    try { localStorage.setItem(LS_VIEWS, JSON.stringify(views)); } catch (e) {}
    return views.count;
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var ctx = this, args = arguments;
      if (t) clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function haptic(ms) {
    if (navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) {}
    }
  }

  var toastTimer = null;
  function toast(msg, kind) {
    $toast.textContent = msg;
    $toast.className = 'toast is-show' + (kind ? ' toast--' + kind : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      $toast.className = 'toast' + (kind ? ' toast--' + kind : '');
    }, 2200);
  }

  function imageUrl(seed) {
    return IMG_BASE + encodeURIComponent(seed || FALLBACK_SEED) + '/' + IMG_W + '/' + IMG_H;
  }

  // -------------------- 3. Build the merged feed --------------------
  function buildFeed() {
    var feed = [];
    var factIdx = 0;
    var adIdx = 0;
    for (var i = 0; i < state.facts.length; i++) {
      feed.push({ kind: 'fact', fact: state.facts[i] });
      factIdx++;
      // Insert one ad after every `ADS_EVERY` facts.
      if (factIdx % ADS_EVERY === 0 && adIdx < state.ads.length) {
        feed.push({ kind: 'ad', ad: state.ads[adIdx] });
        adIdx++;
        // Cycle ads if there are more slots than ads.
        if (adIdx >= state.ads.length) adIdx = 0;
      }
    }
    state.feed = feed;
  }

  // -------------------- 4. Filtering --------------------
  function applyFilters() {
    var q = state.query.toLowerCase().trim();
    var out = [];
    for (var i = 0; i < state.feed.length; i++) {
      var item = state.feed[i];
      if (item.kind === 'ad') {
        // Keep ads unless a search is active (search filters them out for relevance).
        if (!q) out.push(item);
        continue;
      }
      var f = item.fact;
      if (state.likesOnly && !isLiked(f.id)) continue;
      if (state.activeCat !== 'All' && f.category !== state.activeCat) continue;
      if (q && f.text.toLowerCase().indexOf(q) === -1 && f.category.toLowerCase().indexOf(q) === -1) continue;
      out.push(item);
    }
    state.filtered = out;
    renderFeed();
  }

  // -------------------- 5. Render --------------------
  function renderFeed() {
    // Simple, full re-render. The dataset is bounded (1000 facts) and we
    // also use IntersectionObserver for images so initial paint is cheap.
    $feed.innerHTML = '';
    if (state.filtered.length === 0) {
      $end.hidden = false;
      $end.querySelector('p').textContent =
        'No facts match your filters. Try clearing the search or the likes filter.';
      return;
    }
    $end.hidden = true;

    var frag = document.createDocumentFragment();
    for (var i = 0; i < state.filtered.length; i++) {
      frag.appendChild(buildCard(state.filtered[i]));
    }
    $feed.appendChild(frag);

    // Observe newly inserted images.
    observeImages();
  }

  function buildCard(item) {
    if (item.kind === 'ad') return buildAdCard(item.ad);
    return buildFactCard(item.fact);
  }

  function buildFactCard(fact) {
    var card = document.createElement('article');
    card.className = 'card';
    card.dataset.id = String(fact.id);
    card.dataset.kind = 'fact';
    if (isLiked(fact.id)) card.classList.add('is-liked');

    // Badge
    var badge = document.createElement('div');
    badge.className = 'card__badge card__badge--fact';
    badge.textContent = 'FACT';
    card.appendChild(badge);

    // Media (image + shimmer)
    var media = document.createElement('div');
    media.className = 'card__media';
    var img = document.createElement('img');
    img.className = 'card__img';
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.dataset.src = imageUrl(fact.imageSeed);
    img.addEventListener('load', function () { img.classList.add('is-loaded'); });
    img.addEventListener('error', function () {
      // Try a fallback seed once. If that also fails, switch to CSS gradient.
      if (img.dataset.fallbackTried !== '1') {
        img.dataset.fallbackTried = '1';
        img.dataset.src = imageUrl(FALLBACK_SEED + '-' + fact.id);
        io.observe(img);
      } else {
        media.classList.add('is-fallback');
        img.remove();
      }
    });
    media.appendChild(img);
    card.appendChild(media);

    // Body
    var body = document.createElement('div');
    body.className = 'card__body';

    var cat = document.createElement('div');
    cat.className = 'card__category';
    cat.textContent = fact.category;
    body.appendChild(cat);

    var p = document.createElement('p');
    p.className = 'card__text';
    p.textContent = fact.text;
    body.appendChild(p);

    card.appendChild(body);

    // Actions: like on the left, share on the right — they can never overlap
    // because they are pinned to opposite edges of the card.
    var actions = document.createElement('div');
    actions.className = 'card__actions';

    var likeBtn = document.createElement('button');
    likeBtn.className = 'card__action' + (isLiked(fact.id) ? ' is-liked' : '');
    likeBtn.dataset.action = 'like';
    likeBtn.setAttribute('aria-label', isLiked(fact.id) ? 'Unlike fact' : 'Like fact');
    likeBtn.innerHTML = heartSVG();
    likeBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var nowLiked = toggleLike(fact.id);
      likeBtn.classList.toggle('is-liked', nowLiked);
      likeBtn.setAttribute('aria-label', nowLiked ? 'Unlike fact' : 'Like fact');
      card.classList.toggle('is-liked', nowLiked);
      haptic(HAPTIC_MS);
      toast(nowLiked ? 'Liked' : 'Unliked', 'success');
      if (state.likesOnly && !nowLiked) applyFilters();
    });
    actions.appendChild(likeBtn);

    var shareBtn = document.createElement('button');
    shareBtn.className = 'card__action';
    shareBtn.dataset.action = 'share';
    shareBtn.setAttribute('aria-label', 'Share fact');
    shareBtn.innerHTML = shareSVG();
    shareBtn.addEventListener('click', function (ev) {
      ev.stopPropagation();
      shareFact(fact);
    });
    actions.appendChild(shareBtn);

    card.appendChild(actions);

    // Swipe hints (visual)
    var hintR = document.createElement('div');
    hintR.className = 'card__swipe-hint card__swipe-hint--right';
    hintR.textContent = '♥ LIKE';
    card.appendChild(hintR);
    var hintL = document.createElement('div');
    hintL.className = 'card__swipe-hint card__swipe-hint--left';
    hintL.textContent = 'SHARE →';
    card.appendChild(hintL);

    // Gestures
    bindCardGestures(card, fact);

    return card;
  }

  function buildAdCard(ad) {
    var card = document.createElement('article');
    card.className = 'card';
    card.dataset.kind = 'ad';

    var badge = document.createElement('div');
    badge.className = 'card__badge card__badge--sponsored';
    badge.textContent = 'SPONSORED';
    card.appendChild(badge);

    var media = document.createElement('div');
    media.className = 'card__media';
    var img = document.createElement('img');
    img.className = 'card__img';
    img.alt = ad.sponsor;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.dataset.src = imageUrl(ad.imageSeed);
    img.addEventListener('load', function () { img.classList.add('is-loaded'); });
    img.addEventListener('error', function () {
      if (img.dataset.fallbackTried !== '1') {
        img.dataset.fallbackTried = '1';
        img.dataset.src = imageUrl(FALLBACK_SEED + '-ad-' + ad.id);
        io.observe(img);
      } else {
        media.classList.add('is-fallback');
        img.remove();
      }
    });
    media.appendChild(img);
    card.appendChild(media);

    var body = document.createElement('div');
    body.className = 'card__body';

    var sp = document.createElement('div');
    sp.className = 'card__sponsor';
    sp.textContent = ad.sponsor;
    body.appendChild(sp);

    var h = document.createElement('p');
    h.className = 'card__text';
    h.textContent = ad.headline;
    body.appendChild(h);

    if (ad.body) {
      var b = document.createElement('p');
      b.className = 'card__text';
      b.style.opacity = '0.8';
      b.style.fontSize = '13px';
      b.style.marginTop = '6px';
      b.textContent = ad.body;
      body.appendChild(b);
    }

    var cta = document.createElement('a');
    cta.className = 'card__cta';
    cta.href = ad.ctaUrl;
    cta.target = '_blank';
    cta.rel = 'noopener noreferrer';
    cta.textContent = 'Learn more →';
    body.appendChild(cta);

    card.appendChild(body);

    // Ads don't get swipe, but tap should still open the CTA (handled by the
    // <a> tag itself). Prevent accidental long-press on ads.
    return card;
  }

  // -------------------- 6. SVG icons --------------------
  function heartSVG() {
    return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
           '<path d="M12 21s-7.5-4.6-10-9.3C.6 8.3 2.5 5 6 5c2 0 3.3 1 4 2 .7-1 2-2 4-2 3.5 0 5.4 3.3 4 6.7C19.5 16.4 12 21 12 21z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
           '</svg>';
  }
  function shareSVG() {
    return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
           '<circle cx="6" cy="12" r="2.5" fill="currentColor"/>' +
           '<circle cx="18" cy="6"  r="2.5" fill="currentColor"/>' +
           '<circle cx="18" cy="18" r="2.5" fill="currentColor"/>' +
           '<line x1="8" y1="11" x2="16" y2="7"  stroke="currentColor" stroke-width="1.8"/>' +
           '<line x1="8" y1="13" x2="16" y2="17" stroke="currentColor" stroke-width="1.8"/>' +
           '</svg>';
  }

  // -------------------- 7. IntersectionObserver (lazy load) --------------------
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      var img = entry.target;
      var src = img.dataset.src;
      if (!src || img.src) return;
      img.src = src;
      io.unobserve(img);
    });
  }, {
    root: null,
    rootMargin: '200px',   // preload 200px ahead
    threshold: 0.01,
  });

  function observeImages() {
    var imgs = $feed.querySelectorAll('img.card__img[data-src]:not([src])');
    for (var i = 0; i < imgs.length; i++) io.observe(imgs[i]);
  }

  // -------------------- 8. Gestures --------------------
  function bindCardGestures(card, fact) {
    var startX = 0, startY = 0, lastDx = 0, lastDy = 0;
    var dragging = false;
    var longPressTimer = null;
    var longPressFired = false;
    var movedSignificantly = false;

    function onDown(ev) {
      dragging = true;
      longPressFired = false;
      movedSignificantly = false;
      var p = pointOf(ev);
      startX = p.x; startY = p.y;
      lastDx = 0; lastDy = 0;
      card.classList.add('is-swiping');

      longPressTimer = setTimeout(function () {
        if (!movedSignificantly) {
          longPressFired = true;
          copyFact(fact);
        }
      }, LONGPRESS_MS);
    }

    function onMove(ev) {
      if (!dragging) return;
      var p = pointOf(ev);
      var dx = p.x - startX;
      var dy = p.y - startY;
      lastDx = dx; lastDy = dy;

      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        movedSignificantly = true;
        if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      }

      // Only horizontal drag matters; ignore vertical scroll.
      if (Math.abs(dx) > Math.abs(dy)) {
        if (ev.cancelable) ev.preventDefault();
        card.style.transform = 'translateX(' + dx + 'px) rotate(' + (dx * 0.04) + 'deg)';
        if (dx > 0)  card.dataset.swipeDir = 'right';
        else if (dx < 0) card.dataset.swipeDir = 'left';
        else delete card.dataset.swipeDir;
      }
    }

    function onUp(ev) {
      if (!dragging) return;
      dragging = false;
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      card.classList.remove('is-swiping');

      var threshold = SWIPE_THRESHOLD;
      if (lastDx > threshold) {
        // Swipe right -> like
        card.style.transform = 'translateX(120%) rotate(15deg)';
        var nowLiked = toggleLike(fact.id);
        haptic(HAPTIC_MS);
        toast(nowLiked ? 'Liked' : 'Unliked', 'success');
        // Update the visible button state.
        var lb = card.querySelector('.card__action[data-action="like"]');
        if (lb) {
          lb.classList.toggle('is-liked', nowLiked);
          lb.setAttribute('aria-label', nowLiked ? 'Unlike fact' : 'Like fact');
        }
        card.classList.toggle('is-liked', nowLiked);
        setTimeout(function () {
          card.style.transform = '';
          delete card.dataset.swipeDir;
          if (state.likesOnly && !nowLiked) applyFilters();
        }, 220);
      } else if (lastDx < -threshold) {
        // Swipe left -> share
        card.style.transform = 'translateX(-120%) rotate(-15deg)';
        haptic(HAPTIC_MS);
        shareFact(fact);
        setTimeout(function () {
          card.style.transform = '';
          delete card.dataset.swipeDir;
        }, 220);
      } else {
        // Snap back.
        card.style.transform = '';
        delete card.dataset.swipeDir;
        // If the press was a tap (no significant movement, no long-press), open overlay.
        if (!movedSignificantly && !longPressFired) {
          openOverlay(fact);
        }
      }
    }

    function onCancel() {
      dragging = false;
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
      card.classList.remove('is-swiping');
      card.style.transform = '';
      delete card.dataset.swipeDir;
    }

    card.addEventListener('pointerdown', onDown);
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerup',   onUp);
    card.addEventListener('pointercancel', onCancel);
    card.addEventListener('pointerleave',  function (ev) {
      // Only cancel if not actively dragging
      if (dragging && ev.buttons === 0) onCancel();
    });
  }

  function pointOf(ev) {
    return { x: ev.clientX, y: ev.clientY };
  }

  // -------------------- 9. Copy / share / overlay --------------------
  function copyFact(fact) {
    var text = fact.text + ' — via flkr';
    var done = function () {
      haptic(HAPTIC_MS);
      toast('Fact copied', 'success');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        legacyCopy(text); done();
      });
    } else {
      legacyCopy(text); done();
    }
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  function shareFact(fact) {
    var text = fact.text + ' — via flkr';
    var url  = fact.sourceUrl || location.origin;
    if (navigator.share) {
      navigator.share({ title: 'flkr', text: text, url: url })
        .catch(function () {
          // User cancelled share — fall back to clipboard silently.
          copyFact(fact);
        });
    } else {
      copyFact(fact);
    }
  }

  function openOverlay(fact) {
    $oText.textContent = fact.text;
    $oSrc.href = fact.sourceUrl || '#';
    $oSrc.textContent = fact.sourceUrl ? 'View source ↗' : '';
    if (!fact.sourceUrl) $oSrc.style.display = 'none';
    else $oSrc.style.display = '';

    $overlay.hidden = false;

    // Wire overlay buttons (replace handlers each time).
    $oCopy.onclick = function () { copyFact(fact); };
    $oShare.onclick = function () { shareFact(fact); };

    // Close on Escape.
    document.addEventListener('keydown', onOverlayKey);
  }

  function closeOverlay() {
    $overlay.hidden = true;
    document.removeEventListener('keydown', onOverlayKey);
    // Force a re-flow so the slide-up animation can replay next time.
    void $overlay.offsetWidth;
  }

  function onOverlayKey(ev) {
    if (ev.key === 'Escape') closeOverlay();
  }

  // Click on scrim / grip / data-close closes the overlay.
  $overlay.addEventListener('click', function (ev) {
    var t = ev.target;
    if (t.hasAttribute('data-close')) closeOverlay();
  });

  // -------------------- 10. Header wiring --------------------
  $likesT.addEventListener('click', function () {
    state.likesOnly = !state.likesOnly;
    $likesT.setAttribute('aria-pressed', String(state.likesOnly));
    applyFilters();
    toast(state.likesOnly ? 'Showing liked facts only' : 'Showing all facts');
  });

  var onSearch = debounce(function () {
    state.query = $search.value;
    $sClear.hidden = !state.query;
    applyFilters();
  }, DEBOUNCE_MS);
  $search.addEventListener('input', onSearch);

  $sClear.addEventListener('click', function () {
    $search.value = '';
    state.query = '';
    $sClear.hidden = true;
    applyFilters();
    $search.focus();
  });

  // -------------------- 11. Category chips --------------------
  function buildChips() {
    var cats = [{ category: 'All', count: state.facts.length }];
    if (window.FLKR_CATEGORIES) {
      for (var i = 0; i < window.FLKR_CATEGORIES.length; i++) {
        cats.push(window.FLKR_CATEGORIES[i]);
      }
    }
    $chips.innerHTML = '';
    var frag = document.createDocumentFragment();
    for (var j = 0; j < cats.length; j++) {
      var c = cats[j];
      var chip = document.createElement('button');
      chip.className = 'chip' + (c.category === state.activeCat ? ' is-active' : '');
      chip.dataset.cat = c.category;
      chip.innerHTML = c.category + ' <span class="chip__count">' + c.count + '</span>';
      chip.addEventListener('click', function (ev) {
        var cat = ev.currentTarget.dataset.cat;
        state.activeCat = cat;
        var all = $chips.querySelectorAll('.chip');
        for (var k = 0; k < all.length; k++) all[k].classList.remove('is-active');
        ev.currentTarget.classList.add('is-active');
        applyFilters();
      });
      frag.appendChild(chip);
    }
    $chips.appendChild(frag);
  }

  // -------------------- 12. Admin modal --------------------
  $adminBtn.addEventListener('click', function () { openAdmin(); });

  function openAdmin() {
    $adminMod.hidden = false;
    if (state.adminToken) showAddFactForm(); else showLoginForm();
  }
  function closeAdmin() {
    $adminMod.hidden = true;
  }
  $adminMod.addEventListener('click', function (ev) {
    if (ev.target.hasAttribute('data-admin-close')) closeAdmin();
  });

  function showLoginForm() {
    document.getElementById('loginForm').hidden = false;
    document.getElementById('addFactForm').hidden = true;
    document.getElementById('otpFieldWrap').hidden = true;
    document.getElementById('otpVerifyBtn').hidden = true;
  }
  function showAddFactForm() {
    document.getElementById('loginForm').hidden = true;
    document.getElementById('addFactForm').hidden = false;
  }

  var pendingEmail = null;
  document.getElementById('loginForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var email = this.email.value.trim();
    var pwd   = this.password.value;
    var hint  = document.getElementById('loginHint');
    hint.textContent = 'Sending OTP…';
    fetch(API_BASE + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: pwd }),
    }).then(function (r) {
      return r.json().then(function (body) { return { ok: r.ok, body: body }; });
    }).then(function (res) {
      if (!res.ok) {
        hint.textContent = 'Login failed: ' + (res.body.error || 'unknown');
        return;
      }
      pendingEmail = email;
      hint.textContent = 'OTP sent. Check the admin inbox and enter the 6-digit code below.';
      document.getElementById('otpFieldWrap').hidden = false;
      document.getElementById('otpVerifyBtn').hidden = false;
    }).catch(function (err) {
      hint.textContent = 'Network error: ' + err.message + ' (is the backend running on ' + API_BASE + '?)';
    });
  });

  document.getElementById('otpVerifyBtn').addEventListener('click', function () {
    if (!pendingEmail) return;
    var form = document.getElementById('loginForm');
    var code = form.otp.value.trim();
    fetch(API_BASE + '/auth/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingEmail, code: code }),
    }).then(function (r) {
      return r.json().then(function (body) { return { ok: r.ok, body: body }; });
    }).then(function (res) {
      if (!res.ok || !res.body.token) {
        toast('OTP verification failed: ' + (res.body.error || 'unknown'), 'danger');
        return;
      }
      state.adminToken = res.body.token;
      try { sessionStorage.setItem('flkr_admin', res.body.token); } catch (e) {}
      toast('Logged in', 'success');
      showAddFactForm();
    }).catch(function (err) {
      toast('Network error: ' + err.message, 'danger');
    });
  });

  document.getElementById('logoutBtn').addEventListener('click', function () {
    state.adminToken = null;
    try { sessionStorage.removeItem('flkr_admin'); } catch (e) {}
    closeAdmin();
    toast('Logged out');
  });

  document.getElementById('addFactForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var $ta = document.getElementById('factJson');
    var $wrap = $ta.closest('.field');
    var raw = $ta.value.trim();
    if (!raw) {
      $wrap.classList.add('is-error');
      toast('Paste a JSON fact object first', 'danger');
      return;
    }
    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      $wrap.classList.add('is-error');
      toast('Invalid JSON: ' + err.message, 'danger');
      return;
    }
    $wrap.classList.remove('is-error');

    fetch(API_BASE + '/facts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + state.adminToken,
      },
      body: JSON.stringify(parsed),
    }).then(function (r) {
      return r.json().then(function (body) { return { ok: r.ok, body: body }; });
    }).then(function (res) {
      if (!res.ok) {
        toast('Server rejected fact: ' + (res.body.error || 'unknown'), 'danger');
        return;
      }
      toast('Fact added (id ' + res.body.id + ')', 'success');
      $ta.value = '';
    }).catch(function (err) {
      toast('Network error: ' + err.message, 'danger');
    });
  });

  // Restore admin token from session storage.
  try {
    var t = sessionStorage.getItem('flkr_admin');
    if (t) state.adminToken = t;
  } catch (e) {}

  // -------------------- 13. Boot --------------------
  function boot() {
    if (!window.FLKR_FACTS || !window.FLKR_ADS) {
      // Datasets not yet loaded (script tags are deferred but order can vary
      // during development). Defer one tick.
      return setTimeout(boot, 30);
    }
    state.facts = window.FLKR_FACTS;
    state.ads   = window.FLKR_ADS;
    buildFeed();
    buildChips();
    applyFilters();

    // Daily view counter — increment once per session.
    var n = bumpDailyViews();
    console.log('[flkr] boot — ' + state.facts.length + ' facts, ' + state.ads.length + ' ads. Today\'s views: ' + n);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
