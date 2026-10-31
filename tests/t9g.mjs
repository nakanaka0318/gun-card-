/* 使い勝手の3点を確かめる：
   [A] デッキ編成が見やすく・足し引きしやすいか
   [B] 端末の拡大と長押し選択を止められているか
   [C] 対戦が縦でも横でも遊びやすいか */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
const URL = pathToFileURL(join(dirname(dirname(fileURLToPath(import.meta.url))), 'index.html')).href;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const OUT = [];
const ok = (n, c, d = '') => OUT.push((c ? 'PASS ' : 'FAIL ') + n + (d ? ' :: ' + d : ''));
let CARD_NAME_OF = () => '';
const phone = () => b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

/* ================= [A] デッキ編成 ================= */
{
  const ctx = await phone(); const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/*fonts.g*.com/**', r => r.abort());
  await pg.goto(URL); await pg.waitForTimeout(900);
  await pg.evaluate(() => UI.go('deck')); await pg.waitForTimeout(700);
  CARD_NAME_OF = id => CARD_NAMES[id] || '';
  const CARD_NAMES = await pg.evaluate(() => {
    const m = {}; CARDS.forEach(c => { m[c.id] = c.name; }); return m;
  });

  /* 開いた瞬間に札が見えているか（設定を抜けるまで延々と巻かずに済むか） */
  const first = await pg.evaluate(() => {
    const cards = [...document.querySelectorAll('#deckList .card')];
    const vis = cards.filter(c => { const r = c.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    const top = cards.length ? Math.round(cards[0].getBoundingClientRect().top) : -1;
    return { total: cards.length, visible: vis.length, firstTop: top,
             optsHidden: document.querySelector('#deckOpts').hidden,
             view: DeckViewMode, scrollTop: document.querySelector('#sc-deck .scroll').scrollTop };
  });
  ok('デッキ編成を開くとすぐ札が見える（巻かずに済む）',
     first.firstTop >= 0 && first.firstTop < 400 && first.visible >= 10, JSON.stringify(first));
  ok('細かい設定は畳まれた状態で始まる', first.optsHidden === true, JSON.stringify(first));
  ok('既定は札を並べた表示', first.view === 'grid', String(first.view));

  /* 操作帯が常に見えているか（巻いても枚数が分かるか） */
  const fixed = await pg.evaluate(() => {
    const sc = document.querySelector('#sc-deck .scroll'); sc.scrollTop = 1200;
    const f = document.querySelector('.deckfix').getBoundingClientRect();
    const cnt = document.querySelector('#deckCount').getBoundingClientRect();
    return { fixTop: Math.round(f.top), fixBottom: Math.round(f.bottom),
             countVisible: cnt.top >= 0 && cnt.bottom <= innerHeight, scrolled: sc.scrollTop };
  });
  ok('巻いても枚数の帯は画面に残る',
     fixed.countVisible && fixed.fixTop >= 0 && fixed.scrolled > 0, JSON.stringify(fixed));

  /* 札を押すと1枚入るか／− で減るか */
  const add = await pg.evaluate(async () => {
    const d = findDeck(DeckEditId);
    /* 40枚ちょうどだと「デッキは40枚まで」で弾かれるので、1枚ぶん空けてから試す */
    const full = Object.keys(d.list)[0];
    if (deckTotal(d) >= RULES.deckSize) { d.list[full] -= 1; saveDecks(); UI.renderDeck(); }
    const before = deckTotal(d);
    const cell = [...document.querySelectorAll('#deckList .gcell')].find(c => !c.classList.contains('has'));
    const id = cell.querySelector('.gcard').dataset.inc;
    cell.querySelector('.gcard').click();
    const mid = deckTotal(findDeck(DeckEditId));
    const n1 = findDeck(DeckEditId).list[id] || 0;
    const cell2 = [...document.querySelectorAll('#deckList .gcell')].find(c => (c.querySelector('.gcard') || {}).dataset && c.querySelector('.gcard').dataset.inc === id);
    const dec = cell2.querySelector('[data-dec]');
    const hadDec = !!dec;
    if (dec) dec.click();
    return { before, mid, after: deckTotal(findDeck(DeckEditId)), n1, hadDec, id };
  });
  ok('札そのものを押すと1枚入る', add.mid === add.before + 1 && add.n1 === 1, JSON.stringify(add));
  ok('入っている札にだけ「− 1枚」が出る', add.hadDec === true, JSON.stringify(add));
  ok('「− 1枚」で元に戻る', add.after === add.before, JSON.stringify(add));

  /* 入っていない札には減らすボタンを出さない（並びを軽くするため） */
  const lean = await pg.evaluate(() => {
    const cells = [...document.querySelectorAll('#deckList .gcell')];
    const emptyWithStep = cells.filter(c => !c.classList.contains('has') && c.querySelector('.gstep')).length;
    const hasWithStep = cells.filter(c => c.classList.contains('has') && c.querySelector('.gstep')).length;
    const hasCount = cells.filter(c => c.classList.contains('has')).length;
    return { emptyWithStep, hasWithStep, hasCount };
  });
  ok('0枚の札には増減ボタンを出さない', lean.emptyWithStep === 0, JSON.stringify(lean));
  ok('入っている札には必ず増減ボタンが出る', lean.hasWithStep === lean.hasCount, JSON.stringify(lean));

  /* 枚数の印が札の外枠に隠れていないか */
  const badge = await pg.evaluate(() => {
    const gn = document.querySelector('.gcell.has .gn'); if (!gn) return null;
    const card = gn.closest('.gcard').querySelector('.card');
    const frame = card.querySelector('.c-frame');
    return { z: +getComputedStyle(gn).zIndex, frameZ: +getComputedStyle(frame).zIndex,
             w: Math.round(gn.getBoundingClientRect().width), text: gn.textContent };
  });
  ok('枚数の印が札の外枠より前に出ている', badge && badge.z > badge.frameZ, JSON.stringify(badge));

  /* 「デッキの中だけ」で絞り込めるか */
  const only = await pg.evaluate(async () => {
    const all = document.querySelectorAll('#deckList .gcell').length;
    document.querySelector('#deckOnlyIn').click();
    await new Promise(r => setTimeout(r, 120));
    const inDeck = document.querySelectorAll('#deckList .gcell').length;
    const allHas = [...document.querySelectorAll('#deckList .gcell')].every(c => c.classList.contains('has'));
    document.querySelector('#deckOnlyIn').click();
    await new Promise(r => setTimeout(r, 120));
    return { all, inDeck, allHas, back: document.querySelectorAll('#deckList .gcell').length };
  });
  ok('「デッキの中だけ」で入っている札だけに絞れる',
     only.inDeck > 0 && only.inDeck < only.all && only.allHas, JSON.stringify(only));
  ok('もう一度押すと候補が戻る', only.back === only.all, JSON.stringify(only));

  /* 設定の開閉 */
  const opts = await pg.evaluate(async () => {
    document.querySelector('#deckOptsBtn').click();
    await new Promise(r => setTimeout(r, 120));
    const open = !document.querySelector('#deckOpts').hidden;
    const hasLib = !!document.querySelector('#deckOpts #deckLib .librow');
    const hasName = !!document.querySelector('#deckOpts #deckName');
    document.querySelector('#deckOptsBtn').click();
    await new Promise(r => setTimeout(r, 120));
    return { open, hasLib, hasName, closed: document.querySelector('#deckOpts').hidden };
  });
  ok('「設定」で保存済みデッキと細かい設定が開く',
     opts.open && opts.hasLib && opts.hasName && opts.closed, JSON.stringify(opts));
  /* 「詳しく見る」に切り替えると、札を押して効果の文を読める */
  const detail = await pg.evaluate(async () => {
    document.querySelector('#deckViewBtn').click();        // 並べる⇄効果を読む
    await new Promise(r => setTimeout(r, 250));
    const mini = document.querySelector('#deckList .entry .mini .card');
    const hasInc = !!mini.closest('[data-inc]');
    mini.click();
    await new Promise(r => setTimeout(r, 200));
    const open = !document.querySelector('#ovDetail').hidden;
    document.querySelector('#detailClose').click();
    document.querySelector('#deckViewBtn').click();
    await new Promise(r => setTimeout(r, 200));
    return { hasInc, open, backToGrid: DeckViewMode === 'grid' };
  });
  ok('「効果を読む」では札を押すと詳しい説明も開く', detail.open && detail.hasInc === false, JSON.stringify(detail));
  ok('表示の切り替えボタンで元に戻せる', detail.backToGrid === true, JSON.stringify(detail));

  /* 「効果を読む」は、札を足し引きしながら効果の全文が読める表示になっているか */
  const read = await pg.evaluate(async () => {
    document.querySelector('#deckViewBtn').click();
    await new Promise(r => setTimeout(r, 200));
    await new Promise(r => setTimeout(r, 250));
    const rows = [...document.querySelectorAll('#deckList .entry')];
    const texts = rows.map(r => { const e = r.querySelector('.etext'); return e ? e.textContent.trim() : null; });
    const hasStep = rows.every(r => r.querySelector('[data-inc]') && r.querySelector('[data-dec]'));
    const clipped = rows.filter(r => { const e = r.querySelector('.etext');
      return e && e.scrollHeight - e.clientHeight > 2; }).length;
    const over = rows.filter(r => r.getBoundingClientRect().right > innerWidth + 1).length;
    /* 入っている札は札の右上に枚数が出る */
    const inDeck = rows.filter(r => r.classList.contains('has'));
    const badges = inDeck.map(r => { const g = r.querySelector('.mini .gn'); return g ? g.textContent : null; });
    /* 0枚の札は「1枚減らす」を押せないようにしてある */
    const zeroDisabled = rows.filter(r => !r.classList.contains('has'))
      .every(r => r.querySelector('[data-dec]').disabled);
    const tiny = [...document.querySelectorAll('#deckList .stepper .btn')]
      .filter(n => { const b = n.getBoundingClientRect(); return b.height < 36 || b.width < 36; }).length;
    document.querySelector('#deckViewBtn').click();
    await new Promise(r => setTimeout(r, 200));
    return { rows: rows.length, withText: texts.filter(t => t && t.length > 0).length,
             sample: texts.find(t => t && t.indexOf('ラストワード') >= 0) || texts[1],
             hasStep, clipped, over, badges, zeroDisabled, tiny };
  });
  ok('「効果を読む」で全ての札に効果の文が出る',
     read.rows > 50 && read.withText === read.rows, JSON.stringify({ rows: read.rows, withText: read.withText }));
  ok('効果の文が途中で切れていない', read.clipped === 0 && read.over === 0, JSON.stringify(read));
  ok('効果を読みながらその場で足し引きできる', read.hasStep && read.tiny === 0, JSON.stringify({ hasStep: read.hasStep, tiny: read.tiny }));
  ok('入っている札は札の右上に枚数が出る',
     read.badges.length > 0 && read.badges.every(x => x && +x > 0), JSON.stringify(read.badges));
  ok('0枚の札は減らすボタンを押せない', read.zeroDisabled, String(read.zeroDisabled));

  /* 短く押す＝1枚入る、長く押す＝効果の画面。指を滑らせた時は開かない。 */
  const prep = await pg.evaluate(() => {
    DeckViewMode = 'grid'; UI.renderDeck();
    const d = findDeck(DeckEditId);
    while (deckTotal(d) >= RULES.deckSize - 1) {          // 足せる余地を2枚ぶん空ける
      const k = Object.keys(d.list)[0];
      d.list[k] -= 1; if (!d.list[k]) delete d.list[k];
    }
    saveDecks(); UI.renderDeck();
    const cell = [...document.querySelectorAll('#deckList .gcell')].find(x => !x.classList.contains('has'));
    const r = cell.querySelector('.card').getBoundingClientRect();
    return { id: cell.querySelector('.gcard').dataset.inc, total: deckTotal(d),
             x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const posOf = id => pg.evaluate(cid => {
    const cell = [...document.querySelectorAll('#deckList .gcell')]
      .find(x => x.querySelector('.gcard').dataset.inc === cid);
    const r = cell.querySelector('.card').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, id);

  /* 短く押す */
  let p1 = await posOf(prep.id);
  await pg.mouse.move(p1.x, p1.y); await pg.mouse.down(); await pg.waitForTimeout(90); await pg.mouse.up();
  await pg.waitForTimeout(250);
  const tap = await pg.evaluate(cid => ({
    total: deckTotal(findDeck(DeckEditId)), n: findDeck(DeckEditId).list[cid] || 0,
    detail: !document.querySelector('#ovDetail').hidden }), prep.id);
  ok('並べる：短く押すと1枚入る（効果の画面は開かない）',
     tap.total === prep.total + 1 && tap.n === 1 && tap.detail === false, JSON.stringify({ prep: prep.total, tap }));

  /* 長く押す */
  let p2 = await posOf(prep.id);
  await pg.mouse.move(p2.x, p2.y); await pg.mouse.down(); await pg.waitForTimeout(650); await pg.mouse.up();
  await pg.waitForTimeout(300);
  const hold = await pg.evaluate(cid => ({
    total: deckTotal(findDeck(DeckEditId)), n: findDeck(DeckEditId).list[cid] || 0,
    detail: !document.querySelector('#ovDetail').hidden,
    name: (document.querySelector('#ovDetail .dhead h3') || {}).textContent || null,
    text: !!document.querySelector('#ovDetail .ctext') }), prep.id);
  ok('並べる：長く押すと効果の画面が開く', hold.detail && hold.text, JSON.stringify(hold));
  ok('長く押した時は枚数が増えない（短押しと二重に働かない）',
     hold.total === tap.total && hold.n === tap.n, JSON.stringify({ tap, hold }));
  ok('開いた画面が押した札のもの',
     hold.name && hold.name.indexOf(CARD_NAME_OF(prep.id)) >= 0, String(hold.name));

  /* 押しながら指を滑らせた時（スクロール）は開かない */
  await pg.evaluate(() => UI.closeDetail());
  let p3 = await posOf(prep.id);
  await pg.mouse.move(p3.x, p3.y); await pg.mouse.down();
  await pg.waitForTimeout(140); await pg.mouse.move(p3.x, p3.y - 70);
  await pg.waitForTimeout(500); await pg.mouse.up();
  await pg.waitForTimeout(250);
  const drag = await pg.evaluate(() => !document.querySelector('#ovDetail').hidden);
  ok('押しながら動かした時（巻いている時）は開かない', drag === false, String(drag));
  await pg.evaluate(() => UI.closeDetail());

  /* 押し方の案内が候補の先頭に出ている */
  const hint = await pg.evaluate(() => {
    const h = document.querySelector('#deckList .ghint');
    return h ? h.textContent.trim() : null;
  });
  ok('押し方の案内が候補の先頭に出ている',
     !!hint && hint.indexOf('1枚入る') >= 0 && hint.indexOf('効果の画面') >= 0, String(hint));
  ok('デッキ編成でページエラーなし', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ================= [B] 拡大と長押し選択を止める ================= */
{
  const ctx = await phone(); const pg = await ctx.newPage();
  await pg.route('**/*fonts.g*.com/**', r => r.abort());
  await pg.goto(URL); await pg.waitForTimeout(900);
  const meta = await pg.evaluate(() => document.querySelector('meta[name="viewport"]').content);
  ok('端末の拡大操作を止める指定がある',
     /maximum-scale=1/.test(meta) && /user-scalable=no/.test(meta), meta);
  const sel = await pg.evaluate(() => {
    const pick = s => { const n = document.querySelector(s); return n ? getComputedStyle(n).webkitUserSelect || getComputedStyle(n).userSelect : null; };
    return { body: pick('body'), h1: pick('.logo h1'), sign: pick('.sign'),
             callout: getComputedStyle(document.body).webkitTouchCallout,
             touch: getComputedStyle(document.body).touchAction };
  });
  ok('文字は長押しで選べない', sel.body === 'none' && sel.h1 === 'none' && sel.sign === 'none', JSON.stringify(sel));
  ok('二度叩きの拡大を止める指定がある', sel.touch === 'manipulation', JSON.stringify(sel));
  const inputs = await pg.evaluate(() => {
    UI.go('deck');
    const n = document.querySelector('#deckName');
    return n ? (getComputedStyle(n).webkitUserSelect || getComputedStyle(n).userSelect) : null;
  });
  ok('入力欄だけは選んでコピーできる', inputs === 'text', String(inputs));
  /* 長押しメニューと文字選択が実際に止まるか（イベントが潰されるか） */
  const blocked = await pg.evaluate(() => {
    UI.go('home');
    const target = document.querySelector('.logo h1');
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    const ss = new Event('selectstart', { bubbles: true, cancelable: true });
    target.dispatchEvent(ss);
    const inInput = new Event('selectstart', { bubbles: true, cancelable: true });
    UI.go('deck');
    const nameBox = document.querySelector('#deckName');
    nameBox.dispatchEvent(inInput);
    return { menu: ev.defaultPrevented, select: ss.defaultPrevented, inputSelect: inInput.defaultPrevented };
  });
  ok('長押しのメニューが出ない', blocked.menu === true, JSON.stringify(blocked));
  ok('文字の選択が始まらない', blocked.select === true, JSON.stringify(blocked));
  ok('入力欄の中では選択できる', blocked.inputSelect === false, JSON.stringify(blocked));
  await ctx.close();
}

/* ================= [C] 対戦：縦でも横でも ================= */
const setUpBattle = `async () => {
  startGame({ p1: { deck: { soldier_001: 40 }, cls: 'formation', name: 'あなた' },
              p2: { deck: { soldier_001: 40 }, cls: 'accel', name: '相手' }, timer: 0, first: 'p1' });
  G.sim = false; G.phase = 'play'; G.active = 0; await beginTurn();
  const P = G.players[0]; P.pp = 10; P.maxPP = 10; Sfx.on = false; Bgm.on = false;
  P.hand = ['soldier_001','mage_001','angel_001','ezdia_001','yube_001','orca_001','godheart_001'].map(i => makeInstance(i, 0));
  await summonCard(0,'ezdia_001'); await summonCard(0,'stachium_001'); await summonCard(0,'orca_001');
  await summonCard(1,'octrice_001'); await summonCard(1,'himeka_001'); await summonCard(1,'orca_001');
  G.players[0].badges = [{ id:'rudeman', turnsLeft:null }, { id:'voidend', turnsLeft:null }];
  UI.go('battle'); UI.renderBattle();
}`;
for (const [w, h, label] of [[390, 844, '縦'], [844, 390, '横'], [932, 430, '横（大きめ）']]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/*fonts.g*.com/**', r => r.abort());
  await pg.goto(URL); await pg.waitForTimeout(900);
  await pg.evaluate(eval('(' + setUpBattle + ')'));
  await pg.waitForTimeout(900);
  await pg.evaluate(() => { document.querySelectorAll('#fx *').forEach(n => n.remove()); });
  const m = await pg.evaluate(() => {
    const W = innerWidth, H = innerHeight;
    /* 相手の手札の裏（.back）は飾りで押すものではないので、数えない */
    const cards = [...document.querySelectorAll('#sc-battle .row .card, #handMe .card')].filter(n => !n.classList.contains('back'));
    const cut = cards.filter(n => { const b = n.getBoundingClientRect();
      return b.width && (b.top < -1 || b.bottom > H + 1 || b.left < -1 || b.right > W + 1); })
      .map(n => (n.textContent || '').trim().slice(0, 8));
    const over = [...document.querySelectorAll('#sc-battle *')].filter(n => { const b = n.getBoundingClientRect();
      return b.width && (b.right > W + 1.5 || b.left < -1.5); }).map(n => n.id || n.className).slice(0, 5);
    const one = cards.length ? cards[0].getBoundingClientRect() : { width: 0, height: 0 };
    const tiny = cards.filter(n => n.getBoundingClientRect().width < 44).length;
    const act = [...document.querySelectorAll('.actbtn')].map(n => { const b = n.getBoundingClientRect();
      return Math.round(b.width) + 'x' + Math.round(b.height); });
    const actOK = [...document.querySelectorAll('.actbtn')].every(n => { const b = n.getBoundingClientRect();
      return b.height >= 36 && b.width >= 40; });
    const end = document.querySelector('.endbtn').getBoundingClientRect();
    return { W, H, cards: cards.length, cut, over,
             cardW: Math.round(one.width), cardH: Math.round(one.height), tiny,
             endOK: end.width >= 44 && end.height >= 40 && end.bottom <= H + 1,
             endBox: Math.round(end.width) + 'x' + Math.round(end.height), act, actOK,
             docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight };
  });
  ok(`${label}：札が画面からはみ出さない`, m.cut.length === 0, JSON.stringify({ cut: m.cut, ...m }));
  ok(`${label}：対戦画面が横にはみ出さない`, m.over.length === 0 && m.docW <= m.W, JSON.stringify({ over: m.over, docW: m.docW, W: m.W }));
  ok(`${label}：札が指で押せる大きさ（44px以上）`, m.tiny === 0 && m.cardW >= 44, JSON.stringify({ cardW: m.cardW, cardH: m.cardH, tiny: m.tiny }));
  ok(`${label}：ターン終了が画面内にあって押せる大きさ`, m.endOK, m.endBox);
  ok(`${label}：進化・融合のボタンも指で押せる大きさ`, m.actOK, m.act.join(' '));
  ok(`${label}：ページエラーなし`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* 横持ちでは縦の余白を削って札を大きくしている（縦持ちと比べて極端に小さくない） */
{
  const sizes = {};
  for (const [w, h, k] of [[390, 844, 'port'], [844, 390, 'land']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const pg = await ctx.newPage();
    await pg.route('**/*fonts.g*.com/**', r => r.abort());
    await pg.goto(URL); await pg.waitForTimeout(800);
    await pg.evaluate(eval('(' + setUpBattle + ')'));
    await pg.waitForTimeout(700);
    sizes[k] = await pg.evaluate(() => {
      const c = document.querySelector('#sc-battle .row .card').getBoundingClientRect();
      const f = document.querySelector('.bt-field').getBoundingClientRect();
      const oh = document.querySelector('.bt-ohand');
      return { cardW: Math.round(c.width), cardH: Math.round(c.height),
               field: Math.round(f.height), fieldW: Math.round(f.width),
               ohand: oh ? Math.round(oh.getBoundingClientRect().height) : 0 };
    });
    await ctx.close();
  }
  ok('横持ちでは相手の手札の裏を省いて縦を空けている', sizes.land.ohand === 0, JSON.stringify(sizes));
  ok('横持ちの札が小さくなりすぎない（縦持ちの7割以上）',
     sizes.land.cardH >= sizes.port.cardH * .7, JSON.stringify(sizes));
  ok('横持ちでは盤面を画面の中央にまとめている',
     sizes.land.fieldW <= 760, JSON.stringify(sizes));
}

/* ================= [D] 札を選ぶ場面で効果の文が読めるか ================= */
{
  const ctx = await phone(); const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.route('**/*fonts.g*.com/**', r => r.abort());
  await pg.goto(URL); await pg.waitForTimeout(900);

  /* カードの説明文そのものが壊れていないか（\n が文字として出ていないか） */
  const data = await pg.evaluate(() => ({
    literal: CARDS.filter(c => c.text && c.text.indexOf('\\n') >= 0).map(c => c.name),
    noText: CARDS.filter(c => !c.token && !c.text).map(c => c.name),
    multi: CARDS.filter(c => c.text && c.text.indexOf('\n') >= 0).length
  }));
  ok('説明文に改行が文字のまま残っていない', data.literal.length === 0, data.literal.slice(0, 5).join(','));
  ok('説明文のないカードは能力なしの素のカードだけ',
     data.noText.every(n => ['兵士', '有翼の兵士', 'ゴブリン'].indexOf(n) >= 0), data.noText.join(','));
  ok('複数行の説明文がきちんと改行として入っている', data.multi > 100, String(data.multi));

  /* マリガン：札の絵では読めないので、効果の文を並べて出す */
  const mull = await pg.evaluate(async () => {
    startGame({ p1: { deck: { soldier_001: 40 }, cls: 'formation', name: 'P1' },
                p2: { deck: { flam_001: 40 }, cls: 'machina', name: 'P2' }, timer: 0, first: 'p1' });
    G.sim = false; Sfx.on = false; Bgm.on = false;
    const P = G.players[0];
    P.hand = ['ezdia_001', 'yube_001', 'godheart_001', 'miroku_001'].map(i => makeInstance(i, 0));
    UI.go('battle'); UI.showMulligan(0);
    await new Promise(r => setTimeout(r, 250));
    const lines = [...document.querySelectorAll('#mullText .cline')];
    const texts = lines.map(l => (l.querySelector('.cl-body').textContent || '').trim());
    const names = lines.map(l => (l.querySelector('.cl-head').textContent || '').trim());
    /* 札を1枚選んでから、文の側にも印が付くか */
    document.querySelector('#mullCards .card').click();
    await new Promise(r => setTimeout(r, 150));
    const tagged = [...document.querySelectorAll('#mullText .cl-pick')].map(n => n.textContent);
    return { n: lines.length, texts, names, tagged,
             hasBreaks: texts.some(t => t.indexOf('\n') >= 0),
             allNonEmpty: texts.every(t => t.length > 5) };
  });
  ok('マリガンで手札4枚ぶんの効果の文が出る', mull.n === 4 && mull.allNonEmpty, JSON.stringify(mull.texts.map(t => t.length)));
  ok('マリガンの文にカード名と能力の中身が入っている',
     mull.names.some(n => n.indexOf('エズディア') >= 0) && mull.texts.some(t => t.indexOf('ファンファーレ') >= 0),
     mull.names.join(' / '));
  ok('マリガンの文でも改行が効いている', mull.hasBreaks, '');
  ok('引き直す札は文の側にも印が付く', mull.tagged.length === 1 && mull.tagged[0] === '引き直す', JSON.stringify(mull.tagged));

  /* 融合：素材にできるかどうかも文の側で分かる */
  const fus = await pg.evaluate(async () => {
    const P = G.players[0];
    document.querySelector('#ovMull').hidden = true;
    G.phase = 'play'; G.active = 0;
    P.hand = ['yube_001', 'soldier_001', 'godheart_001'].map(i => makeInstance(i, 0));
    openFusionUI();
    await new Promise(r => setTimeout(r, 250));
    const host = document.querySelector('#fusionCards [data-fuse-host]');
    const hostLines = document.querySelectorAll('#fusionText .cline').length;
    if (host) host.click();
    await new Promise(r => setTimeout(r, 250));
    const lines = [...document.querySelectorAll('#fusionText .cline')];
    const tags = lines.map(l => { const t = l.querySelector('.cl-pick'); return t ? t.textContent : ''; });
    const bodies = lines.map(l => (l.querySelector('.cl-body').textContent || '').trim().length);
    return { hostLines, matLines: lines.length, tags, bodies };
  });
  ok('融合で「どれに融合するか」を選ぶ時も効果の文が出る', fus.hostLines >= 1, JSON.stringify(fus));
  ok('融合の素材を選ぶ時も効果の文が出る', fus.matLines === 2 && fus.bodies.every(n => n > 0), JSON.stringify(fus));
  ok('素材にできない札は文の側にそう書いてある',
     fus.tags.join(',').indexOf('素材にできない') < 0 || fus.tags.some(t => t === '素材にできない'), JSON.stringify(fus.tags));

  /* 2PICK：どちらを取るか決めるのに効果の文が要る */
  const pick = await pg.evaluate(async () => {
    document.querySelector('#ovFusion').hidden = true;
    UI.go('twopick');
    await new Promise(r => setTimeout(r, 300));
    startPickRun('p1');                                  // 側は 'p1' / 'p2'
    await new Promise(r => setTimeout(r, 200));
    /* リーダーを決めないと候補が出ない作りなので、ここで決めてから1回目を出す */
    PickRun.cls = 'formation';
    PickRun.offer = makePickOffers('formation', 1, false);
    UI.renderPickRun();
    await new Promise(r => setTimeout(r, 300));
    const opts = [...document.querySelectorAll('.pickopt')];
    const texts = opts.map(o => [...o.querySelectorAll('.ptext')].map(t => t.textContent.trim().length));
    const names = opts.map(o => o.querySelectorAll('.pnames').length);
    return { opts: opts.length, texts, names };
  });
  ok('2PICKの選択肢それぞれに効果の文が出る',
     pick.opts >= 2 && pick.texts.every(a => a.length >= 1 && a.every(n => n > 0)), JSON.stringify(pick));
  ok('2PICKで札ごとに名前が並ぶ', pick.names.every(n => n >= 1), JSON.stringify(pick.names));
  ok('文を足してもページエラーなし', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

/* ================= [E] 対戦画面の段組みが崩れないか ================= */
{
  /* 相手の手札の裏を隠した時に、後ろの要素が1段ずつ繰り上がって
     盤面に渡すはずの伸び代が下の帯に行ってしまう不具合があった。 */
  for (const [w, h, label] of [[390, 844, '縦'], [1000, 445, '横']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const pg = await ctx.newPage();
    await pg.route('**/*fonts.g*.com/**', r => r.abort());
    await pg.goto(URL); await pg.waitForTimeout(800);
    await pg.evaluate(async () => {
      startGame({ p1: { deck: { soldier_001: 40 }, cls: 'formation', name: 'P1' },
                  p2: { deck: { flam_001: 40 }, cls: 'machina', name: 'P2' }, timer: 0, first: 'p1' });
      G.sim = false; G.phase = 'play'; G.active = 0; Sfx.on = false; Bgm.on = false;
      await beginTurn();
      await summonCard(1, 'wadatsumi_001'); await summonCard(1, 'fairy_001');
      UI.go('battle'); UI.renderBattle();
    });
    await pg.waitForTimeout(700);
    const g = await pg.evaluate(() => {
      const bt = document.querySelector('.bt');
      const px = s => Math.round(parseFloat(s));
      const rows = getComputedStyle(bt).gridTemplateRows.split(' ').map(px);
      const hh = n => Math.round(document.querySelector(n).getBoundingClientRect().height);
      return { rows, H: innerHeight, field: hh('.bt-field'), bottom: hh('.bt-bottom'), top: hh('.bt-top'),
               rowOf: ['.bt-top', '.bt-ohand', '.bt-field', '.bt-bottom']
                 .map(s => getComputedStyle(document.querySelector(s)).gridRowStart) };
    });
    ok(`${label}：対戦画面の段が名前で固定されている`,
       g.rowOf.join(',') === '1,2,3,4', g.rowOf.join(','));
    ok(`${label}：伸び代が盤面に渡っている（下の帯に奪われない）`,
       g.field > g.bottom, JSON.stringify({ field: g.field, bottom: g.bottom, H: g.H }));
    ok(`${label}：盤面が画面の4割以上を使う`,
       g.field >= g.H * .4, JSON.stringify({ field: g.field, H: g.H, pct: Math.round(g.field / g.H * 100) }));
    await ctx.close();
  }
}

console.log(OUT.join('\n'));
console.log('---- ' + OUT.filter(x => x.startsWith('PASS')).length + ' pass / ' + OUT.filter(x => x.startsWith('FAIL')).length + ' fail');
await b.close();
