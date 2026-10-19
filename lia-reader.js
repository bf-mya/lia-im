/*!
 * lia-reader.js: an Immersive-Reader-style view for LiaScript courses.
 * Speech engine: ResponsiveVoice (the engine LiaScript already loads) by default,
 * with automatic fallback to the browser's native Web Speech API. No dependencies.
 *
 * Features: distraction-free page, sentence highlighting (word highlighting on native voices), line focus,
 * click-a-word-to-hear-it (Shift+click = read from here), speed, voice picker, text size, line spacing,
 * light/sepia/dark themes, reads the current selection if there is one.
 *
 * Load it from a LiaScript header:   script: lia-reader.js
 * API:  LiaReader.open()  LiaReader.read("text")  LiaReader.close()  LiaReader.config
 */
(function () {
  'use strict';
  if (window.LiaReader) return;
  const synth = window.speechSynthesis;
  if (!synth) { console.warn('[LiaReader] speechSynthesis is not available'); return; }

  // Change at runtime, e.g. LiaReader.config.lang = 'en-GB'
  const CFG = Object.assign({
    lang: 'en',                       // preferred voice language prefix
    engine: 'responsivevoice',        // 'responsivevoice' (default, falls back to native if not loaded) or 'native'
    rvVoice: 'UK English Female',     // default ResponsiveVoice voice
    button: true,                     // show the floating "Reader" button
    contentSelectors: ['.lia-slide__content', '.lia-slide', 'main', '[role="main"]'],
    ignoreSelectors: 'script,style,nav,button,input,textarea,select,svg,canvas,video,audio,iframe,' +
      'pre,code,.lia-quiz,.lia-code,[data-lia-reader-ignore]'
  }, window.LIA_READER_CONFIG || {});

  const BLOCK = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,td,th,figcaption,dt,dd';
  const KEY = 'lia-reader-prefs';
  const prefs = Object.assign({ rate: 1, voice: '', rv: '', size: 22, spacing: 1.7, theme: 'light', focus: false, wordClick: true, slow: false }, load());
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* ignore */ } }

  let sents = [], cur = 0, last = -1, playing = false, token = 0, keep = null, isOpen = false;

  /* ---------- UI (inside a shadow root so LiaScript's CSS can't interfere) ---------- */
  // Attached to <html>, not <body>, so LiaScript's Elm renderer never removes it.
  const host = document.createElement('div');
  host.id = 'lia-reader-root';
  const sh = host.attachShadow({ mode: 'open' });
  sh.innerHTML = `
<style>
*{box-sizing:border-box;font-family:system-ui,-apple-system,Segoe UI,sans-serif}
#fab{position:fixed;right:16px;bottom:16px;z-index:2147483000;padding:10px 14px;border:0;border-radius:999px;
  background:#1e5bb8;color:#fff;font-size:15px;cursor:pointer;box-shadow:0 2px 8px #0004}
#ov{position:fixed;inset:0;z-index:2147483001;display:none;flex-direction:column;background:var(--bg);color:var(--fg)}
#ov.on{display:flex}
#ov[data-theme=light]{--bg:#fff;--fg:#1b1b1b;--hl:#ffe36e;--bar:#eef1f5}
#ov[data-theme=sepia]{--bg:#f4ecd8;--fg:#3b2f1e;--hl:#f2c46d;--bar:#e9dfc6}
#ov[data-theme=dark]{--bg:#181a1f;--fg:#e8e8e8;--hl:#6b5700;--bar:#262a31}
.bar{display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;padding:8px 12px;background:var(--bar);font-size:14px}
.bar button,.bar select{font-size:15px;padding:5px 10px;border:1px solid #8886;border-radius:6px;background:var(--bg);color:var(--fg);cursor:pointer}
.bar label{display:flex;align-items:center;gap:4px}
.bar #voice{max-width:220px}.sp{flex:1}
.scroll{flex:1;overflow:auto}
.page{max-width:44em;margin:0 auto;padding:32px 20px 35vh;font-size:var(--size,22px);line-height:var(--lh,1.7)}
.page h1,.page h2,.page h3,.page h4,.page h5,.page h6{line-height:1.3;margin:1.2em 0 .4em}
.page p{margin:.6em 0}
.li::before{content:'\\2022\\00a0'}
.s{cursor:pointer;border-radius:3px;transition:opacity .2s}
.s:hover{background:var(--bar)}
.s.cur{background:var(--hl)}
.w.on{background:var(--fg);color:var(--bg);border-radius:3px}
.words .w{cursor:pointer}.words .w:hover{outline:1px solid currentColor;border-radius:3px}
.focus .s{opacity:.22}.focus .s.cur{opacity:1}
.empty{opacity:.6}
</style>
<button id="fab" title="Open reader view">🔊 Reader</button>
<div id="ov" data-theme="light" role="dialog" aria-label="Reader view">
  <div class="bar">
    <button id="prev" title="Previous sentence (←)">⏮</button>
    <button id="play" title="Play / pause (Space)">▶</button>
    <button id="next" title="Next sentence (→)">⏭</button>
    <label>Speed <input id="rate" type="range" min="0.5" max="2" step="0.1"><span id="rv"></span></label>
    <select id="voice" title="Voice"></select><span id="eng" style="opacity:.6;font-size:12px"></span>
    <button id="sm" title="Smaller text">A−</button><button id="lg" title="Larger text">A+</button>
    <label>Spacing <input id="lh" type="range" min="1.2" max="2.4" step="0.1"></label>
    <select id="theme" title="Theme"><option value="light">Light</option><option value="sepia">Sepia</option><option value="dark">Dark</option></select>
    <label><input id="focus" type="checkbox"> Line focus</label>
    <label title="Click a word to hear it alone. Shift+click reads from that sentence."><input id="wc" type="checkbox"> Click word</label>
    <label title="Say single words more slowly"><input id="slow" type="checkbox"> Slow words</label>
    <span class="sp"></span>
    <button id="x" title="Close (Esc)">✕</button>
  </div>
  <div class="scroll"><div class="page" id="page"></div></div>
</div>`;
  const q = (s) => sh.querySelector(s);

  /* ---------- Text extraction ---------- */
  function clean(t) { return (t || '').replace(/\s+/g, ' ').trim(); }

  function findRoot(sel) {
    const list = sel ? [sel] : CFG.contentSelectors;
    for (const s of list) { const el = document.querySelector(s); if (el) return el; }
    return document.body;
  }

  function collect(opts) {
    opts = opts || {};
    if (opts.text) return String(opts.text).split(/\r?\n+/).map(clean).filter(Boolean).map((t) => ({ tag: 'p', text: t }));
    const selected = String(window.getSelection ? window.getSelection() : '').trim();
    if (selected && !opts.ignoreSelection) return selected.split(/\r?\n+/).map(clean).filter(Boolean).map((t) => ({ tag: 'p', text: t }));
    const out = [];
    findRoot(opts.selector).querySelectorAll(BLOCK).forEach((el) => {
      if (el.closest(CFG.ignoreSelectors)) return;
      if (el.querySelector(BLOCK)) return;               // avoid duplicates from nested blocks
      const t = clean(el.textContent);
      if (!t) return;
      out.push({ tag: /^H[1-6]$/.test(el.tagName) ? el.tagName.toLowerCase() : (el.tagName === 'LI' ? 'li' : 'p'), text: t });
    });
    return out;
  }

  function split(text) {
    if (window.Intl && Intl.Segmenter) {
      return [...new Intl.Segmenter(CFG.lang, { granularity: 'sentence' }).segment(text)]
        .map((x) => x.segment.trim()).filter(Boolean);
    }
    return (text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [text]).map((s) => s.trim()).filter(Boolean);
  }

  function render(blocks) {
    const page = q('#page');
    page.textContent = ''; sents = []; cur = 0; last = -1;
    if (!blocks.length) { page.innerHTML = '<p class="empty">Nothing to read on this slide.</p>'; return; }
    blocks.forEach((b) => {
      const el = document.createElement(b.tag === 'li' ? 'p' : b.tag);
      if (b.tag === 'li') el.className = 'li';
      split(b.text).forEach((t) => {
        const sp = document.createElement('span');
        sp.className = 's'; sp.dataset.i = sents.length;
        const words = []; const re = /\S+/g; let m, pos = 0;
        while ((m = re.exec(t))) {                            // each word gets its own span (for highlighting + click-to-hear)
          if (m.index > pos) sp.append(t.slice(pos, m.index));
          const w = document.createElement('span'); w.className = 'w'; w.textContent = m[0];
          sp.append(w); words.push({ a: m.index, b: m.index + m[0].length, el: w });
          pos = m.index + m[0].length;
        }
        sp.append(t.slice(pos) + ' ');
        sents.push({ text: t, el: sp, words });
        el.appendChild(sp);
      });
      page.appendChild(el);
    });
  }

  /* ---------- Speech ---------- */
  function voice() { return synth.getVoices().find((v) => v.voiceURI === prefs.voice) || null; }
  // ResponsiveVoice is what LiaScript itself uses; it is a global when LiaScript has loaded it.
  function useRV() {
    return CFG.engine === 'responsivevoice' && !!window.responsiveVoice && typeof window.responsiveVoice.speak === 'function';
  }
  function cancelAll() {
    synth.cancel();
    if (window.responsiveVoice && typeof window.responsiveVoice.cancel === 'function') window.responsiveVoice.cancel();
  }

  function plain(i) { const s = sents[i]; if (s) s.words.forEach((w) => w.el.classList.remove('on')); }

  function mark(i) {
    if (last >= 0 && last !== i) { plain(last); sents[last].el.classList.remove('cur'); }
    last = i; cur = i;
    const el = sents[i].el;
    el.classList.add('cur'); plain(i);
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function hiWord(i, start) {
    const s = sents[i]; if (!s) return;
    plain(i);
    const w = s.words.find((x) => x.b > start); if (w) w.el.classList.add('on');
  }

  // Say one word on its own (click-to-hear). Pauses any running reading; Play resumes from that sentence.
  function speakWord(wEl, sentIdx) {
    playing = false; const my = ++token; cancelAll();
    if (last >= 0) { plain(last); sents[last].el.classList.remove('cur'); last = -1; }
    cur = sentIdx; ui();
    const text = wEl.textContent.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!text) return;
    const rate = prefs.slow ? Math.max(0.4, prefs.rate * 0.6) : prefs.rate;
    wEl.classList.add('on');
    const done = () => { if (my === token) wEl.classList.remove('on'); };
    if (useRV()) {
      const opts = { rate: Math.min(1.5, rate), onend: done, onerror: done };
      setTimeout(() => { if (my === token) window.responsiveVoice.speak(text, prefs.rv || CFG.rvVoice, opts); }, 30);
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    const v = voice(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = CFG.lang;
    u.rate = rate; u.onend = done; u.onerror = done; keep = u;
    setTimeout(() => { if (my === token) synth.speak(u); }, 30);
  }

  function speak(i) {
    if (i < 0) i = 0;
    if (i >= sents.length) { stop(); return; }
    playing = true; const my = ++token;
    cancelAll();
    mark(i); ui();
    if (useRV()) {                                           // sentence-level highlighting only (no word boundaries)
      const opts = {
        rate: Math.min(1.5, prefs.rate),
        onend: () => { if (my === token && playing) { plain(i); speak(i + 1); } },
        onerror: () => { if (my === token) { playing = false; ui(); } }
      };
      setTimeout(() => { if (my === token) window.responsiveVoice.speak(sents[i].text, prefs.rv || CFG.rvVoice, opts); }, 30);
      return;
    }
    const u = new SpeechSynthesisUtterance(sents[i].text);   // one utterance per sentence avoids Chrome's ~15 s cut-off
    const v = voice(); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = CFG.lang;
    u.rate = prefs.rate;
    u.onboundary = (e) => { if (my === token && (e.name === 'word' || e.name === undefined)) hiWord(i, e.charIndex); };
    u.onend = () => { if (my === token && playing) { plain(i); speak(i + 1); } };
    u.onerror = (e) => { if (my === token && e.error !== 'interrupted' && e.error !== 'canceled') { playing = false; ui(); } };
    keep = u;                                                // keep a reference: Chrome can garbage-collect running utterances
    setTimeout(() => { if (my === token) synth.speak(u); }, 30);
  }

  function pause() { playing = false; token++; cancelAll(); if (last >= 0) plain(last); ui(); }
  function stop() { playing = false; token++; cancelAll(); if (last >= 0) { plain(last); sents[last].el.classList.remove('cur'); } last = -1; cur = 0; ui(); }
  function toggle() { if (!sents.length) return; playing ? pause() : speak(cur); }
  function jump(d) { if (!sents.length) return; const n = Math.max(0, Math.min(sents.length - 1, cur + d)); playing ? speak(n) : mark(n); }

  /* ---------- Controls ---------- */
  function ui() {
    q('#play').textContent = playing ? '⏸' : '▶';
    q('#rv').textContent = prefs.rate.toFixed(1) + '×';
    q('#eng').textContent = useRV() ? 'ResponsiveVoice' : 'Native voice';
    const ov = q('#ov');
    ov.dataset.theme = prefs.theme;
    ov.style.setProperty('--size', prefs.size + 'px');
    ov.style.setProperty('--lh', prefs.spacing);
    q('#page').classList.toggle('focus', !!prefs.focus);
    q('#page').classList.toggle('words', !!prefs.wordClick);
  }

  function fillVoices() {
    const sel = q('#voice'); sel.textContent = '';
    if (useRV()) {
      let all = [];
      try { all = window.responsiveVoice.getVoices() || []; } catch (e) { /* not ready yet */ }
      const lang = CFG.lang.toLowerCase();
      const mineRV = all.filter((v) => (v.lang || '').toLowerCase().startsWith(lang) || (lang.startsWith('en') && /english/i.test(v.name)));
      const mk = (label, list) => {
        if (!list.length) return;
        const g = document.createElement('optgroup'); g.label = label;
        list.forEach((v) => { const o = document.createElement('option'); o.value = v.name; o.textContent = v.name; g.appendChild(o); });
        sel.appendChild(g);
      };
      mk(CFG.lang.toUpperCase(), mineRV);
      mk('Other languages', all.filter((v) => !mineRV.includes(v)));
      if (!sel.options.length) { const o = document.createElement('option'); o.value = CFG.rvVoice; o.textContent = CFG.rvVoice; sel.appendChild(o); }
      const names = [...sel.options].map((o) => o.value);
      sel.value = names.includes(prefs.rv) ? prefs.rv : (names.includes(CFG.rvVoice) ? CFG.rvVoice : names[0]);
      prefs.rv = sel.value;
      return;
    }
    const vs = synth.getVoices();
    const mine = vs.filter((v) => v.lang.toLowerCase().startsWith(CFG.lang.toLowerCase()))
      .sort((a, b) => Number(b.localService) - Number(a.localService));
    const group = (label, list) => {
      if (!list.length) return;
      const g = document.createElement('optgroup'); g.label = label;
      list.forEach((v) => { const o = document.createElement('option'); o.value = v.voiceURI; o.textContent = v.name + ' (' + v.lang + ')'; g.appendChild(o); });
      sel.appendChild(g);
    };
    group(CFG.lang.toUpperCase(), mine);
    group('Other languages', vs.filter((v) => !mine.includes(v)));
    if (vs.some((v) => v.voiceURI === prefs.voice)) sel.value = prefs.voice;
    else if (mine[0]) { prefs.voice = mine[0].voiceURI; sel.value = prefs.voice; }
  }

  function open(opts) {
    stop(); render(collect(opts));
    fillVoices(); q('#rate').max = useRV() ? 1.5 : 2; if (prefs.rate > +q('#rate').max) prefs.rate = +q('#rate').max; q('#rate').value = prefs.rate; q('#lh').value = prefs.spacing; q('#theme').value = prefs.theme; q('#focus').checked = prefs.focus; q('#wc').checked = prefs.wordClick; q('#slow').checked = prefs.slow;
    ui(); q('#ov').classList.add('on'); isOpen = true;
    return '';
  }
  function close() { stop(); q('#ov').classList.remove('on'); isOpen = false; return ''; }

  q('#fab').addEventListener('mousedown', (e) => e.preventDefault());   // keeps the user's text selection
  q('#fab').addEventListener('click', () => open());
  q('#x').addEventListener('click', close);
  q('#play').addEventListener('click', toggle);
  q('#prev').addEventListener('click', () => jump(-1));
  q('#next').addEventListener('click', () => jump(1));
  q('#sm').addEventListener('click', () => { prefs.size = Math.max(14, prefs.size - 2); save(); ui(); });
  q('#lg').addEventListener('click', () => { prefs.size = Math.min(44, prefs.size + 2); save(); ui(); });
  q('#lh').addEventListener('input', (e) => { prefs.spacing = +e.target.value; save(); ui(); });
  q('#theme').addEventListener('change', (e) => { prefs.theme = e.target.value; save(); ui(); });
  q('#focus').addEventListener('change', (e) => { prefs.focus = e.target.checked; save(); ui(); });
  q('#wc').addEventListener('change', (e) => { prefs.wordClick = e.target.checked; save(); ui(); });
  q('#slow').addEventListener('change', (e) => { prefs.slow = e.target.checked; save(); });
  q('#rate').addEventListener('change', (e) => { prefs.rate = +e.target.value; save(); ui(); if (playing) speak(cur); });
  q('#voice').addEventListener('change', (e) => { if (useRV()) prefs.rv = e.target.value; else prefs.voice = e.target.value; save(); if (playing) speak(cur); });
  q('#page').addEventListener('click', (e) => {
    const sEl = e.target.closest('.s'); if (!sEl) return;
    const wEl = e.target.closest('.w');
    if (wEl && prefs.wordClick && !e.shiftKey) speakWord(wEl, +sEl.dataset.i);   // click a word: hear it alone
    else speak(+sEl.dataset.i);                                                   // Shift+click, or word mode off: read from this sentence
  });

  document.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    const a = sh.activeElement, typing = a && /^(SELECT|INPUT)$/.test(a.tagName);
    if (e.key === 'Escape') { close(); e.preventDefault(); }
    else if (!typing && e.key === ' ') { toggle(); e.preventDefault(); }
    else if (!typing && e.key === 'ArrowRight') { jump(1); e.preventDefault(); }
    else if (!typing && e.key === 'ArrowLeft') { jump(-1); e.preventDefault(); }
  }, true);

  synth.addEventListener && synth.addEventListener('voiceschanged', () => { if (isOpen) fillVoices(); });
  window.addEventListener('beforeunload', cancelAll);

  if (!CFG.button) q('#fab').style.display = 'none';
  document.documentElement.appendChild(host);

  /* ---------- Public API ---------- */
  window.LiaReader = {
    config: CFG,
    open,                                                    // open(): current slide, or the current selection
    read(text) { open({ text }); speak(0); return ''; },     // read("any text") opens the view and starts speaking
    close,
    showButton(on) { q('#fab').style.display = on === false ? 'none' : ''; }
  };
})();
