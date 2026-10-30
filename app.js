/* GuppyLM explainer — interactive logic. No dependencies. */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var INSIGHTS = window.GUPPY_INSIGHTS || {};
  var TOK = window.GUPPY_TOKENIZER || { vocab: {}, merges: [], specials: {} };
  var SAMPLES = window.GUPPY_SAMPLES || [];
  var CURVE = window.GUPPY_CURVE || null;
  var TRAIN_CODE = window.GUPPY_TRAIN_CODE || { start: 48, lines: [] };

  var SVGNS = 'http://www.w3.org/2000/svg';
  var observers = [];

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function svgEl(name, attrs) {
    var n = document.createElementNS(SVGNS, name);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }
  function addText(parent, x, y, str, cls, anchor) {
    var t = svgEl('text', { x: x, y: y });
    if (cls) t.setAttribute('class', cls);
    if (anchor) t.setAttribute('text-anchor', anchor);
    t.textContent = str;
    parent.appendChild(t);
    return t;
  }
  function prettyTok(t) {
    if (t === undefined || t === null) return '';
    if (t === '') return '∅';
    return String(t).replace(/Ġ/g, '·').replace(/Ċ/g, '↵').replace(/\n/g, '↵').replace(/ /g, '·');
  }
  function pct(p) {
    var v = p * 100;
    if (v >= 10) return v.toFixed(0) + '%';
    if (v >= 1) return v.toFixed(1) + '%';
    return v.toFixed(2) + '%';
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  /* ---------------- theme, nav, progress ---------------- */

  var root = document.documentElement;
  var themeBtn = $('#theme-btn');
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('guppy-theme', next); } catch (e) {}
    });
  }

  var menuBtn = $('#menu-btn');
  if (menuBtn) {
    menuBtn.addEventListener('click', function () {
      var open = document.body.classList.toggle('nav-open');
      menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    var backdrop = $('#nav-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', function () {
        document.body.classList.remove('nav-open');
        menuBtn.setAttribute('aria-expanded', 'false');
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('nav-open')) {
        document.body.classList.remove('nav-open');
        menuBtn.setAttribute('aria-expanded', 'false');
      }
    });
    $$('.toc a').forEach(function (a) {
      a.addEventListener('click', function () {
        document.body.classList.remove('nav-open');
        menuBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  var progressBar = $('#read-progress-bar');
  function updateProgress() {
    if (!progressBar) return;
    var doc = document.documentElement;
    var max = doc.scrollHeight - doc.clientHeight;
    var y = window.pageYOffset || doc.scrollTop || 0;
    progressBar.style.width = (max > 0 ? clamp(y / max, 0, 1) * 100 : 0) + '%';
  }
  window.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', updateProgress, { passive: true });
  updateProgress();

  var tocLinks = {};
  $$('.toc a').forEach(function (a) { tocLinks[a.getAttribute('data-section')] = a; });
  if ('IntersectionObserver' in window) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var id = entry.target.id;
        Object.keys(tocLinks).forEach(function (k) {
          tocLinks[k].classList.toggle('active', k === id);
          if (k === id) tocLinks[k].setAttribute('aria-current', 'location');
          else tocLinks[k].removeAttribute('aria-current');
        });
      });
    }, { rootMargin: '-12% 0px -76% 0px' });
    $$('section[id]').forEach(function (s) { if (tocLinks[s.id]) spy.observe(s); });
  }

  /* ---------------- pipeline ---------------- */

  var PIPE = {
    data: {
      title: 'Data — a list of (user, fish) pairs',
      body: 'A Python script composes short conversations from hand-written pools. Nothing is scraped. The output is 60,000 examples, split 95/5 into train and held-out sets.',
      note: 'Changes: nothing yet. This is just a file on disk.',
      file: 'guppylm/generate_data.py'
    },
    tokenizer: {
      title: 'Tokenizer — text to integer IDs',
      body: 'A byte-level BPE tokenizer is trained on the generated text. It learns 2,352 merges and produces a 2,418-token vocabulary. Every conversation becomes a sequence of integers.',
      note: 'Changes: the tokenizer vocabulary and merges, saved as tokenizer.json.',
      file: 'guppylm/prepare_data.py'
    },
    model: {
      title: 'Model — a stack of six transformer blocks',
      body: 'Token and position embeddings feed six blocks of causal attention and feed-forward layers. A final linear layer scores all 4,096 vocabulary slots. This is where the 8.7M weights live.',
      note: 'Changes: nothing yet. The weights are random at this point.',
      file: 'guppylm/model.py'
    },
    train: {
      title: 'Training — adjust the weights',
      body: 'For each batch, the model predicts the next token at every position. Cross-entropy measures the error, backpropagation computes gradients, and AdamW updates every weight. Repeat 10,000 times.',
      note: 'Changes: all 8,726,016 weights, plus checkpoints on disk.',
      file: 'guppylm/train.py'
    },
    infer: {
      title: 'Inference — sample one token at a time',
      body: 'Encode the prompt, run a forward pass, take the last position’s probabilities, sample a token, append it, and repeat. No gradients and no weight updates.',
      note: 'Changes: nothing. The model is read-only; only the token sequence grows.',
      file: 'guppylm/inference.py'
    }
  };

  function renderPipe(key) {
    var panel = $('#pipe-panel');
    if (!panel) return;
    var p = PIPE[key];
    clear(panel);
    panel.appendChild(el('h4', null, p.title));
    panel.appendChild(el('p', null, p.body));
    var note = el('p', 'muted', p.note + ' ');
    var code = el('code', null, p.file);
    note.appendChild(code);
    panel.appendChild(note);
  }
  $$('.pipe-step').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $$('.pipe-step').forEach(function (b) {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      renderPipe(btn.getAttribute('data-pipe'));
    });
  });
  renderPipe('data');

  /* ---------------- real samples ---------------- */

  var lastSample = -1;
  function drawSample() {
    if (!SAMPLES.length) return;
    var i = Math.floor(Math.random() * SAMPLES.length);
    if (SAMPLES.length > 1) {
      var guard = 0;
      while (i === lastSample && guard++ < 8) i = Math.floor(Math.random() * SAMPLES.length);
    }
    lastSample = i;
    var s = SAMPLES[i];
    var input = $('#sample-input');
    var output = $('#sample-output');
    var cat = $('#sample-category');
    if (input) input.textContent = s.input;
    if (output) output.textContent = s.output;
    if (cat) cat.textContent = s.category;
  }
  var sampleBtn = $('#sample-btn');
  if (sampleBtn) sampleBtn.addEventListener('click', drawSample);
  var sampleCount = $('#sample-count');
  if (sampleCount) sampleCount.textContent = SAMPLES.length ? SAMPLES.length + ' sampled conversations · 5 per topic' : '';
  drawSample();

  /* ---------------- greeting recombination ---------------- */

  var OPENERS = ['hello.', 'hi.', 'oh hello.', 'oh hi.', 'hey.', 'hi there.'];
  var MIDDLES = [
    'i was just swimming in circles.',
    'the water is clear today.',
    'i\'m behind the plant.',
    'i didn\'t see you there. my eyes are on the sides.',
    'are you the big shape that feeds me.',
    'you look big today. you always look big.',
    'i just found a nice spot near the rock.',
    'i was thinking about flakes.',
    'the castle looks nice today.',
    'did you bring pellets.'
  ];
  var EXTRAS = [
    'i blew some bubbles earlier.',
    'the current feels nice.',
    'it\'s a good day to be a fish.',
    '',
    ''
  ];

  function fillSelect(sel, values, blankLabel) {
    if (!sel) return;
    clear(sel);
    if (blankLabel) {
      var opt = el('option', null, blankLabel);
      opt.value = '';
      sel.appendChild(opt);
    }
    values.forEach(function (v) {
      var o = el('option', null, v === '' ? '(nothing)' : v);
      o.value = v;
      sel.appendChild(o);
    });
  }
  function renderRecombine() {
    var a = $('#rec-opener'), b = $('#rec-middle'), c = $('#rec-extra');
    if (!a) return;
    var fa = $('#frag-a'), fb = $('#frag-b'), fc = $('#frag-c');
    if (fa) fa.textContent = a.value;
    if (fb) fb.textContent = b.value;
    if (fc) fc.textContent = c.value;
  }
  fillSelect($('#rec-opener'), OPENERS);
  fillSelect($('#rec-middle'), MIDDLES);
  fillSelect($('#rec-extra'), EXTRAS);
  ['#rec-opener', '#rec-middle', '#rec-extra'].forEach(function (s) {
    var node = $(s);
    if (node) node.addEventListener('change', renderRecombine);
  });
  renderRecombine();

  /* ---------------- byte-level BPE ---------------- */

  function bytesToUnicode() {
    var bs = [], cs = [], n = 0, b;
    for (b = 33; b <= 126; b++) bs.push(b);
    for (b = 161; b <= 172; b++) bs.push(b);
    for (b = 174; b <= 255; b++) bs.push(b);
    cs = bs.slice();
    for (b = 0; b < 256; b++) {
      if (bs.indexOf(b) === -1) { bs.push(b); cs.push(256 + n); n++; }
    }
    var map = new Map();
    for (var i = 0; i < bs.length; i++) map.set(bs[i], String.fromCodePoint(cs[i]));
    return map;
  }
  var B2U = bytesToUnicode();
  var U2B = new Map();
  B2U.forEach(function (v, k) { U2B.set(v, k); });

  var RANKS = new Map();
  (TOK.merges || []).forEach(function (m, i) { RANKS.set(m[0] + '\u0001' + m[1], i); });

  var SPECIAL_KEYS = Object.keys(TOK.specials || {}).sort(function (a, b) { return b.length - a.length; });
  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  var SPECIAL_RE = SPECIAL_KEYS.length
    ? new RegExp('(' + SPECIAL_KEYS.map(escapeRe).join('|') + ')', 'g')
    : null;
  var PRETOK = /('s|'t|'re|'ve|'m|'ll|'d| ?[\p{L}]+| ?[\p{N}]+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+)/gu;

  function bpeChunk(chunk) {
    var bytes = Array.from(new TextEncoder().encode(chunk));
    var syms = bytes.map(function (b) { return B2U.get(b); });
    while (syms.length > 1) {
      var best = Infinity, bi = -1;
      for (var i = 0; i < syms.length - 1; i++) {
        var r = RANKS.get(syms[i] + '\u0001' + syms[i + 1]);
        if (r !== undefined && r < best) { best = r; bi = i; }
      }
      if (bi < 0) break;
      var a = syms[bi], b = syms[bi + 1], out = [], j = 0;
      while (j < syms.length) {
        if (j < syms.length - 1 && syms[j] === a && syms[j + 1] === b) { out.push(a + b); j += 2; }
        else { out.push(syms[j]); j++; }
      }
      syms = out;
    }
    return syms;
  }

  function encodeDetailed(text) {
    var out = [];
    var parts = SPECIAL_RE ? text.split(SPECIAL_RE) : [text];
    parts.forEach(function (part) {
      if (!part) return;
      if (SPECIAL_RE && Object.prototype.hasOwnProperty.call(TOK.specials, part)) {
        out.push({ id: TOK.specials[part], text: part, special: true });
        return;
      }
      var matches = part.matchAll(PRETOK);
      for (var m of matches) {
        var syms = bpeChunk(m[0]);
        for (var k = 0; k < syms.length; k++) {
          var s = syms[k];
          out.push({ id: TOK.vocab[s] !== undefined ? TOK.vocab[s] : 0, text: s, special: false });
        }
      }
    });
    return out;
  }

  function renderTokens() {
    var input = $('#token-input');
    var out = $('#token-output');
    var stats = $('#token-stats');
    if (!input || !out) return;
    var text = input.value;
    var toks = encodeDetailed(text);
    clear(out);
    toks.forEach(function (t) {
      var chip = el('span', 'token-chip' + (t.special ? ' special' : ''));
      chip.appendChild(el('span', 'tt', prettyTok(t.text)));
      chip.appendChild(el('span', 'ti', String(t.id)));
      chip.title = t.special ? 'special token' : JSON.stringify(t.text);
      out.appendChild(chip);
    });
    if (!toks.length) out.appendChild(el('span', 'muted small', 'Nothing to tokenize.'));
    if (stats) {
      var chars = Array.from(text).length;
      stats.textContent = chars + ' characters → ' + toks.length + ' tokens · ' +
        (chars / Math.max(1, toks.length)).toFixed(2) + ' characters per token';
    }
  }
  var tokenInput = $('#token-input');
  if (tokenInput) tokenInput.addEventListener('input', renderTokens);
  $$('#token-presets .chip-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!tokenInput) return;
      tokenInput.value = btn.getAttribute('data-text') || '';
      renderTokens();
      tokenInput.focus();
    });
  });
  renderTokens();

  /* ---------------- merge stepper ---------------- */

  var mergeSteps = [], mergeIndex = 0;

  function computeMergeSteps(word) {
    if (!word) return [];
    var bytes = Array.from(new TextEncoder().encode(word));
    var syms = bytes.map(function (b) { return B2U.get(b); });
    var steps = [{ syms: syms.slice(), pair: null, merged: null, rank: null }];
    while (syms.length > 1) {
      var best = Infinity, bi = -1;
      for (var i = 0; i < syms.length - 1; i++) {
        var r = RANKS.get(syms[i] + '\u0001' + syms[i + 1]);
        if (r !== undefined && r < best) { best = r; bi = i; }
      }
      if (bi < 0) break;
      var a = syms[bi], b = syms[bi + 1], out = [], j = 0;
      while (j < syms.length) {
        if (j < syms.length - 1 && syms[j] === a && syms[j + 1] === b) { out.push(a + b); j += 2; }
        else { out.push(syms[j]); j++; }
      }
      syms = out;
      steps.push({ syms: syms.slice(), pair: [a, b], merged: a + b, rank: best });
    }
    return steps;
  }

  function renderMerge() {
    var stage = $('#merge-stage');
    var caption = $('#merge-caption');
    var prev = $('#merge-prev');
    var next = $('#merge-next');
    if (!stage) return;
    clear(stage);
    if (!mergeSteps.length) {
      stage.appendChild(el('span', 'muted small', 'Type a word to see its byte-level merges.'));
      if (caption) caption.textContent = '—';
      if (prev) prev.disabled = true;
      if (next) next.disabled = true;
      return;
    }
    var step = mergeSteps[mergeIndex];
    step.syms.forEach(function (s) {
      var chip = el('span', 'merge-sym' + (step.merged && s === step.merged ? ' merged' : ''), prettyTok(s));
      chip.title = JSON.stringify(s);
      stage.appendChild(chip);
    });
    if (prev) prev.disabled = mergeIndex === 0;
    if (next) next.disabled = mergeIndex === mergeSteps.length - 1;
    if (caption) {
      if (mergeIndex === 0) {
        caption.textContent = 'Start: ' + step.syms.length + ' byte-level symbols. The tokenizer begins with raw bytes.';
      } else if (mergeIndex === mergeSteps.length - 1) {
        var finalTokens = step.syms.map(prettyTok).join(' + ');
        var single = step.syms.length === 1 && TOK.vocab[step.syms[0]] !== undefined;
        caption.textContent = 'Final: ' + step.syms.length + ' token' + (step.syms.length === 1 ? '' : 's') +
          ' (' + finalTokens + ').' + (single ? ' This word is a single token in the vocabulary.' : '');
      } else {
        caption.textContent = 'Merge rank ' + step.rank + ': “' + prettyTok(step.pair[0]) + '” + “' +
          prettyTok(step.pair[1]) + '” → “' + prettyTok(step.merged) + '”.';
      }
    }
  }
  var mergeWord = $('#merge-word');
  function resetMerge() {
    mergeSteps = computeMergeSteps(mergeWord ? mergeWord.value.trim() : '');
    mergeIndex = 0;
    renderMerge();
  }
  if (mergeWord) {
    mergeWord.addEventListener('input', resetMerge);
    resetMerge();
  }
  var mergePrev = $('#merge-prev');
  var mergeNext = $('#merge-next');
  if (mergePrev) mergePrev.addEventListener('click', function () {
    if (mergeIndex > 0) { mergeIndex--; renderMerge(); }
  });
  if (mergeNext) mergeNext.addEventListener('click', function () {
    if (mergeIndex < mergeSteps.length - 1) { mergeIndex++; renderMerge(); }
  });

  /* ---------------- real next-token bars ---------------- */

  function renderNextBars(container, dist, n) {
    if (!container) return;
    clear(container);
    if (!dist || !dist.length) return;
    var top = dist.slice(0, n || 6);
    var max = 0;
    top.forEach(function (d) { if (d.p > max) max = d.p; });
    top.forEach(function (d) {
      var row = el('div', 'next-bar');
      var label = el('span', 'nb-label', prettyTok(d.tok));
      label.title = JSON.stringify(d.tok);
      var track = el('span', 'nb-track');
      var fill = el('span', 'nb-fill');
      fill.style.width = (max > 0 ? d.p / max * 100 : 0) + '%';
      track.appendChild(fill);
      row.appendChild(label);
      row.appendChild(track);
      row.appendChild(el('span', 'nb-p', pct(d.p)));
      container.appendChild(row);
    });
  }
  if (INSIGHTS.next) {
    renderNextBars($('#space-a'), INSIGHTS.next.feel, 6);
    renderNextBars($('#space-b'), INSIGHTS.next_trailing, 6);
  }

  /* ---------------- shape flow ---------------- */

  var SHAPES = {
    ids: {
      title: 'Token IDs',
      formula: '[1, 19] integers',
      body: 'The prompt is a sequence of 19 token IDs, each an index into the 4,096-row vocabulary. For a batch of 32 conversations, this becomes [32, 128] after padding and truncation.',
      note: 'This is the only thing the model ever receives. No characters, no words, no spaces.'
    },
    embed: {
      title: 'Token + position embeddings',
      formula: '[1, 19, 384]',
      body: 'Each ID selects a 384-number row from the token table. A learned position vector is added so the model can tell “water” at position 12 from “water” at position 14.',
      note: 'Parameters: 1,572,864 (token table) + 49,152 (position table).'
    },
    attn: {
      title: 'Causal self-attention',
      formula: 'QKV: [1, 19, 1152] → 6 heads × [1, 19, 64]',
      body: 'Queries, keys, and values are projected. Scores are query·key / √64, masked so position i cannot see j > i, softmaxed, then used to weight the values. Heads are concatenated and projected back to 384.',
      note: 'Attention scores are [1, 6, 19, 19]: 19 queries × 19 keys, for each of 6 heads.'
    },
    ffn: {
      title: 'Feed-forward network',
      formula: '[1, 19, 384] → [1, 19, 768] → [1, 19, 384]',
      body: 'Each token is processed independently through a 384→768 ReLU layer and back down to 384. This is a per-token calculator, not a mixing operation.',
      note: 'The block is repeated six times, each wrapped in a residual connection and LayerNorm.'
    },
    logits: {
      title: 'Logits',
      formula: '[1, 19, 4096]',
      body: 'A final linear layer maps each 384-vector to 4,096 raw scores. Higher means more likely, but the numbers are not probabilities and do not sum to 1.',
      note: 'The output layer shares its weights with the token embedding table (weight tying).'
    },
    softmax: {
      title: 'Probabilities',
      formula: '[1, 19, 4096], each row sums to 1',
      body: 'Softmax exponentiates the logits and normalizes. For generation, only the last position matters: it is the distribution over the next token.',
      note: 'During training, the same distribution is computed at every position and compared with the actual next token.'
    }
  };
  function renderShape(key) {
    var panel = $('#shape-panel');
    if (!panel) return;
    var s = SHAPES[key];
    clear(panel);
    panel.appendChild(el('h4', null, s.title));
    panel.appendChild(el('span', 'shape-formula', s.formula));
    panel.appendChild(el('p', null, s.body));
    panel.appendChild(el('p', 'muted', s.note));
  }
  $$('.shape-step').forEach(function (btn) {
    btn.addEventListener('click', function () {
      $$('.shape-step').forEach(function (b) {
        b.classList.toggle('active', b === btn);
        b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      });
      renderShape(btn.getAttribute('data-shape'));
    });
  });
  renderShape('ids');

  /* ---------------- real attention ---------------- */

  var attnLayer = '5';
  var attnHead = 'avg';
  var attnTokens = INSIGHTS.tokens || [];
  var attnQuery = attnTokens.length ? attnTokens.length - 1 : 0;

  function attnMatrix() {
    if (!INSIGHTS.layers) return [];
    if (attnLayer === '5' && attnHead !== 'avg' && INSIGHTS.heads_layer5) {
      return INSIGHTS.heads_layer5[Number(attnHead)];
    }
    return INSIGHTS.layers[attnLayer] || [];
  }

  function renderAttention() {
    var grid = $('#attn-grid');
    var caption = $('#attn-caption');
    if (!grid) return;
    var m = attnMatrix();
    var n = attnTokens.length;
    if (!m.length || !n) {
      grid.appendChild(el('p', 'muted small', 'Attention data unavailable.'));
      return;
    }
    clear(grid);
    grid.style.gridTemplateColumns = 'repeat(' + n + ', minmax(0, 1fr))';
    var max = 0;
    m.forEach(function (row) { row.forEach(function (v) { if (v > max) max = v; }); });
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        var cell = el('div', 'attn-cell');
        cell.setAttribute('data-r', r);
        cell.setAttribute('data-c', c);
        if (c > r) {
          cell.classList.add('masked');
        } else {
          var v = m[r][c] || 0;
          var a = max > 0 ? Math.pow(v / max, 0.55) : 0;
          cell.style.background = 'color-mix(in srgb, var(--accent) ' + Math.round(a * 100) + '%, transparent)';
        }
        grid.appendChild(cell);
      }
    }
    if (caption) {
      var label = attnLayer === '5' && attnHead !== 'avg'
        ? 'Layer 6, head ' + (Number(attnHead) + 1)
        : 'Layer ' + (Number(attnLayer) + 1) + ', average of 6 heads';
      caption.textContent = label + '. Hover a cell to inspect a query→key weight. Use the row view below for keyboard access.';
    }
    renderAttnRow();
  }

  function renderAttnRow() {
    var bars = $('#attn-row-bars-inner');
    var select = $('#attn-query');
    if (!bars || !select) return;
    var m = attnMatrix();
    var row = m[attnQuery] || [];
    var entries = [];
    for (var i = 0; i <= attnQuery && i < row.length; i++) {
      entries.push({ i: i, v: row[i] || 0 });
    }
    entries.sort(function (a, b) { return b.v - a.v; });
    var top = entries.slice(0, 6);
    var max = top.length ? top[0].v : 0;
    clear(bars);
    top.forEach(function (e) {
      var rowEl = el('div', 'next-bar');
      var label = el('span', 'nb-label', prettyTok(attnTokens[e.i]));
      label.title = JSON.stringify(attnTokens[e.i]);
      var track = el('span', 'nb-track');
      var fill = el('span', 'nb-fill');
      fill.style.width = (max > 0 ? e.v / max * 100 : 0) + '%';
      track.appendChild(fill);
      rowEl.appendChild(label);
      rowEl.appendChild(track);
      rowEl.appendChild(el('span', 'nb-p', (e.v * 100).toFixed(1) + '%'));
      bars.appendChild(rowEl);
    });
    var heading = $('#attn-row-heading');
    if (heading) heading.textContent = 'What “' + prettyTok(attnTokens[attnQuery]) + '” reads most';
  }

  (function buildAttnRowView() {
    var wrap = $('.attn-wrap');
    if (!wrap || !attnTokens.length) return;
    var box = el('div', 'attn-row-bars');
    var head = el('h4', null, 'What the last token reads most');
    head.id = 'attn-row-heading';
    var field = el('label', 'field');
    field.appendChild(el('span', null, 'Query token'));
    var select = el('select');
    select.id = 'attn-query';
    attnTokens.forEach(function (t, i) {
      var o = el('option', null, i + ': ' + prettyTok(t));
      o.value = String(i);
      select.appendChild(o);
    });
    select.value = String(attnQuery);
    select.addEventListener('change', function () {
      attnQuery = Number(select.value);
      renderAttnRow();
    });
    field.appendChild(select);
    box.appendChild(head);
    box.appendChild(field);
    var inner = el('div', 'next-bars');
    inner.id = 'attn-row-bars-inner';
    box.appendChild(inner);
    wrap.parentNode.insertBefore(box, wrap.nextSibling);

    var tooltip = $('#attn-tooltip');
    var grid = $('#attn-grid');
    if (grid && tooltip) {
      grid.addEventListener('mouseover', function (e) {
        var cell = e.target.closest ? e.target.closest('.attn-cell') : null;
        if (!cell) return;
        var r = Number(cell.getAttribute('data-r'));
        var c = Number(cell.getAttribute('data-c'));
        if (c > r) {
          tooltip.textContent = 'masked: “' + prettyTok(attnTokens[r]) + '” cannot see the future token “' + prettyTok(attnTokens[c]) + '”';
        } else {
          var v = (attnMatrix()[r] || [])[c] || 0;
          tooltip.textContent = prettyTok(attnTokens[r]) + ' → ' + prettyTok(attnTokens[c]) + ': ' + v.toFixed(4);
        }
        tooltip.classList.add('show');
      });
      grid.addEventListener('mouseleave', function () { tooltip.classList.remove('show'); });
    }
  })();

  $$('#attn-layers .seg-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      attnLayer = btn.getAttribute('data-layer');
      $$('#attn-layers .seg-btn').forEach(function (b) { b.classList.toggle('active', b === btn); });
      var headSel = $('#attn-head');
      if (headSel) {
        if (attnLayer === '5') {
          headSel.disabled = false;
        } else {
          headSel.disabled = true;
          headSel.value = 'avg';
          attnHead = 'avg';
        }
      }
      renderAttention();
    });
  });
  var attnHeadSel = $('#attn-head');
  if (attnHeadSel) {
    attnHeadSel.addEventListener('change', function () {
      attnHead = attnHeadSel.value;
      renderAttention();
    });
  }
  renderAttention();

  /* ---------------- responsive SVG helper ---------------- */

  function responsive(svg, draw, height) {
    if (!svg) return function () {};
    var lastW = 0;
    function measure() {
      var w = svg.getBoundingClientRect().width || svg.clientWidth || 320;
      return Math.max(220, Math.floor(w));
    }
    function paint(w) {
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + height);
      clear(svg);
      draw(w, height);
    }
    function onResize() {
      var w = measure();
      if (w !== lastW) { lastW = w; paint(w); }
    }
    lastW = measure();
    paint(lastW);
    if ('ResizeObserver' in window) {
      var ro = new ResizeObserver(onResize);
      observers.push(ro);
      ro.observe(svg);
    }
    window.addEventListener('resize', onResize, { passive: true });
    return function force() {
      lastW = measure();
      paint(lastW);
    };
  }

  /* ---------------- loss curve ---------------- */

  (function initLoss() {
    var svg = $('#loss-curve');
    var slider = $('#loss-p');
    if (!svg || !slider) return;
    function draw(w, h) {
      var p = Number(slider.value);
      var loss = -Math.log(p);
      var m = { l: 42, r: 16, t: 16, b: 40 };
      var x = function (v) { return m.l + v * (w - m.l - m.r); };
      var y = function (v) { return h - m.b - (v / 5) * (h - m.t - m.b); };

      var g = svgEl('g', { 'class': 'axis' });
      [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
        var gx = x(t);
        g.appendChild(svgEl('line', { x1: gx, y1: m.t, x2: gx, y2: h - m.b, 'class': 'grid-line' }));
        addText(g, gx, h - m.b + 14, String(t), null, 'middle');
      });
      [0, 1, 2, 3, 4, 5].forEach(function (t) {
        var gy = y(t);
        g.appendChild(svgEl('line', { x1: m.l, y1: gy, x2: w - m.r, y2: gy, 'class': 'grid-line' }));
        addText(g, m.l - 8, gy + 3, String(t), null, 'end');
      });
      addText(g, m.l, h - 6, 'p', 'axis-title', 'start');
      addText(g, m.l, m.t - 4, 'loss', 'axis-title', 'start');
      svg.appendChild(g);

      var path = [];
      for (var v = 0.01; v <= 0.991; v += 0.005) {
        path.push((path.length ? 'L' : 'M') + x(v).toFixed(1) + ' ' + y(-Math.log(v)).toFixed(1));
      }
      svg.appendChild(svgEl('path', { d: path.join(' '), 'class': 'series-train' }));

      var cx = x(p), cy = y(loss);
      svg.appendChild(svgEl('line', { x1: cx, y1: cy, x2: cx, y2: h - m.b, 'class': 'grid-line', 'stroke-dasharray': '3 3' }));
      svg.appendChild(svgEl('circle', { cx: cx, cy: cy, r: 4.5, 'class': 'series-marker' }));
      var anchor = p > 0.78 ? 'end' : 'start';
      var tx = p > 0.78 ? cx - 8 : cx + 8;
      addText(svg, tx, clamp(cy - 8, m.t + 10, h - m.b - 4), loss.toFixed(2), 'chart-label', anchor);
    }
    var force = responsive(svg, draw, 190);
    slider.addEventListener('input', function () {
      var p = Number(slider.value);
      var lp = $('#loss-p-label');
      var lv = $('#loss-value');
      if (lp) lp.textContent = p.toFixed(2);
      if (lv) lv.textContent = (-Math.log(p)).toFixed(3);
      force();
    });
    var lp0 = $('#loss-p-label'), lv0 = $('#loss-value');
    if (lp0) lp0.textContent = Number(slider.value).toFixed(2);
    if (lv0) lv0.textContent = (-Math.log(Number(slider.value))).toFixed(3);
  })();

  /* ---------------- sampling ---------------- */

  (function initSampling() {
    var ctxSel = $('#sample-context');
    var tempRange = $('#temp-range');
    var topkRange = $('#topk-range');
    var bars = $('#sample-bars');
    var sampled = $('#sampled-token');
    var note = $('#sampled-note');
    if (!ctxSel || !tempRange || !topkRange || !bars) return;

    function currentDist() {
      var dist = (INSIGHTS.next || {})[ctxSel.value] || [];
      var T = Number(tempRange.value);
      var k = Number(topkRange.value);
      var top = dist.slice(0, k).map(function (d) {
        return { tok: d.tok, p: Math.pow(d.p, 1 / T) };
      });
      var sum = top.reduce(function (s, d) { return s + d.p; }, 0);
      top.forEach(function (d) { d.p = sum > 0 ? d.p / sum : 0; });
      return top;
    }

    function render() {
      var top = currentDist();
      var tl = $('#temp-label'), kl = $('#topk-label');
      if (tl) tl.textContent = Number(tempRange.value).toFixed(2);
      if (kl) kl.textContent = String(topkRange.value);
      clear(bars);
      var max = top.length ? top[0].p : 0;
      top.forEach(function (d) {
        var row = el('div', 'next-bar');
        var label = el('span', 'nb-label', prettyTok(d.tok));
        label.title = JSON.stringify(d.tok);
        var track = el('span', 'nb-track');
        var fill = el('span', 'nb-fill');
        fill.style.width = (max > 0 ? d.p / max * 100 : 0) + '%';
        track.appendChild(fill);
        row.appendChild(label);
        row.appendChild(track);
        row.appendChild(el('span', 'nb-p', pct(d.p)));
        bars.appendChild(row);
      });
    }

    function sample() {
      var top = currentDist();
      if (!top.length) return;
      var r = Math.random(), acc = 0, chosen = top[top.length - 1];
      for (var i = 0; i < top.length; i++) {
        acc += top[i].p;
        if (r <= acc) { chosen = top[i]; break; }
      }
      if (sampled) sampled.textContent = prettyTok(chosen.tok);
      if (note) {
        note.textContent = 'sampled with p = ' + pct(chosen.p) + ' · temperature ' +
          Number(tempRange.value).toFixed(2) + ' · top-k ' + topkRange.value;
      }
    }

    ctxSel.addEventListener('change', function () {
      render();
      if (sampled) sampled.textContent = '—';
      if (note) note.textContent = 'Press “Sample next token”.';
    });
    function resetSampled() {
      if (sampled) sampled.textContent = '—';
      if (note) note.textContent = 'Press “Sample next token”.';
    }
    tempRange.addEventListener('input', function () { render(); resetSampled(); });
    topkRange.addEventListener('input', function () { render(); resetSampled(); });
    var btn = $('#sample-next-btn');
    if (btn) btn.addEventListener('click', sample);
    render();
  })();

  /* ---------------- gradient descent ---------------- */

  (function initGD() {
    var svg = $('#gd-chart');
    if (!svg) return;
    var state = { w: -2.5, lr: 0.1, trail: [], diverged: false };
    var lrRange = $('#gd-lr');
    var lrLabel = $('#gd-lr-label');
    var wOut = $('#gd-w'), lossOut = $('#gd-loss'), gradOut = $('#gd-grad'), status = $('#gd-status');

    function lossAt(w) { return (w - 3) * (w - 3); }
    function gradAt(w) { return 2 * (w - 3); }

    function draw(w, h) {
      var m = { l: 44, r: 16, t: 18, b: 44 };
      var x = function (v) { return m.l + ((v + 4) / 14) * (w - m.l - m.r); };
      var y = function (v) { return h - m.b - (clamp(v, 0, 55) / 55) * (h - m.t - m.b); };

      var g = svgEl('g', { 'class': 'axis' });
      [-4, 0, 3, 6, 10].forEach(function (t) {
        var gx = x(t);
        g.appendChild(svgEl('line', { x1: gx, y1: m.t, x2: gx, y2: h - m.b, 'class': 'grid-line' }));
        addText(g, gx, h - m.b + 14, String(t), null, 'middle');
      });
      [0, 10, 20, 30, 40, 50].forEach(function (t) {
        var gy = y(t);
        g.appendChild(svgEl('line', { x1: m.l, y1: gy, x2: w - m.r, y2: gy, 'class': 'grid-line' }));
        addText(g, m.l - 8, gy + 3, String(t), null, 'end');
      });
      addText(g, m.l, h - 6, 'w', 'axis-title', 'start');
      addText(g, m.l, m.t - 4, 'loss', 'axis-title', 'start');
      svg.appendChild(g);

      var d = [];
      for (var v = -4; v <= 10.001; v += 0.1) {
        d.push((d.length ? 'L' : 'M') + x(v).toFixed(1) + ' ' + y(lossAt(v)).toFixed(1));
      }
      svg.appendChild(svgEl('path', { d: d.join(' '), 'class': 'series-train' }));

      svg.appendChild(svgEl('line', { x1: x(3), y1: m.t, x2: x(3), y2: h - m.b, 'class': 'grid-line', 'stroke-dasharray': '4 4' }));
      addText(svg, x(3) + 4, m.t + 10, 'minimum', 'axis-text', 'start');

      state.trail.forEach(function (tw) {
        if (tw < -4 || tw > 10) return;
        svg.appendChild(svgEl('circle', { cx: x(tw), cy: y(lossAt(tw)), r: 2, 'class': 'series-marker-eval', opacity: 0.5 }));
      });

      var dw = clamp(state.w, -4, 10);
      var dl = lossAt(state.w);
      svg.appendChild(svgEl('circle', { cx: x(dw), cy: y(dl), r: 6, 'class': 'series-marker' }));
      var label = state.diverged ? 'diverged' : 'w = ' + state.w.toFixed(2);
      addText(svg, clamp(x(dw) + 9, m.l + 4, w - m.r - 4), clamp(y(dl) - 10, m.t + 10, h - m.b - 4), label, 'chart-label', x(dw) > w * 0.72 ? 'end' : 'start');
    }
    var force = responsive(svg, draw, 250);

    function update() {
      if (lrLabel) lrLabel.textContent = state.lr.toFixed(2);
      if (state.diverged) {
        if (wOut) wOut.textContent = 'diverged';
        if (lossOut) lossOut.textContent = '—';
        if (gradOut) gradOut.textContent = '—';
        if (status) status.textContent = 'Diverged: the learning rate is too large. Reset and try a smaller step.';
      } else {
        if (wOut) wOut.textContent = state.w.toFixed(2);
        if (lossOut) lossOut.textContent = lossAt(state.w).toFixed(2);
        if (gradOut) gradOut.textContent = gradAt(state.w).toFixed(2);
        if (status) {
          if (Math.abs(state.w - 3) < 0.01) status.textContent = 'Converged near the minimum.';
          else status.textContent = 'Step downhill: w ← w − learning rate × gradient.';
        }
      }
      force();
    }
    function step() {
      if (state.diverged) return;
      var nw = state.w - state.lr * gradAt(state.w);
      if (!isFinite(nw) || Math.abs(nw) > 1e6) {
        state.diverged = true;
      } else {
        state.w = nw;
        state.trail.push(nw);
        if (state.trail.length > 60) state.trail.shift();
      }
      update();
    }
    var stepBtn = $('#gd-step'), runBtn = $('#gd-run'), resetBtn = $('#gd-reset');
    if (stepBtn) stepBtn.addEventListener('click', step);
    if (runBtn) runBtn.addEventListener('click', function () {
      for (var i = 0; i < 20 && !state.diverged; i++) step();
    });
    if (resetBtn) resetBtn.addEventListener('click', function () {
      state.w = -2.5; state.trail = []; state.diverged = false;
      if (lrRange) state.lr = Number(lrRange.value);
      update();
    });
    if (lrRange) lrRange.addEventListener('input', function () {
      state.lr = Number(lrRange.value);
      update();
    });
    update();
  })();

  /* ---------------- learning-rate schedule ---------------- */

  (function initLR() {
    var svg = $('#lr-chart');
    if (!svg) return;
    var LR = 3e-4, MIN = 3e-5, WARM = 200, STEPS = 10000;
    function lrAt(step) {
      if (step < WARM) return LR * step / WARM;
      var progress = (step - WARM) / (STEPS - WARM);
      return MIN + (LR - MIN) * 0.5 * (1 + Math.cos(Math.PI * progress));
    }
    function draw(w, h) {
      var m = { l: 54, r: 18, t: 20, b: 46 };
      var x = function (s) { return m.l + (s / STEPS) * (w - m.l - m.r); };
      var y = function (v) { return h - m.b - (v / 3.2e-4) * (h - m.t - m.b); };

      var g = svgEl('g', { 'class': 'axis' });
      [0, 2500, 5000, 7500, 10000].forEach(function (t) {
        var gx = x(t);
        g.appendChild(svgEl('line', { x1: gx, y1: m.t, x2: gx, y2: h - m.b, 'class': 'grid-line' }));
        addText(g, gx, h - m.b + 14, t === 0 ? '0' : (t / 1000) + 'k', null, 'middle');
      });
      [0, 1e-4, 2e-4, 3e-4].forEach(function (t) {
        var gy = y(t);
        g.appendChild(svgEl('line', { x1: m.l, y1: gy, x2: w - m.r, y2: gy, 'class': 'grid-line' }));
        addText(g, m.l - 8, gy + 3, t === 0 ? '0' : (t / 1e-4).toFixed(0) + 'e-4', null, 'end');
      });
      addText(g, m.l, h - 6, 'optimizer step', 'axis-title', 'start');
      addText(g, m.l, m.t - 6, 'learning rate', 'axis-title', 'start');
      svg.appendChild(g);

      var pts = [];
      for (var s = 0; s <= STEPS; s += 50) pts.push([x(s), y(lrAt(s))]);
      var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
      var area = line + ' L' + x(STEPS).toFixed(1) + ' ' + (h - m.b) + ' L' + x(0).toFixed(1) + ' ' + (h - m.b) + ' Z';
      var areaEl = svgEl('path', { d: area });
      areaEl.style.fill = 'var(--accent-soft)';
      svg.appendChild(areaEl);
      svg.appendChild(svgEl('path', { d: line, 'class': 'series-train' }));

      svg.appendChild(svgEl('line', { x1: x(WARM), y1: m.t, x2: x(WARM), y2: h - m.b, 'class': 'grid-line', 'stroke-dasharray': '3 3' }));
      addText(svg, x(STEPS * 0.55), y(lrAt(STEPS * 0.55)) - 10, 'cosine decay', 'chart-label', 'middle');
    }
    responsive(svg, draw, 220);
  })();

  /* ---------------- training curve ---------------- */

  (function initCurve() {
    var svg = $('#curve-chart');
    var legend = $('#curve-legend');
    if (!svg || !CURVE) return;
    var note = $('#curve-note');
    if (note) note.textContent = 'real CPU run · ' + CURVE.elapsed + ' s for ' + CURVE.steps + ' steps';
    function draw(w, h) {
      var m = { l: 46, r: 64, t: 18, b: 46 };
      var maxX = CURVE.steps;
      var x = function (s) { return m.l + (s / maxX) * (w - m.l - m.r); };
      var y = function (v) { return h - m.b - (v / 9) * (h - m.t - m.b); };

      var g = svgEl('g', { 'class': 'axis' });
      [0, 100, 200, 300, 400, 500].forEach(function (t) {
        var gx = x(t);
        g.appendChild(svgEl('line', { x1: gx, y1: m.t, x2: gx, y2: h - m.b, 'class': 'grid-line' }));
        addText(g, gx, h - m.b + 14, String(t), null, 'middle');
      });
      [0, 2, 4, 6, 8].forEach(function (t) {
        var gy = y(t);
        g.appendChild(svgEl('line', { x1: m.l, y1: gy, x2: w - m.r, y2: gy, 'class': 'grid-line' }));
        addText(g, m.l - 8, gy + 3, String(t), null, 'end');
      });
      addText(g, m.l, h - 6, 'optimizer step', 'axis-title', 'start');
      addText(g, m.l, m.t - 6, 'cross-entropy loss', 'axis-title', 'start');
      svg.appendChild(g);

      [8.317, 0.407].forEach(function (v, i) {
        svg.appendChild(svgEl('line', { x1: m.l, y1: y(v), x2: w - m.r, y2: y(v), 'class': 'grid-line', 'stroke-dasharray': '4 4' }));
        addText(svg, w - m.r + 4, y(v) + 3, i === 0 ? '8.32' : '0.407', 'chart-label', 'start');
      });

      var d = CURVE.train.map(function (p, i) { return (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1); }).join(' ');
      svg.appendChild(svgEl('path', { d: d, 'class': 'series-train' }));

      CURVE.evals.forEach(function (p) {
        svg.appendChild(svgEl('circle', { cx: x(p[0]), cy: y(p[1]), r: 3, 'class': 'series-marker-eval' }));
      });
    }
    responsive(svg, draw, 260);
    if (legend) {
      clear(legend);
      var a = el('span');
      var sa = el('i', 'sw');
      sa.style.background = 'var(--accent)';
      a.appendChild(sa);
      a.appendChild(document.createTextNode(' train loss (per step)'));
      var b = el('span');
      var sb = el('i', 'sw');
      sb.style.background = 'var(--accent-2)';
      b.appendChild(sb);
      b.appendChild(document.createTextNode(' held-out loss (every 50 steps)'));
      legend.appendChild(a);
      legend.appendChild(b);
    }
  })();

  /* ---------------- training code stepper ---------------- */

  var CODE_STEPS = [
    { id: 'setup', label: 'Model and device', start: 48, end: 58, note: 'Construct the 8.7M-parameter model, pick a device, seed the random number generator, and load the tokenizer path. The weights are still random here.' },
    { id: 'loaders', label: 'Data loaders', start: 60, end: 68, note: 'Two loaders: one shuffled for training, one unshuffled for held-out evaluation. Each item is a pair of token sequences shifted by one position.' },
    { id: 'optim', label: 'Optimizer and AMP', start: 70, end: 76, note: 'AdamW with weight decay and betas 0.9/0.95. On CUDA, a gradient scaler enables mixed-precision training; on CPU it is skipped.' },
    { id: 'batch', label: 'Get a batch, set the LR', start: 91, end: 99, note: 'Pull 32 sequences, move them to the device, compute the scheduled learning rate for this step, and write it into the optimizer.' },
    { id: 'forward', label: 'Forward pass and loss', start: 101, end: 104, note: 'The forward pass returns logits and a scalar cross-entropy loss. The loss is the average −ln p(correct next token) over all non-padding positions.' },
    { id: 'backward', label: 'Backward pass', start: 104, end: 108, note: 'backward() walks the graph in reverse and computes a gradient for every parameter. Under AMP, the scaler prevents small gradients from underflowing.' },
    { id: 'update', label: 'Clip, step, zero', start: 105, end: 115, note: 'Gradients are clipped to a total norm of 1.0, the optimizer updates every weight, and the gradients are cleared for the next batch.' },
    { id: 'eval', label: 'Evaluate and checkpoint', start: 118, end: 144, note: 'Every 200 steps, measure held-out loss. If it improved, save best_model.pt with the weights, config, step, and eval loss. Periodic checkpoints are saved every 500 steps.' }
  ];
  var codeState = 'setup';

  function renderTrainCode() {
    var pre = $('#train-code');
    var stepsBox = $('#code-steps');
    var noteBox = $('#code-note');
    if (!pre || !stepsBox) return;
    var code = pre.querySelector('code');
    if (!code) return;
    clear(code);
    TRAIN_CODE.lines.forEach(function (line, i) {
      var n = TRAIN_CODE.start + i;
      var span = el('span', 'cl');
      span.setAttribute('data-line', String(n));
      var ln = el('span', 'ln', String(n));
      span.appendChild(ln);
      span.appendChild(document.createTextNode(line));
      code.appendChild(span);
    });
    clear(stepsBox);
    CODE_STEPS.forEach(function (s) {
      var b = el('button', 'code-step');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', s.id === codeState ? 'true' : 'false');
      if (s.id === codeState) b.classList.add('active');
      b.appendChild(el('b', null, 'step ' + (CODE_STEPS.indexOf(s) + 1)));
      b.appendChild(document.createTextNode(s.label));
      b.addEventListener('click', function () {
        codeState = s.id;
        renderTrainCode();
      });
      stepsBox.appendChild(b);
    });
    var active = CODE_STEPS.filter(function (s) { return s.id === codeState; })[0] || CODE_STEPS[0];
    $$('.cl', code).forEach(function (lineEl) {
      var n = Number(lineEl.getAttribute('data-line'));
      lineEl.classList.toggle('hl', n >= active.start && n <= active.end);
    });
    if (noteBox) {
      clear(noteBox);
      noteBox.appendChild(el('p', null, active.note));
    }
    var first = $$('.cl.hl', code)[0];
    if (first) {
      pre.scrollTop = 0;
      var preRect = pre.getBoundingClientRect();
      var lineRect = first.getBoundingClientRect();
      var target = (lineRect.top - preRect.top) - pre.clientHeight / 2 + lineRect.height / 2;
      pre.scrollTop = Math.max(0, target);
    }
  }
  if (TRAIN_CODE.lines.length) renderTrainCode();

  /* ---------------- glossary ---------------- */

  var GLOSSARY = [
    ['Parameter / weight', 'One of the numbers inside the model that training adjusts. GuppyLM has 8,726,016.'],
    ['Tensor', 'An n-dimensional array of numbers. A vector is 1D, a matrix is 2D, a batch of token sequences is 3D.'],
    ['Embedding', 'A learned lookup table that maps a discrete ID to a vector of numbers.'],
    ['Token', 'A chunk of text (a character, part of a word, a word, or a special marker) that the tokenizer treats as one unit.'],
    ['Tokenizer', 'The program that converts text to token IDs and back. GuppyLM uses byte-level BPE.'],
    ['BPE (byte-pair encoding)', 'A compression-style algorithm that repeatedly merges the most frequent adjacent symbol pair.'],
    ['Vocabulary', 'The set of tokens the model knows. GuppyLM requested 4,096 slots and learned 2,418 real tokens.'],
    ['Special token', 'A marker with a reserved ID, such as <pad>, <|im_start|>, and <|im_end|>.'],
    ['Logit', 'A raw, unnormalized score from the final linear layer. Higher means more likely; logits do not sum to 1.'],
    ['Softmax', 'A function that turns a vector of logits into positive probabilities that sum to 1.'],
    ['Cross-entropy loss', 'The training objective: −ln p, where p is the probability assigned to the correct next token.'],
    ['Perplexity', 'exp(loss). Roughly, the effective number of equally likely choices the model is deciding among.'],
    ['Gradient', 'A vector of partial derivatives telling how the loss changes when each weight changes.'],
    ['Backpropagation', 'The algorithm that computes gradients by applying the chain rule backwards through the network.'],
    ['Gradient descent', 'Updating weights by stepping opposite the gradient: w ← w − learning_rate × gradient.'],
    ['Learning rate', 'The size of the step taken on each update. GuppyLM peaks at 3e-4.'],
    ['Optimizer / AdamW', 'The update rule. AdamW adapts the step per weight and applies weight decay.'],
    ['Weight decay', 'A small pull of weights toward zero, used as regularization. GuppyLM uses 0.1.'],
    ['Batch', 'A group of examples processed together before one weight update. GuppyLM uses 32.'],
    ['Step', 'One forward pass, loss computation, backward pass, and optimizer update on one batch.'],
    ['Epoch', 'One full pass over the training set. GuppyLM’s 10,000 steps are about 5.6 epochs.'],
    ['Forward pass', 'Running the model from token IDs to output logits.'],
    ['Inference', 'Using a trained model to generate output. No gradients and no weight updates.'],
    ['Attention', 'A mechanism where each token computes a weighted average of earlier tokens’ value vectors.'],
    ['Query / key / value', 'The three projections used by attention: what I seek, what I offer, and what I carry.'],
    ['Causal mask', 'A mask that prevents a token from attending to future tokens, so training matches generation.'],
    ['Multi-head attention', 'Running several attention operations in parallel in lower-dimensional subspaces. GuppyLM uses 6 heads of 64 dimensions.'],
    ['Residual connection', 'Adding a layer’s input back to its output (x + f(x)), which helps gradients flow.'],
    ['LayerNorm', 'Normalizing each token’s vector to a stable scale before a layer.'],
    ['Feed-forward network (FFN)', 'A small two-layer per-token network inside each transformer block.'],
    ['Dropout', 'Randomly zeroing activations during training to reduce overfitting. Off at inference.'],
    ['Context window', 'The maximum number of tokens the model can condition on. GuppyLM’s is 128.'],
    ['Checkpoint', 'A saved copy of the model weights (and config) at a point during training.'],
    ['Quantization', 'Storing weights at lower precision (here uint8) to shrink the model.'],
    ['ONNX', 'A portable model file format used to run the model in the browser via WebAssembly.'],
    ['Temperature', 'A divisor applied to logits before softmax. Below 1 sharpens, above 1 flattens.'],
    ['Top-k sampling', 'Keeping only the k most likely tokens, renormalizing, then sampling from them.'],
    ['Supervised learning', 'Learning from examples of inputs and desired outputs.'],
    ['Overfitting', 'Memorizing training examples instead of learning patterns that generalize.'],
    ['Regularization', 'Techniques such as dropout and weight decay that discourage overfitting.'],
    ['Mixed precision (AMP)', 'Using lower-precision arithmetic for speed while keeping a master copy of weights in higher precision.'],
    ['Gradient clipping', 'Capping the gradient norm so one bad batch cannot cause a huge update.']
  ];

  (function initGlossary() {
    var grid = $('#glossary-grid');
    var search = $('#glossary-search');
    var empty = $('#glossary-empty');
    if (!grid) return;
    clear(grid);
    GLOSSARY.forEach(function (item) {
      var box = el('dl', 'glossary-item');
      box.appendChild(el('dt', null, item[0]));
      box.appendChild(el('dd', null, item[1]));
      grid.appendChild(box);
    });
    if (search) {
      search.addEventListener('input', function () {
        var q = search.value.trim().toLowerCase();
        var visible = 0;
        $$('.glossary-item', grid).forEach(function (box) {
          var text = box.textContent.toLowerCase();
          var show = !q || text.indexOf(q) !== -1;
          box.hidden = !show;
          if (show) visible++;
        });
        if (empty) empty.hidden = visible !== 0;
      });
    }
  })();

  /* ---------------- quiz ---------------- */

  var QUIZ = [
    {
      q: 'Where does GuppyLM’s training data come from?',
      options: ['A web scrape of fish forums', 'A Python script that composes templates', 'Human volunteers writing chats', 'A Wikipedia dump'],
      answer: 1,
      explain: 'generate_data.py picks fragments from hand-written pools and glues them together. There is no external corpus.'
    },
    {
      q: 'What does the tokenizer output?',
      options: ['Integer token IDs', 'Gradients', 'Attention weights', 'Probabilities'],
      answer: 0,
      explain: 'The model only ever sees integer IDs. The tokenizer maps text to those IDs and back.'
    },
    {
      q: 'What is a parameter?',
      options: ['A number the model learns', 'A rule written by the programmer', 'A row in the dataset', 'A special token'],
      answer: 0,
      explain: 'The 8.7M parameters are the learned numbers. Training changes them; nothing else about the model changes.'
    },
    {
      q: 'In attention, what decides how much token A reads token B?',
      options: ['The dot product of A’s query and B’s key', 'The alphabetical order of the tokens', 'The distance in characters', 'The token IDs'],
      answer: 0,
      explain: 'Query·key similarity produces a score; softmax turns the scores into weights; the output is a weighted sum of value vectors.'
    },
    {
      q: 'The training loss for one position is:',
      options: ['−ln(probability of the correct next token)', 'The squared difference between two vectors', 'The number of wrong tokens', 'The entropy of the input'],
      answer: 0,
      explain: 'Cross-entropy is −ln p. Confident and correct is near zero; confident and wrong is very large.'
    },
    {
      q: 'What does backpropagation compute?',
      options: ['The gradient of the loss for every weight', 'The next token', 'The tokenizer vocabulary', 'The attention mask'],
      answer: 0,
      explain: 'Backprop applies the chain rule backwards through the graph to get a gradient for each parameter.'
    },
    {
      q: 'Raising the sampling temperature:',
      options: ['Flattens the distribution, making rare tokens more likely', 'Sharpens the distribution', 'Changes the vocabulary size', 'Stops generation immediately'],
      answer: 0,
      explain: 'Temperature divides the logits. A larger divisor flattens the softmax; a smaller one sharpens it.'
    },
    {
      q: 'Why does multi-turn chat degrade in GuppyLM?',
      options: ['The 128-token context fills up and earlier turns fall out', 'The weights are erased after each turn', 'The tokenizer changes between turns', 'The learning rate decays during inference'],
      answer: 0,
      explain: 'The model can only see the last 128 tokens. By turn three or four, the original topic has been truncated away.'
    }
  ];

  (function initQuiz() {
    var list = $('#quiz-list');
    var scoreBox = $('#quiz-score');
    var reset = $('#quiz-reset');
    if (!list) return;

    function render() {
      clear(list);
      QUIZ.forEach(function (item, qi) {
        var card = el('div', 'quiz-q');
        card.appendChild(el('h3', null, (qi + 1) + '. ' + item.q));
        var opts = el('div', 'quiz-opts');
        item.options.forEach(function (opt, oi) {
          var label = el('label', 'quiz-opt');
          var input = el('input');
          input.type = 'radio';
          input.name = 'q' + qi;
          input.value = String(oi);
          label.appendChild(input);
          label.appendChild(el('span', null, opt));
          input.addEventListener('change', function () { grade(); });
          opts.appendChild(label);
        });
        card.appendChild(opts);
        var explain = el('p', 'quiz-explain');
        explain.hidden = true;
        card.appendChild(explain);
        list.appendChild(card);
      });
      if (scoreBox) { scoreBox.hidden = true; scoreBox.textContent = ''; }
    }

    function grade() {
      var answered = 0, correct = 0;
      QUIZ.forEach(function (item, qi) {
        var card = $$('.quiz-q', list)[qi];
        if (!card) return;
        var inputs = $$('input', card);
        var chosen = inputs.filter(function (i) { return i.checked; })[0];
        var labels = $$('.quiz-opt', card);
        labels.forEach(function (l) { l.classList.remove('correct', 'wrong'); });
        var explain = $('.quiz-explain', card);
        if (!chosen) {
          if (explain) explain.hidden = true;
          return;
        }
        answered++;
        var oi = Number(chosen.value);
        labels.forEach(function (l, li) {
          if (li === item.answer) l.classList.add('correct');
          if (li === oi && oi !== item.answer) l.classList.add('wrong');
        });
        if (oi === item.answer) correct++;
        if (explain) {
          explain.hidden = false;
          explain.textContent = item.explain;
        }
      });
      if (scoreBox) {
        if (answered === QUIZ.length) {
          scoreBox.hidden = false;
          scoreBox.innerHTML = 'You got <b>' + correct + '</b> of <b>' + QUIZ.length + '</b> right.' +
            (correct === QUIZ.length ? ' You understand the pipeline.' : ' Revisit the chapters above for the ones you missed.');
        } else {
          scoreBox.hidden = true;
        }
      }
    }

    if (reset) reset.addEventListener('click', function () {
      $$('input', list).forEach(function (i) { i.checked = false; });
      $$('.quiz-opt', list).forEach(function (l) { l.classList.remove('correct', 'wrong'); });
      $$('.quiz-explain', list).forEach(function (e) { e.hidden = true; });
      if (scoreBox) { scoreBox.hidden = true; scoreBox.textContent = ''; }
    });
    render();
  })();

  /* ---------------- hero number count-up ---------------- */

  (function countUp() {
    var node = $('[data-count]');
    if (!node) return;
    var target = Number(node.getAttribute('data-count'));
    if (!target || window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      node.textContent = target.toLocaleString('en-US');
      return;
    }
    var start = null;
    function tick(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / 1100);
      var eased = 1 - Math.pow(1 - p, 3);
      node.textContent = Math.round(target * eased).toLocaleString('en-US');
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  })();

})();
