/* デッキ編成の作り直し分（コストの分布・絞り込み・探す・デッキ確認） */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
const URL = pathToFileURL(join(dirname(dirname(fileURLToPath(import.meta.url))), 'index.html')).href;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const OUT = [];
const ok = (n, c, d = '') => OUT.push((c ? 'PASS ' : 'FAIL ') + n + (d ? ' :: ' + d : ''));
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/*fonts.g*.com/**', r => r.abort());
await pg.goto(URL); await pg.waitForTimeout(900);
/* コストがばらけた実物のデッキを編集対象にする */
await pg.evaluate(() => {
  Sfx.on = false; Bgm.on = false;
  const f = FORMAT_DECKS.find(x => x.key === 'dominion_v9');
  const d = { id: 'probe', name: f.name, cls: f.cls, list: JSON.parse(JSON.stringify(f.list)), limit: true };
  Decks.push(d); DeckEditId = d.id; UI.go('deck');
});
await pg.waitForTimeout(700);

/* ---------- コストの分布 ---------- */
const cv = await pg.evaluate(() => {
  const d = findDeck(DeckEditId), sh = deckShape(d);
  const bars = [...document.querySelectorAll('#deckCurve .cv')];
  const shown = bars.map(x => +x.querySelector('.cn').textContent);
  const labels = bars.map(x => x.querySelector('.cl').textContent);
  const want = COST_SLOTS.map(k => sh.curve[k]);
  return { n: bars.length, shown, want, labels, sum: shown.reduce((a, x) => a + x, 0), total: deckTotal(d),
    tiny: bars.filter(x => { const r = x.getBoundingClientRect(); return r.height < 36 || r.width < 30; }).length,
    over: bars.filter(x => x.getBoundingClientRect().right > innerWidth + 1.5).length,
    mix: document.querySelector('#deckMix').textContent,
    kinds: sh.kinds };
});
ok('コストの分布が8本ある（8以上はまとめる）', cv.n === 8 && cv.labels.join(',') === '1,2,3,4,5,6,7,8+', cv.labels.join(','));
ok('分布の数字がデッキの中身と合っている', cv.shown.join(',') === cv.want.join(','), JSON.stringify(cv));
ok('分布の合計がデッキの枚数と合う', cv.sum === cv.total, `${cv.sum}/${cv.total}`);
ok('分布の棒は指で押せる大きさで、横にはみ出さない', cv.tiny === 0 && cv.over === 0, JSON.stringify({ tiny: cv.tiny, over: cv.over }));
ok('フォロワー・スペル・アミュレットの内訳が出る',
   cv.mix.indexOf('フォロワー' + cv.kinds.follower) >= 0 && cv.mix.indexOf('スペル' + cv.kinds.spell) >= 0,
   cv.mix);

/* ---------- 棒を押してコストで絞る ---------- */
const f1 = await pg.evaluate(async () => {
  document.querySelector('#deckCurve [data-cost="3"]').click();
  await new Promise(r => setTimeout(r, 250));
  const ids = [...document.querySelectorAll('#deckList .gcard')].map(n => n.dataset.inc);
  return { filter: DeckCostFilter.slice(), n: ids.length,
           allCost3: ids.every(id => CARD_BY_ID[id].cost === 3),
           pressed: document.querySelector('#deckCurve [data-cost="3"]').getAttribute('aria-pressed') };
});
ok('棒を押すとそのコストだけになる', f1.allCost3 && f1.n > 0 && f1.filter.join() === '3', JSON.stringify(f1));
ok('押した棒は押された見た目になる', f1.pressed === 'true', f1.pressed);

const f2 = await pg.evaluate(async () => {
  document.querySelector('#deckCurve [data-cost="5"]').click();
  await new Promise(r => setTimeout(r, 250));
  const ids = [...document.querySelectorAll('#deckList .gcard')].map(n => n.dataset.inc);
  return { filter: DeckCostFilter.slice(), costs: [...new Set(ids.map(id => CARD_BY_ID[id].cost))].sort() };
});
ok('複数のコストを同時に選べる',
   f2.filter.join() === '3,5' && f2.costs.join() === '3,5', JSON.stringify(f2));

