/* 登場演出（カードごとの専用演出）と、その一覧ページ */
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

/* ---------- 定義そのもの ---------- */
const data = await pg.evaluate(() => {
  const keys = Object.keys(ENTRY_FX), ids = Object.keys(ENTRY_FX_OF);
  const partNames = Object.keys(EFX_PARTS);
  return {
    patterns: keys.length,
    cards: ids.length,
    badId: ids.filter(id => !CARD_BY_ID[id]),
    badKey: ids.filter(id => !ENTRY_FX[ENTRY_FX_OF[id]]),
    unused: keys.filter(k => !ids.some(id => ENTRY_FX_OF[id] === k)),
    noParts: keys.filter(k => !(ENTRY_FX[k].parts || []).length),
    badPart: keys.filter(k => (ENTRY_FX[k].parts || []).some(p => !partNames.includes(p[0]))),
    noName: keys.filter(k => !ENTRY_FX[k].name || !ENTRY_FX[k].kana),
    noColor: keys.filter(k => !ENTRY_FX[k].ck || !ENTRY_FX[k].ck2 || !ENTRY_FX[k].bg),
    dupName: (() => { const s = {}; return keys.filter(k => (s[ENTRY_FX[k].name] = (s[ENTRY_FX[k].name] || 0) + 1) > 1); })(),
    tooLong: keys.filter(k => (ENTRY_FX[k].ms || 1200) > 1600),
    tooShort: keys.filter(k => (ENTRY_FX[k].ms || 1200) < 800),
    olivierSame: ENTRY_FX_OF.olivier_001 === ENTRY_FX_OF.reolivier_001,
    resolve: [entryFxOf('satan_001'), entryFxOf('goblin_001')]
  };
});
ok('演出が40種類以上ある', data.patterns >= 40, String(data.patterns));
ok('45枚以上のカードに割り当てられている', data.cards >= 45, String(data.cards));
ok('割り当て先のカードIDが全て実在する', data.badId.length === 0, data.badId.join());
ok('割り当てた演出名が全て定義されている', data.badKey.length === 0, data.badKey.join());
ok('使われていない演出がない', data.unused.length === 0, data.unused.join());
ok('どの演出にも部品が入っている', data.noParts.length === 0, data.noParts.join());
ok('書いた部品名が全て存在する', data.badPart.length === 0, data.badPart.join());
ok('どの演出にも名札がある', data.noName.length === 0, data.noName.join());
ok('どの演出にも色が三つ揃っている', data.noColor.length === 0, data.noColor.join());
ok('演出の名前が重複していない', data.dupName.length === 0, data.dupName.join());
ok('長すぎる演出がない（1.6秒以内）', data.tooLong.length === 0, data.tooLong.join());
ok('短すぎる演出がない（0.8秒以上）', data.tooShort.length === 0, data.tooShort.join());
ok('オリヴィエ2枚は同じ演出', data.olivierSame, String(data.olivierSame));
ok('演出を持たない札は null になる',
   data.resolve[0] === 'doom' && data.resolve[1] === null, JSON.stringify(data.resolve));

/* ---------- 一覧ページ ---------- */
const page = await pg.evaluate(() => ({
  inScreens: SCREENS.indexOf('entryfx') >= 0,
  homeBtn: !!document.querySelector('[data-go="entryfx"]')
}));
ok('ホームに登場演出の入り口がある', page.homeBtn, String(page.homeBtn));
ok('画面として登録されている', page.inScreens, String(page.inScreens));

await pg.evaluate(() => UI.go('entryfx')); await pg.waitForTimeout(400);
const view = await pg.evaluate(() => {
  const its = [...document.querySelectorAll('.efxitem')];
  return {
    shown: !document.getElementById('sc-entryfx').hidden,
    items: its.length,
    tag: document.getElementById('efxTag').textContent,
    allHaveName: its.every(n => n.querySelector('.efxname').textContent.trim().length > 0),
    allHaveCards: its.every(n => n.querySelector('.efxcards').textContent.trim().length > 0),
    /* 札の名前がIDのまま出ていないこと */
    rawId: its.filter(n => /_\d{3}/.test(n.querySelector('.efxcards').textContent)).length,
    overflow: its.filter(n => n.scrollWidth > n.clientWidth + 1).length,
    wide: its.filter(n => n.getBoundingClientRect().right > 391).length
  };
});
ok('一覧が開く', view.shown, String(view.shown));
ok('全ての演出が並ぶ', view.items === data.patterns, view.items + '/' + data.patterns);
ok('件数の表示が合っている', view.tag === data.patterns + ' FX', view.tag);
ok('どの枠にも演出名が出ている', view.allHaveName, String(view.allHaveName));
ok('どの枠にも対象カード名が出ている', view.allHaveCards, String(view.allHaveCards));
ok('カード名がIDのまま出ていない', view.rawId === 0, String(view.rawId));
ok('枠が横にはみ出さない', view.overflow === 0 && view.wide === 0, JSON.stringify(view));

/* 押すと演出が流れ、終わると後片付けされる */
const play = await pg.evaluate(async () => {
  document.querySelector('[data-efx="doom"]').click();
  await new Promise(r => setTimeout(r, 500));
  const mid = { stages: document.querySelectorAll('.efx').length, parts: document.querySelectorAll('.efx > *').length,
                scrim: document.querySelectorAll('.e-scrim').length, name: document.querySelectorAll('.e-name').length,
                on: document.querySelectorAll('.efxitem.on').length };
  await new Promise(r => setTimeout(r, 1800));
  return { mid, after: { stages: document.querySelectorAll('.efx').length, on: document.querySelectorAll('.efxitem.on').length } };
});
ok('押すと演出が流れる', play.mid.stages === 1 && play.mid.parts > 3, JSON.stringify(play.mid));
ok('どの演出にも下地と名札が付く', play.mid.scrim === 1 && play.mid.name === 1, JSON.stringify(play.mid));
ok('再生中はその枠に印が付く', play.mid.on === 1, String(play.mid.on));
ok('終わると演出の層が残らない', play.after.stages === 0 && play.after.on === 0, JSON.stringify(play.after));

