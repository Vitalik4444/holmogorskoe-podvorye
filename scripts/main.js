/* Лендинг «Ярмарка выходного дня».
   Скрипт только улучшает: без него страница читается обычной колонкой. */
(function () {
  'use strict';

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- орнаментальные пояса ----------
     Строим вектор под точную ширину контейнера: шаг раппорта 24 px фиксирован,
     полоса набирается повторением модуля, а не растягиванием. */
  var STEP = 24, HALF = 12;

  function buildOrnament(el) {
    var w = el.clientWidth;
    if (!w) return null;
    var n = Math.ceil(w / STEP);
    var up = 'M0 12', down = 'M0 12';
    for (var i = 0; i < n; i++) {
      var x = i * STEP;
      up += ' L' + (x + HALF) + ' 0 L' + (x + STEP) + ' 12';
      down += ' L' + (x + HALF) + ' 24 L' + (x + STEP) + ' 12';
    }
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + (n * STEP) + ' 24');
    svg.setAttribute('preserveAspectRatio', 'xMinYMid slice');
    svg.setAttribute('aria-hidden', 'true');
    [up, down].forEach(function (d) {
      var path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });
    el.textContent = '';
    el.appendChild(svg);
    el.classList.add('is-vector');
    return svg;
  }

  Array.prototype.forEach.call(document.querySelectorAll('.orn'), function (el) {
    var svg = buildOrnament(el);
    if (!svg || !el.hasAttribute('data-stitch') || reduced) return;
    Array.prototype.forEach.call(svg.querySelectorAll('path'), function (path) {
      var len = path.getTotalLength();
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
    });
    if (!('IntersectionObserver' in window)) { el.classList.add('is-stitching'); return; }
    new IntersectionObserver(function (entries, obs) {
      if (entries[0].isIntersecting) { el.classList.add('is-stitching'); obs.disconnect(); }
    }, { threshold: 0.6 }).observe(el);
  });

  /* ---------- шапка ----------
     Прозрачная, пока сцена занимает экран; плотной становится над футером. */
  var header = document.querySelector('.header');
  var stage = document.querySelector('[data-stage]');
  if (header && stage) {
    var headerPending = false;
    var syncHeader = function () {
      headerPending = false;
      var h = header.offsetHeight || 64;
      header.classList.toggle('is-solid', stage.getBoundingClientRect().bottom <= h);
    };
    var requestHeader = function () {
      if (headerPending) return;
      headerPending = true;
      requestAnimationFrame(syncHeader);
    };
    syncHeader();
    window.addEventListener('scroll', requestHeader, { passive: true });
    window.addEventListener('resize', requestHeader, { passive: true });
  }

  /* ---------- плавающая кнопка ---------- */
  var floater = document.getElementById('floater');
  var firstBeat = document.querySelector('[data-beat]');
  if (floater && firstBeat && 'IntersectionObserver' in window) {
    /* Появляется, когда первый такт уходит с экрана: на нём заголовок стоит
       у нижнего края, и кнопка перекрывала бы его. */
    new IntersectionObserver(function (entries) {
      floater.classList.toggle('is-on', !entries[0].isIntersecting);
    }, { threshold: 0 }).observe(firstBeat);
  }

  /* ---------- уведомление о куки ----------
     Показываем один раз: выбор запоминается в браузере посетителя. */
  var cookieBar = document.getElementById('cookie');
  var cookieOk = document.getElementById('cookie-ok');
  if (cookieBar && cookieOk) {
    var seen = false;
    try { seen = localStorage.getItem('cookie-ok') === '1'; } catch (e) { seen = true; }
    if (!seen) {
      cookieBar.hidden = false;
      cookieBar.classList.add('is-on');
    }
    cookieOk.addEventListener('click', function () {
      cookieBar.classList.remove('is-on');
      cookieBar.hidden = true;
      try { localStorage.setItem('cookie-ok', '1'); } catch (e) { /* приватный режим */ }
    });
  }

  /* ---------- переключатель схем ---------- */
  var switchBtns = document.querySelectorAll('.switch__btn');
  Array.prototype.forEach.call(switchBtns, function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-scheme');
      Array.prototype.forEach.call(switchBtns, function (b) {
        var on = b === btn;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      Array.prototype.forEach.call(document.querySelectorAll('[data-pane]'), function (pane) {
        pane.classList.toggle('is-on', pane.getAttribute('data-pane') === key);
      });
    });
  });

  /* ---------- сцена: два видео и такты ----------
     Прокрутка ведёт всё: какое видео показано, на каком оно кадре
     и какой такт читается. Один экран прокрутки — один такт.

     Режим пересчитывается при изменении ширины окна. Раньше он выбирался
     один раз при загрузке: стоило сузить окно — и страница оставалась
     в «десктопном» режиме, где виден только активный такт, а остальные семь
     скрыты. На настоящем телефоне это не воспроизводилось, а при проверке
     на десктопе выглядело как пропавший текст. */
  if (!stage) return;

  var beats = stage.querySelectorAll('[data-beat]');
  var videos = stage.querySelectorAll('.stage__video');
  var progressBar = stage.querySelector('.stage__progress span');
  if (!beats.length || videos.length < 2) return;

  var SCREENS_PER_BEAT = 0.6;   /* экранов прокрутки на один такт */
  var SPLIT = 4;                /* первые четыре такта — на первом видео */

  var wideQuery = window.matchMedia('(min-width: 1024px)');
  var live = false;
  var activeBeat = -1, activeVideo = -1;
  var seekTarget = 0, seekCurrent = 0, seeking = false;
  var narrowObserver = null;

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  /* Перемотка работает на всех ширинах. Отказываемся от неё только там,
     где она заведомо навредит: экономия трафика, медленная сеть или
     выключенные анимации в системе. */
  function canRunLive() {
    var conn = navigator.connection || {};
    var slow = conn.saveData === true || /^(slow-2g|2g|3g)$/.test(conn.effectiveType || '');
    /* Разворачиваем историю в колонку только на совсем маленьких экранах,
       где такт не помещается даже в сжатом виде. Прежний порог в 700 px
       по высоте отправлял в колонку обычные телефоны. */
    var tooSmall = window.innerHeight < 560 || window.innerWidth < 340;
    return !reduced && !slow && !tooSmall;
  }

  function attach(v) {
    /* На узких экранах берём облегчённую копию: перемотка требует декодировать
       кадры вразнобой, и на телефоне это упирается в размер кадра, а не в вес
       файла. 720 px вместо 1280 — вдвое меньше работы на каждую перемотку. */
    var src = (!wideQuery.matches && v.getAttribute('data-mp4-sm')) || v.getAttribute('data-mp4');
    if (!src || v.dataset.attached) return;
    v.dataset.attached = '1';
    var source = document.createElement('source');
    source.src = src;
    source.type = 'video/mp4';
    v.appendChild(source);
    v.preload = 'auto';
    v.pause();
    v.load();
  }

  function progress() {
    var rect = stage.getBoundingClientRect();
    var travel = stage.offsetHeight - window.innerHeight;
    if (travel <= 0) return 0;
    return clamp01(-rect.top / travel);
  }

  /* Плавный догон вместо резкой перемотки: скачки currentTime на каждый
     кадр колеса выглядят рвано, поэтому идём к цели с интерполяцией. */
  function seekLoop() {
    var v = videos[activeVideo];
    if (!live || !v) { seeking = false; return; }
    var diff = seekTarget - seekCurrent;
    if (Math.abs(diff) < 0.005) { seeking = false; return; }
    seekCurrent += diff * 0.12;
    if (v.seekable && v.seekable.length) {
      try { v.currentTime = seekCurrent; } catch (e) { /* перемотка ещё недоступна */ }
    }
    requestAnimationFrame(seekLoop);
  }

  function showVideo(index) {
    if (index === activeVideo) return;
    activeVideo = index;
    attach(videos[index]);
    for (var i = 0; i < videos.length; i++) videos[i].classList.toggle('is-on', i === index);
    seekCurrent = videos[index].currentTime || 0;
  }

  function update() {
    if (!live) return;
    var p = progress();
    var n = beats.length;
    var idx = Math.min(n - 1, Math.floor(p * n));
    if (idx !== activeBeat) {
      activeBeat = idx;
      for (var i = 0; i < n; i++) beats[i].classList.toggle('is-on', i === idx);
    }

    showVideo(idx < SPLIT ? 0 : 1);

    /* Внутри своей половины истории видео проезжает целиком. */
    var from = activeVideo === 0 ? 0 : SPLIT / n;
    var to = activeVideo === 0 ? SPLIT / n : 1;
    var local = clamp01((p - from) / (to - from));
    var v = videos[activeVideo];
    if (v && v.duration) {
      seekTarget = local * v.duration;
      if (!seeking) { seeking = true; requestAnimationFrame(seekLoop); }
    }

    if (progressBar) progressBar.style.width = (p * 100).toFixed(1) + '%';
    stage.classList.toggle('is-past-hint', p > 0.02);

    /* Второе видео начинаем грузить на подходе к его половине,
       чтобы не забирать канал у первого экрана. */
    if (p > (SPLIT / n) - 0.15) attach(videos[1]);
  }

  var pending = false;
  function onScroll() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; update(); });
  }

  /* Якорь на такт внутри закреплённой сцены сам по себе не работает: элемент
     физически лежит в начале сцены, и браузер прокручивает туда же. */
  function scrollToBeat(index) {
    if (!live) {
      beats[index].scrollIntoView({ block: 'end', behavior: 'smooth' });
      return;
    }
    var travel = stage.offsetHeight - window.innerHeight;
    var top = stage.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + travel * (index + 0.5) / beats.length, behavior: 'smooth' });
  }

  Array.prototype.forEach.call(document.querySelectorAll('a[href^="#"]'), function (link) {
    var id = link.getAttribute('href').slice(1);
    if (!id) return;
    var target = document.getElementById(id);
    if (!target || !target.hasAttribute('data-beat')) return;
    var index = Array.prototype.indexOf.call(beats, target);
    if (index < 0) return;
    link.addEventListener('click', function (e) {
      e.preventDefault();
      scrollToBeat(index);
    });
  });

  /* Ширина изменилась — источник может стать другим, поэтому переподключаем. */
  function reattachSources() {
    Array.prototype.forEach.call(videos, function (v) {
      if (!v.dataset.attached) return;
      var want = (!wideQuery.matches && v.getAttribute('data-mp4-sm')) || v.getAttribute('data-mp4');
      var cur = v.querySelector('source');
      if (!cur || cur.getAttribute('src') === want) return;
      cur.setAttribute('src', want);
      v.load();
    });
  }

  function enableLive() {
    if (live) return;
    live = true;
    stage.style.height = (100 + beats.length * SCREENS_PER_BEAT * 100) + 'vh';
    stage.classList.add('is-live');
    stage.classList.remove('is-second');
    stopLoop();
    if (narrowObserver) { narrowObserver.disconnect(); narrowObserver = null; }
    attach(videos[0]);
    activeBeat = -1;
    activeVideo = -1;
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  /* Узкий экран: одно видео крутится фоном. Без перемотки — только петля,
     поэтому расход процессора и батареи минимальный. */
  function playLoop(index) {
    for (var i = 0; i < videos.length; i++) {
      var v = videos[i];
      if (i === index) {
        attach(v);
        v.loop = true;
        v.muted = true;
        v.setAttribute('playsinline', '');
        v.classList.add('is-on');
        var play = v.play();
        if (play && play.catch) {
          play.catch(function () {
            /* автозапуск запрещён — остаётся статичный кадр */
            stage.classList.remove('is-loop');
          });
        }
      } else {
        v.classList.remove('is-on');
        v.pause();
      }
    }
  }

  function startLoop() {
    var conn2 = navigator.connection || {};
    var slow2 = conn2.saveData === true || /^(slow-2g|2g|3g)$/.test(conn2.effectiveType || '');
    if (reduced || slow2) return;
    stage.classList.add('is-loop');
    /* На второй половине истории идёт второе видео — как и при перемотке. */
    playLoop(stage.classList.contains('is-second') ? 1 : 0);
  }

  function stopLoop() {
    stage.classList.remove('is-loop');
    Array.prototype.forEach.call(videos, function (v) {
      v.loop = false;
      v.pause();
    });
  }

  function disableLive() {
    window.removeEventListener('scroll', onScroll);
    live = false;
    activeBeat = -1;
    activeVideo = -1;
    stage.classList.remove('is-live', 'is-past-hint');
    stage.style.height = '';
    if (progressBar) progressBar.style.width = '';
    Array.prototype.forEach.call(beats, function (b) { b.classList.remove('is-on'); });
    Array.prototype.forEach.call(videos, function (v) { v.classList.remove('is-on'); v.pause(); });
    startNarrowWatch();
    startLoop();
  }

  /* Узкий экран: видео не грузим, но кадр меняем на второй половине истории. */
  function startNarrowWatch() {
    if (narrowObserver || !('IntersectionObserver' in window)) return;
    var half = beats[Math.floor(beats.length / 2)];
    if (!half) return;
    narrowObserver = new IntersectionObserver(function (entries) {
      var second = entries[0].boundingClientRect.top < window.innerHeight / 2;
      stage.classList.toggle('is-second', second);
      if (stage.classList.contains('is-loop')) playLoop(second ? 1 : 0);
    }, { threshold: 0 });
    narrowObserver.observe(half);
  }

  function syncMode() {
    reattachSources();
    if (canRunLive()) enableLive();
    else disableLive();
  }

  syncMode();
  if (wideQuery.addEventListener) wideQuery.addEventListener('change', syncMode);
  else if (wideQuery.addListener) wideQuery.addListener(syncMode);
  window.addEventListener('resize', function () {
    syncMode();
    if (live) onScroll();
  }, { passive: true });
})();