const f3 = await pg.evaluate(async () => {
  document.querySelector('#deckCurve [data-cost="3"]').click();
  document.querySelector('#deckCurve [data-cost="5"]').click();
  await new Promise(r => setTimeout(r, 250));
  return { filter: DeckCostFilter.slice(), n: document.querySelectorAll('#deckList .gcard').length };
});
ok('もう一度押すと解除され、候補が戻る', f3.filter.length === 0 && f3.n > 20, JSON.stringify(f3));

const f8 = await pg.evaluate(async () => {
  document.querySelector('#deckCurve [data-cost="8"]').click();
  await new Promise(r => setTimeout(r, 250));
  const ids = [...document.querySelectorAll('#deckList .gcard')].map(n => n.dataset.inc);
  const r = { all8plus: ids.every(id => CARD_BY_ID[id].cost >= 8), n: ids.length,
              has9: ids.some(id => CARD_BY_ID[id].cost > 8) };
  document.querySelector('#deckCurve [data-cost="8"]').click();
  await new Promise(r2 => setTimeout(r2, 200));
  return r;
});
ok('「8+」はコスト8以上をまとめて出す', f8.all8plus && f8.n > 0 && f8.has9, JSON.stringify(f8));

/* ---------- 探す ---------- */
const s1 = await pg.evaluate(async () => {
  const box = document.querySelector('#deckFind');
  box.value = 'トレント'; box.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  const names = [...document.querySelectorAll('#deckList .gcard')].map(n => CARD_BY_ID[n.dataset.inc].name);
  box.value = '守護'; box.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  const kw = [...document.querySelectorAll('#deckList .gcard')].map(n => CARD_BY_ID[n.dataset.inc]);
  box.value = 'アミュレット'; box.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  const hits = [...document.querySelectorAll('#deckList .gcard')].map(n => CARD_BY_ID[n.dataset.inc]);
  const d2 = findDeck(DeckEditId);
  const allAmulets = CARDS.filter(c => !c.token && c.type === 'amulet' &&
    (c.cls === d2.cls || (c.cls === 'neutral' && showNeutralPool)));
  const types = { hit: hits.length,
    everyMentions: hits.every(c => cardTextMatches(c, 'アミュレット')),
    coversAll: allAmulets.every(c => hits.some(h => h.id === c.id)) };
  box.value = 'ないないない'; box.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  const empty = (document.querySelector('#deckList .empty') || {}).textContent || '';
  box.value = ''; box.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  return { byName: names, kwOK: kw.length > 0 && kw.every(c => (c.name + (c.text || '') +
             (c.keywords || []).map(k => KEYWORDS[k].name).join('')).indexOf('守護') >= 0),
           types, empty, back: document.querySelectorAll('#deckList .gcard').length };
});
ok('カード名で探せる', s1.byName.length === 1 && s1.byName[0] === 'トレント', JSON.stringify(s1.byName));
ok('効果の文やキーワードでも探せる', s1.kwOK, '');
/* 自由な言葉の検索なので、種別そのものに加えて「文中でそれに触れている札」も出る */
ok('種別の名前で探すと、その種別の札が漏れなく出る',
   s1.types.coversAll && s1.types.hit > 0, JSON.stringify(s1.types));
ok('検索に出た札はどれも、その言葉をどこかに含んでいる', s1.types.everyMentions, JSON.stringify(s1.types));
ok('見つからない時はその旨が出る', s1.empty.indexOf('当てはまる候補がない') >= 0, s1.empty);
ok('空にすると候補が戻る', s1.back > 20, String(s1.back));

