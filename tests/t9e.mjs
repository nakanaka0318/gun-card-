/* 画面の作りと使い心地（スマホ実機での表示・操作）＋ ver9 のカード名が切れないか */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
/* リポジトリ内の index.html を、この検証ファイルの位置から探す（置き場所が変わっても動く） */
const PAGE = pathToFileURL(join(dirname(dirname(fileURLToPath(import.meta.url))), 'index.html')).href;
const URL = PAGE;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const OUT = [];
const ok = (n, c, d = '') => OUT.push((c ? 'PASS ' : 'FAIL ') + n + (d ? ' :: ' + d : ''));

/* ===== [A] 文書の宣言と、触る前に音を作らないこと ===== */
{
  const pg = await b.newPage({ viewport: { width: 412, height: 892 } });
  const msgs = []; pg.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') msgs.push(m.text()); });
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/*fonts.g*.com/**', r => r.abort());
  await pg.goto(URL); await pg.waitForTimeout(800);
  const head = await pg.evaluate(() => {
    const meta = n => { const e = document.querySelector(`meta[name="${n}"]`); return e ? e.content : null; };
    return { charsetFirst: document.head.firstElementChild && document.head.firstElementChild.getAttribute('charset'),
      viewport: meta('viewport'), colorScheme: meta('color-scheme'), themeColor: meta('theme-color'),
      description: meta('description'), lang: document.documentElement.lang, title: document.title };
  });
  ok('文字コードの指定が head の先頭にある', head.charsetFirst === 'utf-8', String(head.charsetFirst));
  ok('端末の幅で描くよう指定されている', /width=device-width/.test(head.viewport || '') && /initial-scale=1/.test(head.viewport || ''), String(head.viewport));
  ok('ノッチまで描くよう指定されている', /viewport-fit=cover/.test(head.viewport || ''), String(head.viewport));
  ok('暗い配色・枠の色・説明・言語が宣言されている',
     head.colorScheme === 'dark' && /^#/.test(head.themeColor || '') && (head.description || '').length >= 10 && head.lang === 'ja',
     JSON.stringify(head));
  const audio = await pg.evaluate(() => ({ made: !!Sfx.ctx, touched: Sfx.touched }));
  ok('触られる前は音の装置を作らない', audio.made === false && audio.touched === false, JSON.stringify(audio));
  ok('読み込みだけでは音の警告が出ない', !msgs.some(m => /AudioContext/.test(m)), msgs.filter(m => /AudioContext/.test(m)).join(' | '));
  await pg.evaluate(() => UI.go('battle')); await pg.waitForTimeout(200);
  const ghosts = await pg.evaluate(() => {
    const out = []; document.querySelectorAll('[hidden]').forEach(n => {
      if (getComputedStyle(n).display !== 'none') out.push(n.id || n.className || n.tagName); });
    return out;
  });
  ok('hidden を付けた要素はすべて消えている', ghosts.length === 0, ghosts.join(','));
  ok('読み込みから操作までページエラーなし', errs.length === 0, errs.join(' | '));
  await pg.close();
}

/* ===== [B] スマホ実機（390x844） ===== */
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/*fonts.g*.com/**', r => r.abort());
  await pg.goto(URL); await pg.waitForTimeout(800);
  const vp = await pg.evaluate(() => ({ innerW: window.innerWidth, coarse: matchMedia('(pointer:coarse)').matches }));
  ok('端末の幅（390px）でレイアウトされ指操作の作りが効く', vp.innerW === 390 && vp.coarse, JSON.stringify(vp));

  const screens = ['home', 'setup', 'twopick', 'deck', 'format', 'matchup', 'cards', 'rule'];
  const bad = { over: [], clip: [], tiny: [] };
  for (const s of screens) {
    await pg.evaluate(n => UI.go(n), s); await pg.waitForTimeout(380);
    const r = await pg.evaluate(name => {
      const W = window.innerWidth, over = [], clip = [], tiny = [];
      document.querySelectorAll('#app *').forEach(n => {
        const b = n.getBoundingClientRect();
        if (!b.width && !b.height) return;
        if (b.right > W + 1.5 || b.left < -1.5) over.push(name + ':' + (n.id || n.className || n.tagName));
        if (!n.children.length && n.clientWidth > 20 && n.scrollWidth - n.clientWidth > 2)
          clip.push(name + ':' + (n.className || n.id) + '[' + (n.textContent || '').trim().slice(0, 10) + ']');
        if (n.matches('button, select, [role="button"], [data-act]') && b.width > 0 && (b.height < 36 || b.width < 36))
          tiny.push(name + ':' + (n.id || n.className) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height));
      });
      return { over: [...new Set(over)], clip: [...new Set(clip)], tiny: [...new Set(tiny)] };
    }, s);
    bad.over.push(...r.over); bad.clip.push(...r.clip); bad.tiny.push(...r.tiny);
  }
  ok('どの画面も横にはみ出さない', bad.over.length === 0, bad.over.slice(0, 6).join(' | '));
  ok('どの画面も文字が切れない', bad.clip.length === 0, bad.clip.slice(0, 6).join(' | '));
  ok('押す部品はどれも36px以上ある', bad.tiny.length === 0, bad.tiny.slice(0, 6).join(' | '));

  /* ver9 のカード名が枠からはみ出さない（名前は全文見せる作り） */
  await pg.evaluate(() => UI.go('cards')); await pg.waitForTimeout(600);
  const names = await pg.evaluate(() => {
    const bad = [];
    document.querySelectorAll('#sc-cards .card').forEach(card => {
      const nm = card.querySelector('.c-nm'); if (!nm) return;
      const band = card.querySelector('.c-name'); if (!band) return;
      const nb = nm.getBoundingClientRect(), cb = card.getBoundingClientRect();
      if (nb.right > cb.right + 1 || nb.left < cb.left - 1 || nm.scrollWidth - nm.clientWidth > 2 || nm.scrollHeight - nm.clientHeight > 2)
        bad.push((nm.textContent || '').trim());
    });
    return [...new Set(bad)];
  });
  ok('カード名がどれも枠内に収まっている', names.length === 0, names.slice(0, 6).join(' | '));

  /* 対戦画面に ver9 を並べても崩れない */
  await pg.evaluate(async () => {
    startGame({ p1: { deck: { ezdia_001: 40 }, cls: 'formation', name: 'あなた' },
                p2: { deck: { azraflete_001: 40 }, cls: 'accel', name: '相手' }, timer: 0, first: 'p1' });
    G.sim = false; G.phase = 'play'; G.active = 0; await beginTurn();
    const P = G.players[0]; P.pp = 10; P.maxPP = 10; Sfx.on = false;
    P.hand = ['mazelbane_001', 'azraflete_001', 'backwood_001', 'graveeater_001', 'yube_001'].map(i => makeInstance(i, 0));
    await summonCard(0, 'ezdia_001'); await summonCard(0, 'stachium_001');
    await summonCard(1, 'octrice_001');
    grantBadge(0, 'rudeman'); grantBadge(0, 'voidend');
    UI.go('battle'); UI.renderBattle();
  });
  await pg.waitForTimeout(700);
  const bt = await pg.evaluate(() => {
    const W = window.innerWidth, H = window.innerHeight, over = [];
    document.querySelectorAll('#sc-battle *').forEach(n => {
      const b = n.getBoundingClientRect();
      if (b.width && (b.right > W + 1.5 || b.left < -1.5)) over.push(n.id || n.className || n.tagName);
    });
    const r = s => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return Math.round(b.bottom); };
    return { over: [...new Set(over)].slice(0, 5), docW: document.documentElement.scrollWidth, W, H,
             bottom: r('.bt-bottom'), hand: r('#handMe'), badges: document.querySelectorAll('.bg.on').length };
  });
  ok('ver9 を並べた対戦画面が横にはみ出さない', bt.over.length === 0 && bt.docW <= bt.W, JSON.stringify(bt));
  ok('対戦画面が画面の高さに収まる', bt.bottom <= bt.H + 1 && bt.hand <= bt.H, JSON.stringify(bt));
  ok('ver9 のバッジ2つが並んで表示される', bt.badges >= 2, String(bt.badges));
  ok('スマホでもページエラーなし', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ===== [C] 320px ===== */
{
  const ctx = await b.newContext({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage();
  await pg.route('**/*fonts.g*.com/**', r => r.abort());
  await pg.goto(URL); await pg.waitForTimeout(800);
  const narrow = [];
  for (const s of ['home', 'setup', 'cards', 'rule']) {
    await pg.evaluate(n => UI.go(n), s); await pg.waitForTimeout(350);
    narrow.push(...await pg.evaluate(name => {
      const W = window.innerWidth, out = [];
      document.querySelectorAll('#app *').forEach(n => { const b = n.getBoundingClientRect();
        if (b.width && (b.right > W + 1.5 || b.left < -1.5)) out.push(name + ':' + (n.id || n.className)); });
      return [...new Set(out)];
    }, s));
  }
  ok('320pxの細い画面でもはみ出さない', narrow.length === 0, narrow.slice(0, 6).join(' | '));
  await pg.evaluate(() => { UI.go('rule');
    const d = [...document.querySelectorAll('#ruleAcc details')].find(x => (x.querySelector('summary') || {}).textContent.trim() === 'PP');
    if (d) d.open = true; });
  await pg.waitForTimeout(350);
  const pp = await pg.evaluate(() => { const t = [...document.querySelectorAll('.tbl')];
    return { n: t.length, cols: t.map(x => x.rows[0].cells.length),
             turns: t.reduce((a, x) => a + x.rows[0].cells.length - 1, 0), expect: PP_FULL_TURN,
             curve: ppCurveText(),
             over: t.filter(x => x.getBoundingClientRect().right > window.innerWidth + 1.5).length }; });
  /* 表はターン数から区切るので、列数はそのときの増え方しだい。
     大事なのは「横にはみ出さない」「ターンが1つも欠けない」こと。 */
  ok('PP表が細い画面からはみ出さない', pp.n >= 1 && pp.over === 0, JSON.stringify(pp));
  ok('PP表にターンが1つも欠けていない', pp.turns === pp.expect, JSON.stringify(pp));
  ok('PP表は1つあたり8列まで（細い画面に収まる幅）', pp.cols.every(c => c <= 8), JSON.stringify(pp));
  const bars = await pg.evaluate(() => ['rule', 'cards', 'deck'].map(s => { UI.go(s);
    const h = document.querySelector('#sc-' + s + ' .bar h2, #sc-' + s + ' .bar .deckwho b');
    return { s, h: Math.round(h.getBoundingClientRect().height), fs: Math.round(parseFloat(getComputedStyle(h).fontSize)) }; }));
  ok('画面名の見出しが1行に収まる', bars.every(x => x.h <= x.fs * 1.8), JSON.stringify(bars));
  await ctx.close();
}

/* ===== [D] マウス環境は今までどおり ===== */
{
  const pg = await b.newPage({ viewport: { width: 1280, height: 860 } });
  await pg.route('**/*fonts.g*.com/**', r => r.abort());
  await pg.goto(URL); await pg.waitForTimeout(700);
  ok('マウス環境では指操作用の拡大が効かない',
     await pg.evaluate(() => matchMedia('(pointer:coarse)').matches) === false, '');
  ok('広い画面でも横にはみ出さない',
     await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '');
  ok('キーボードで選んでいる場所が見える指定がある',
     await pg.evaluate(() => Array.from(document.styleSheets).flatMap(s => { try { return Array.from(s.cssRules); } catch (e) { return []; } })
       .some(r => r.selectorText && r.selectorText.indexOf(':focus-visible') >= 0 && /outline/.test(r.cssText))), '');
  await pg.close();
}

console.log(OUT.join('\n'));
console.log('---- ' + OUT.filter(x => x.startsWith('PASS')).length + ' pass / ' + OUT.filter(x => x.startsWith('FAIL')).length + ' fail');
await b.close();
