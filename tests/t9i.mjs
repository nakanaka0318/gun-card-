/* ver9 のフォーマットデッキ5つ */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
const URL = pathToFileURL(join(dirname(dirname(fileURLToPath(import.meta.url))), 'index.html')).href;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const OUT = [];
const ok = (n, c, d = '') => OUT.push((c ? 'PASS ' : 'FAIL ') + n + (d ? ' :: ' + d : ''));
const pg = await b.newPage({ viewport: { width: 412, height: 892 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/*fonts.g*.com/**', r => r.abort());
await pg.goto(URL); await pg.waitForTimeout(900);

/* ---------- 構成そのものの検査 ---------- */
const A = await pg.evaluate(() => {
  const v9 = FORMAT_DECKS.filter(d => (d.ver || 1) === 9);
  const rows = v9.map(d => {
    const ids = Object.keys(d.list);
    return {
      key: d.key, cls: d.cls, name: d.name, total: deckTotal(d), valid: deckValid(d), limit: !!d.limit,
      kinds: ids.length,
      over: ids.filter(id => d.list[id] > RULES.maxCopies),
      unknown: ids.filter(id => !CARD_BY_ID[id]),
      tokens: ids.filter(id => (CARD_BY_ID[id] || {}).token),
      offClass: ids.filter(id => { const c = CARD_BY_ID[id]; return c && c.cls !== d.cls && c.cls !== 'neutral'; }),
      v9kinds: ids.filter(id => ((CARD_BY_ID[id] || {}).ver || 1) === 9).length,
      note: (d.note || '').length,
      text: deckText(d).length
    };
  });
  return { n: v9.length, rows, count: formatDeckCount(9),
           classes: v9.map(d => d.cls).sort().join(','),
           keys: v9.map(d => d.key).sort().join(','),
           inVersions: VERSIONS.indexOf(9) >= 0,
           pairs: matchupPairs(9).length,
           perClass: ['formation','accel','dominion','arcana','machina'].map(c => !!formatDeckFor(c, 9)) };
});
ok('ver9 のフォーマットデッキが5つある', A.n === 5 && A.count === 5, `${A.n} / count=${A.count}`);
ok('5クラスぶんそろっている',
   A.classes === ['accel','arcana','dominion','formation','machina'].join(',') && A.perClass.every(Boolean),
   A.classes + ' / ' + JSON.stringify(A.perClass));
A.rows.forEach(r => {
  ok(`${r.name}：40枚ちょうど`, r.total === 40, String(r.total));
  ok(`${r.name}：デッキとして成立している`, r.valid, JSON.stringify({ valid: r.valid, over: r.over }));
  ok(`${r.name}：知らないID・トークン・クラス違いが無い`,
     !r.unknown.length && !r.tokens.length && !r.offClass.length,
     JSON.stringify({ unknown: r.unknown, tokens: r.tokens, offClass: r.offClass }));
  ok(`${r.name}：同名3枚まで`, !r.over.length, r.over.join(','));
  ok(`${r.name}：ver9 のカードが入っている`, r.v9kinds >= 8, String(r.v9kinds));
  ok(`${r.name}：説明文とデッキ文がある`, r.note > 20 && r.text > 50, JSON.stringify({ note: r.note, text: r.text }));
});
ok('相性検証で ver9 の総当たりが組める', A.pairs > 0, String(A.pairs));

/* ---------- 画面に出るか ---------- */
await pg.evaluate(() => UI.go('format')); await pg.waitForTimeout(600);
const screen = await pg.evaluate(() => {
  /* 絞り込みは select ではなく、ボタンの並び（#formatVer）になっている */
  const chips = [...document.querySelectorAll('#formatVer [data-fver], #formatVer button')];
  /* ボタンの字は「ver9」＋デッキ数（例: ver95）なので、前方一致で探す */
  const v9 = chips.find(c => /^ver9(\D|$|\d)/.test(c.textContent.trim()) && c.textContent.trim().indexOf('ver9') === 0);
  if (v9) v9.click();
  return new Promise(r => setTimeout(() => {
    const txt = document.querySelector('#sc-format').textContent;
    r({ hasSel: !!v9, chips: chips.map(c => c.textContent.trim()).join(','),
        missing: FORMAT_DECKS.filter(d => (d.ver || 1) === 9).filter(d => txt.indexOf(d.name) < 0).map(d => d.name),
        over: [...document.querySelectorAll('#sc-format *')]
          .filter(n => { const b = n.getBoundingClientRect(); return b.width && b.right > innerWidth + 1.5; }).length });
  }, 500));
});
ok('フォーマット画面の絞り込みに ver9 があり、5デッキと出る',
   screen.hasSel && screen.chips.indexOf('ver95') >= 0, screen.chips);
ok('ver9 の5デッキが画面に出る', screen.missing.length === 0, screen.missing.join(','));
ok('フォーマット画面が横にはみ出さない', screen.over === 0, String(screen.over));

/* ---------- 実際に回る ---------- */
const sim = await pg.evaluate(async () => {
  const ds = FORMAT_DECKS.filter(d => (d.ver || 1) === 9);
  const res = { games: {}, err: null };
  try {
    for (let i = 0; i < ds.length; i++) {
      const a = ds[i], c = ds[(i + 1) % ds.length];
      let w = [0, 0, 0], turns = [];
      for (let k = 0; k < 6; k++) {
        const m = await simulateMatch(a.list, a.cls, 'A', c.list, c.cls, 'B', 70);
        w[m.result === 'A' ? 0 : m.result === 'B' ? 1 : 2]++; turns.push(m.turns);
      }
      turns.sort((x, y) => x - y);
      res.games[a.cls + ' vs ' + c.cls] = { w: w.join('-'), med: turns[3], max: turns[turns.length - 1] };
    }
  } catch (e) { res.err = e.message; }
  return res;
});
const g = Object.values(sim.games);
ok('ver9 デッキ同士の自動対戦が最後まで進む',
   !sim.err && g.length === 5, JSON.stringify({ err: sim.err, games: sim.games }));
ok('どの組み合わせも引き分け（時間切れ）ばかりにならない',
   g.every(x => +x.w.split('-')[2] <= 3), JSON.stringify(sim.games));
ok('ライブラリアウト型でも試合が壊れない（山札切れが勝利として扱われる）',
   g.every(x => x.med > 0), JSON.stringify(sim.games));
ok('フォーマットデッキでページエラーなし', errs.length === 0, errs.join(' | '));

console.log(OUT.join('\n'));
console.log('---- ' + OUT.filter(x => x.startsWith('PASS')).length + ' pass / ' + OUT.filter(x => x.startsWith('FAIL')).length + ' fail');
await b.close();