/* ---------- デッキ確認 ---------- */
const chk = await pg.evaluate(async () => {
  document.querySelector('#deckCheck').click();
  await new Promise(r => setTimeout(r, 400));
  const d = findDeck(DeckEditId), sh = deckShape(d);
  const cells = [...document.querySelectorAll('#checkGrid .ccell')];
  const counts = cells.map(c => +c.querySelector('.cn').textContent);
  const curve = [...document.querySelectorAll('#checkCurve .cn')].map(x => +x.textContent);
  const costs = cells.map(c => +c.querySelector('.card .c-cost').textContent);
  return { open: !document.querySelector('#ovCheck').hidden,
    kinds: cells.length, deckKinds: Object.keys(d.list).length,
    sum: counts.reduce((a, x) => a + x, 0), total: deckTotal(d),
    curve, want: COST_SLOTS.map(k => sh.curve[k]),
    sorted: costs.every((v, i) => i === 0 || v >= costs[i - 1]),
    labels: [...document.querySelectorAll('#checkGrid .glabel')].map(x => x.textContent),
    over: [...document.querySelectorAll('#ovCheck *')].filter(n => { const r = n.getBoundingClientRect();
      return r.width && (r.right > innerWidth + 1.5 || r.left < -1.5); }).length,
    title: document.querySelector('#checkTitle').textContent };
});
ok('デッキ確認が開く', chk.open, '');
ok('デッキの全種類が並ぶ', chk.kinds === chk.deckKinds && chk.kinds > 5, JSON.stringify({ kinds: chk.kinds, deckKinds: chk.deckKinds }));
ok('枚数の合計がデッキの枚数と合う', chk.sum === chk.total, `${chk.sum}/${chk.total}`);
ok('デッキ確認にもコストの分布が出る', chk.curve.join() === chk.want.join(), JSON.stringify(chk.curve));
ok('コストの小さい順に並び、コストごとの見出しが付く',
   chk.sorted && chk.labels.length > 2 && chk.labels[0].indexOf('コスト') >= 0, JSON.stringify(chk.labels));
ok('デッキ確認が横にはみ出さない', chk.over === 0, String(chk.over));
ok('デッキ名が見出しに出る', chk.title.indexOf('購入ドミニオン') >= 0, chk.title);

const chk2 = await pg.evaluate(async () => {
  document.querySelector('#checkClose').click();
  await new Promise(r => setTimeout(r, 200));
  const closed = document.querySelector('#ovCheck').hidden;
  /* 空のデッキでも壊れない */
  const d = findDeck(DeckEditId); const keep = d.list; d.list = {};
  document.querySelector('#deckCheck').click();
  await new Promise(r => setTimeout(r, 300));
  const emptyMsg = (document.querySelector('#checkGrid .empty') || {}).textContent || '';
  const zero = document.querySelector('#checkCount').textContent;
  document.querySelector('#checkClose').click();
  d.list = keep; UI.renderDeck();
  return { closed, emptyMsg, zero };
});
ok('閉じるで戻れる', chk2.closed, '');
ok('空のデッキでも壊れず、0枚と出る',
   chk2.emptyMsg.indexOf('まだ1枚も') >= 0 && chk2.zero.indexOf('0') === 0, JSON.stringify(chk2));

/* ---------- 操作帯の高さ（札が見える余地） ---------- */
const sz = await pg.evaluate(() => {
  const fix = document.querySelector('.deckfix').getBoundingClientRect();
  const cards = [...document.querySelectorAll('#deckList .card')];
  const vis = cards.filter(c => { const r = c.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
  return { fixH: Math.round(fix.height), H: innerHeight, visible: vis.length,
           pct: Math.round(fix.height / innerHeight * 100) };
});
ok('操作帯が画面の1/4に収まる', sz.pct <= 25, JSON.stringify(sz));
ok('開いた時点で札が10枚以上見えている', sz.visible >= 10, JSON.stringify(sz));
ok('デッキ編成でページエラーなし', errs.length === 0, errs.join(' | '));

console.log(OUT.join('\n'));
console.log('---- ' + OUT.filter(x => x.startsWith('PASS')).length + ' pass / ' + OUT.filter(x => x.startsWith('FAIL')).length + ' fail');
await b.close();
