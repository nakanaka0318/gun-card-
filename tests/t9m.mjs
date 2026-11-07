/* 調整履歴ページ、AI検証の確定表示、カードを出したときに盤面がずれないこと */
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
await pg.evaluate(() => { Sfx.on = false; Bgm.on = false; });

/* ---------- 調整履歴 ---------- */
const data = await pg.evaluate(() => {
  const items = UPDATES.flatMap(u => (u.groups || []).flatMap(g => g.items || []));
  return {
    entries: UPDATES.length,
    firstDate: UPDATES[0] && UPDATES[0].date,
    oldestDate: UPDATES.length && UPDATES[UPDATES.length - 1].date,
    newestFirst: UPDATES.every((u, i) => i === 0 || UPDATES[i - 1].date >= u.date),
    items: items.length,
    badId: items.filter(it => it.id && !CARD_BY_ID[it.id]).map(it => it.id),
    nameMismatch: items.filter(it => it.id && CARD_BY_ID[it.id] && CARD_BY_ID[it.id].name !== it.name).map(it => it.id),
    noBody: items.filter(it => !(it.from != null && it.to != null) && !it.text).map(it => it.name),
    inScreens: SCREENS.indexOf('updates') >= 0,
    homeBtn: !!document.querySelector('[data-go="updates"]')
  };
});
ok('ホームに調整履歴の入り口がある', data.homeBtn, String(data.homeBtn));
ok('画面として登録されている', data.inScreens, String(data.inScreens));
ok('最初のアップデート（2026-11-02）が一番古い記録として残っている',
   data.entries >= 1 && data.oldestDate === '2026-11-02', JSON.stringify(data));
ok('新しいものが先頭に並んでいる', data.newestFirst, String(data.newestFirst));
ok('書いたカードIDが全て実在する', data.badId.length === 0, data.badId.join());
ok('書いたカード名が今のカード名と一致する', data.nameMismatch.length === 0, data.nameMismatch.join());
ok('どの項目にも変更内容が書いてある', data.noBody.length === 0, data.noBody.join());

await pg.evaluate(() => UI.go('updates')); await pg.waitForTimeout(400);
const view = await pg.evaluate(() => ({
  shown: !document.getElementById('sc-updates').hidden,
  sections: document.querySelectorAll('#updateList .upd').length,
  items: document.querySelectorAll('#updateList .upditem').length,
  groups: [...document.querySelectorAll('#updateList .updgroup')].map(x => x.textContent),
  latestTag: !!document.querySelector('#updateList .upd.latest .updnew'),
  links: document.querySelectorAll('#updateList [data-upd-card]').length,
  /* 札のスタイルを巻き込んでいないこと（以前 .card と名前がぶつかって潰れた） */
  itemW: Math.round(document.querySelector('#updateList .upditem').getBoundingClientRect().width),
  listW: Math.round(document.querySelector('#updateList .updlist').getBoundingClientRect().width)
}));
ok('調整履歴の画面が開く', view.shown && view.sections >= 1, JSON.stringify(view));
ok('項目が並ぶ', view.items >= 20, String(view.items));
ok('下方修正と上方修正に分かれている',
   view.groups.indexOf('下方修正') >= 0 && view.groups.indexOf('上方修正') >= 0, view.groups.join());
ok('いちばん上に「最新」が付く', view.latestTag, String(view.latestTag));
ok('項目が横幅いっぱいに出る（札のスタイルを拾っていない）',
   view.itemW > view.listW * 0.9, JSON.stringify({ itemW: view.itemW, listW: view.listW }));

const link = await pg.evaluate(async () => {
  document.querySelector('[data-upd-card]').click();
  await new Promise(r => setTimeout(r, 300));
  const open = !document.getElementById('ovDetail').hidden;
  UI.closeDetail();
  return open;
});
ok('カード名を押すと詳しい説明が開く', link === true, String(link));

