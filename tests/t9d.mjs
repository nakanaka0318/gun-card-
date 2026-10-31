/* ver9 が画面とルールブックに正しく出るか／実戦で落ちないか */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
/* リポジトリ内の index.html を、この検証ファイルの位置から探す（置き場所が変わっても動く） */
const PAGE = pathToFileURL(join(dirname(dirname(fileURLToPath(import.meta.url))), 'index.html')).href;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const OUT = [];
const ok = (n, c, d = '') => OUT.push((c ? 'PASS ' : 'FAIL ') + n + (d ? ' :: ' + d : ''));
const pg = await b.newPage({ viewport: { width: 412, height: 892 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/*fonts.g*.com/**', r => r.abort());
await pg.goto(PAGE); await pg.waitForTimeout(900);

/* --- ルールブックに新しい用語が出る --- */
await pg.evaluate(() => UI.go('rule')); await pg.waitForTimeout(500);
const ruleTxt = await pg.evaluate(() => $('#ruleAcc').textContent);
ok('ルールブックに「成長」の説明がある',
   ruleTxt.includes('成長') && ruleTxt.includes('このカードのコストはXになり'), '');
ok('ルールブックにエンハンスが残っていない', !ruleTxt.includes('エンハンス'), '');
ok('ルールブックに「山札で捨てられた時」の説明がある', ruleTxt.includes('山札で捨てられた時'), '');

/* --- カード一覧に ver9 が出て、絞り込みも効く --- */
await pg.evaluate(() => UI.go('cards')); await pg.waitForTimeout(600);
const list = await pg.evaluate(() => {
  const sel = document.querySelector('#cardVer') || [...document.querySelectorAll('select')]
    .find(s => [...s.options].some(o => o.textContent.indexOf('ver9') >= 0));
  return { hasOpt: !!sel && [...sel.options].some(o => o.textContent.indexOf('ver9') >= 0),
           id: sel ? (sel.id || sel.className) : null,
           opts: sel ? [...sel.options].map(o => o.textContent).slice(-3) : [] };
});
ok('カード一覧の絞り込みに ver9 が並ぶ', list.hasOpt, JSON.stringify(list));
const shown = await pg.evaluate(() => {
  const all = CARDS.filter(c => c.ver === 9 && !c.token);
  const txt = document.querySelector('#sc-cards').textContent;
  return { n: all.length, missing: all.filter(c => txt.indexOf(c.name) < 0).map(c => c.name) };
});
ok('ver9 の24枚がカード一覧に載っている', shown.missing.length === 0, shown.missing.join(','));

/* --- 詳細を開いても落ちない（全24枚） --- */
const detail = await pg.evaluate(async () => {
  const bad = [];
  for (const c of CARDS.filter(x => x.ver === 9)) {
    try { UI.showDetail(c.id); } catch (e) { bad.push(c.id + ':' + e.message); }
  }
  UI.go('cards');
  return bad;
});
ok('ver9 全24枚の詳細を開いてもエラーにならない', detail.length === 0, detail.join(' | '));

/* --- デッキ編成で ver9 のカードを積める --- */
const deck = await pg.evaluate(() => {
  const d = { list: {}, cls: 'formation' };
  const picks = CARDS.filter(c => c.ver === 9 && (c.cls === 'formation' || c.cls === 'neutral') && !c.token);
  return { n: picks.length, names: picks.map(c => c.name) };
});
ok('フォーメーションで使える ver9 カードが16枚ある（エニグマ込み）', deck.n === 16, String(deck.n));

/* --- 実戦：ver9 を多く積んだデッキで最後まで自動対戦（10戦） --- */
const sim = await pg.evaluate(async () => {
  const v9f = { sentryknight_001: 3, bergival_001: 3, stachium_001: 3, octrice_001: 3,
                doomemory_001: 3, graveeater_001: 3, backwood_001: 3, ezdia_001: 2,
                trent_001: 3, tokimeki_001: 3, solipsism_001: 2, mazelbane_001: 2,
                godheart_001: 3, rudeman_001: 2, fildore_001: 1, miroku_001: 1 };
  const v9a = { waterface_001: 3, steppingstone_001: 3, meltalchemist_001: 3, azraflete_001: 2,
                orca_001: 3, dullardent_001: 3, ryufu_001: 3, yube_001: 2,
                trent_001: 3, tokimeki_001: 3, solipsism_001: 3, mazelbane_001: 2,
                godheart_001: 3, rudeman_001: 2, fildore_001: 1, miroku_001: 1 };
  const tot = o => Object.values(o).reduce((a, x) => a + x, 0);
  const res = { sizes: [tot(v9f), tot(v9a)], wins: [0, 0, 0], turns: [], err: null };
  try {
    for (let i = 0; i < 10; i++) {
      const r = await simulateMatch(v9f, 'formation', 'F', v9a, 'accel', 'A', 60);
      res.wins[r.result === 'A' ? 0 : r.result === 'B' ? 1 : 2]++;
      res.turns.push(r.turns);
    }
  } catch (e) { res.err = e.message; }
  return res;
});
ok('ver9 を積んだデッキが40枚ちょうどになる', sim.sizes.join(',') === '40,40', sim.sizes.join(','));
ok('ver9 同士の自動対戦が10戦とも最後まで進む',
   !sim.err && sim.wins[0] + sim.wins[1] + sim.wins[2] === 10,
   JSON.stringify({ wins: sim.wins, err: sim.err, turns: sim.turns.slice(0, 5) }));
ok('どちらのクラスも勝てる（一方的すぎない）', sim.wins[0] > 0 && sim.wins[1] > 0, JSON.stringify(sim.wins));

console.log(OUT.join('\n'));
console.log('pageerrors: ' + errs.length + (errs.length ? ' :: ' + errs.slice(0,3).join(' | ') : ''));
console.log('---- ' + OUT.filter(x => x.startsWith('PASS')).length + ' pass / ' + OUT.filter(x => x.startsWith('FAIL')).length + ' fail');
await b.close();