/* 43種すべてを流しても落ちない（部品の作りの取りこぼしを見る） */
const sweep = await pg.evaluate(async () => {
  const bad = [];
  const keys = Object.keys(ENTRY_FX), saved = {};
  keys.forEach(k => { saved[k] = ENTRY_FX[k].ms; ENTRY_FX[k].ms = 300; });   // 検証では待ち時間だけ縮める
  for (const k of keys) {
    try {
      const p = FX.playEntry(k, entryFxCards(k)[0], null, '#sc-entryfx .scroll');
      await new Promise(r => setTimeout(r, 40));
      const st = document.querySelector('.efx');
      if (!st) bad.push(k + ':層なし');
      else if (st.children.length < 3) bad.push(k + ':層' + st.children.length);
      await p;
    } catch (e) { bad.push(k + ':' + e.message); }
  }
  keys.forEach(k => { ENTRY_FX[k].ms = saved[k]; });
  return { bad, left: document.querySelectorAll('.efx').length };
});
ok('全ての演出が最後まで流れる', sweep.bad.length === 0, sweep.bad.join());
ok('流し終えたあと層が残らない', sweep.left === 0, String(sweep.left));

/* ---------- 対戦中：演出のあとにカードが出る ---------- */
const battle = await pg.evaluate(async () => {
  startGame({ p1: { deck: { goblin_001: 40 }, cls: 'formation', name: 'A' },
              p2: { deck: { goblin_001: 40 }, cls: 'formation', name: 'B' }, timer: 0, first: 'p1', mode: 'pvp' });
  G.phase = 'play'; G.active = 0; await beginTurn(); UI.go('battle'); UI.renderBattle();
  await new Promise(r => setTimeout(r, 200));
  const p = G.players[0];
  const run = async id => {
    FX._lastEntry = {};
    const c = makeInstance(id, 0); p.hand.push(c); p.pp = 30; UI.renderBattle();
    let sawStage = false, onBoardWhileStage = null;
    const t = setInterval(() => {
      if (document.querySelector('.efx')) {
        sawStage = true;
        if (onBoardWhileStage === null) onBoardWhileStage = p.board.some(f => f.cardId === id);
      }
    }, 40);
    const t0 = performance.now();
    await playCard(c.uid, null);
    clearInterval(t);
    return { id, ms: Math.round(performance.now() - t0), sawStage, onBoardWhileStage,
             landed: p.board.some(f => f.cardId === id) || p.grave.some(f => f.cardId === id),
             left: document.querySelectorAll('.efx').length };
  };
  const fx = await run('beltezor_001');        // 演出を持つフォロワー（選択を求めない札）
  const spell = await run('explosion_001');    // 演出を持つスペル
  const plain = await run('goblin_001');       // 演出を持たない札
  return { fx, spell, plain };
});
ok('演出を持つフォロワーで演出が流れる', battle.fx.sawStage, JSON.stringify(battle.fx));
ok('演出が終わってからカードが場に出る', battle.fx.onBoardWhileStage === false, JSON.stringify(battle.fx));
ok('そのフォロワーは最後に場へ出ている', battle.fx.landed, String(battle.fx.landed));
ok('演出を持つスペルでも演出が流れる', battle.spell.sawStage, JSON.stringify(battle.spell));
ok('スペルは演出のあと墓地へ行く', battle.spell.landed, String(battle.spell.landed));
ok('演出を持たない札は演出が流れない', battle.plain.sawStage === false, JSON.stringify(battle.plain));
ok('演出を持たない札は待たされない（0.6秒未満）', battle.plain.ms < 600, String(battle.plain.ms));
ok('対戦中も演出の層が残らない',
   battle.fx.left === 0 && battle.spell.left === 0, JSON.stringify([battle.fx.left, battle.spell.left]));

/* 同じ札を続けて出すときは2体目以降を省く */
const dedupe = await pg.evaluate(async () => {
  FX._lastEntry = {};
  const t0 = performance.now(); await summonCard(0, 'servant_001', null, 'effect');
  const first = Math.round(performance.now() - t0);
  const t1 = performance.now(); await summonCard(0, 'servant_001', null, 'effect');
  return { first, second: Math.round(performance.now() - t1) };
});
ok('同じ札を続けて出すと2体目は演出を省く',
   dedupe.first > 700 && dedupe.second < 400, JSON.stringify(dedupe));
ok('演出を省いたときは普通の召喚演出も流さない',
   dedupe.second < dedupe.first / 3, JSON.stringify(dedupe));

/* 動きを抑える設定では演出を出さない */
const rm = await pg.evaluate(() => typeof ReduceMotion === 'boolean');
ok('動きを抑える設定を見ている', rm, String(rm));

/* 自動対戦（sim）では演出を作らない */
const sim = await pg.evaluate(async () => {
  G.sim = true; FX._lastEntry = {};
  const r = await FX.entry('satan_001', null);
  const n = document.querySelectorAll('.efx').length;
  G.sim = false;
  return { r, n };
});
ok('自動対戦では演出を作らない', sim.r === false && sim.n === 0, JSON.stringify(sim));

ok('ページの例外がない', errs.length === 0, errs.join(' | '));
await b.close();
console.log(OUT.join('\n'));
console.log('==== ' + OUT.filter(l => l.startsWith('PASS')).length + ' pass / ' + OUT.filter(l => l.startsWith('FAIL')).length + ' fail ====');