const lay = await pg.evaluate(() => {
  const bad = [];
  document.querySelectorAll('#sc-updates button').forEach(n => {
    const r = n.getBoundingClientRect();
    if (r.width > 0 && (r.height < 28 || r.width < 28)) bad.push((n.className || '') + ':' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  const over = [...document.querySelectorAll('#sc-updates *')].filter(n => {
    const r = n.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1.5 || r.left < -1.5);
  }).length;
  return { bad, over, page: document.documentElement.scrollWidth > innerWidth };
});
ok('調整履歴が横にはみ出さない', lay.over === 0 && !lay.page, JSON.stringify(lay));
ok('調整履歴の押す部品が小さすぎない', lay.bad.length === 0, lay.bad.join(' | '));

/* ---------- AI検証はこの日付で確定 ---------- */
const fixed = await pg.evaluate(async () => {
  UI.go('record');
  document.querySelector('[data-rec-tab="ai"]').click();
  await new Promise(r => setTimeout(r, 350));
  const notes = [...document.querySelectorAll('#recAi .note')].map(n => n.textContent);
  return { at: AI_MATCHUP.at, hasFixedNote: !!document.querySelector('#recAi .note.fixed'),
           says: notes.some(t => t.indexOf('確定') >= 0 && t.indexOf(AI_MATCHUP.at) >= 0) };
});
ok('AI検証に「確定」と日付が出ている', fixed.hasFixedNote && fixed.says, JSON.stringify(fixed));

/* ---------- カードを出しても盤面がずれない ---------- */
const shift = await pg.evaluate(async () => {
  startGame({ p1: { deck: { goblin_001: 40 }, cls: 'formation', name: 'A' },
              p2: { deck: { goblin_001: 40 }, cls: 'formation', name: 'B' }, timer: 0, first: 'p1', mode: 'pvp' });
  G.phase = 'play'; G.active = 0; G.players[0].pp = 10; G.players[0].maxPP = 10;
  await beginTurn(); UI.go('battle'); UI.renderBattle();
  await new Promise(r => setTimeout(r, 300));
  const box = s => { const r = document.querySelector(s).getBoundingClientRect();
    return { t: Math.round(r.top), h: Math.round(r.height) }; };
  const before = { field: box('.bt-field'), me: box('#boardMe'), opp: box('#boardOpp'),
                   hand: box('#handMe'), bottom: box('.bt-bottom') };
  const c = G.players[0].hand.find(x => canPlay(x));
  await playCard(c.uid);
  await new Promise(r => setTimeout(r, 450));
  const after = { field: box('.bt-field'), me: box('#boardMe'), opp: box('#boardOpp'),
                  hand: box('#handMe'), bottom: box('.bt-bottom') };
  const moved = Object.keys(before).filter(k => before[k].t !== after[k].t || before[k].h !== after[k].h);
  return { before, after, moved };
});
ok('カードを出しても自分の場の位置と高さが変わらない',
   shift.moved.indexOf('me') < 0, JSON.stringify({ before: shift.before.me, after: shift.after.me }));
ok('カードを出しても盤面全体がずれない', shift.moved.length === 0, shift.moved.join());

/* 札が瞬間移動せず滑って動く（FLIP） */
const flip = await pg.evaluate(async () => {
  G.players[0].pp = 10;
  const c = G.players[0].hand.find(x => canPlay(x));
  if (!c) return { reduce: ReduceMotion, moving: -1, left: -1 };
  await playCard(c.uid);
  const moving = [...document.querySelectorAll('#handMe .card')].filter(n => /translate/.test(n.style.transform)).length;
  await new Promise(r => setTimeout(r, 400));
  const left = [...document.querySelectorAll('#handMe .card')].filter(n => n.style.transform).length;
  return { reduce: ReduceMotion, moving, left };
});
ok('並び直す札は滑って動く', flip.reduce === true || flip.moving > 0, JSON.stringify(flip));
ok('動いたあとに位置のずらしが残らない', flip.left === 0, String(flip.left));

ok('ページエラーなし', errs.length === 0, errs.join(' | '));
console.log(OUT.join('\n'));
await b.close();
