/* 奥義ゲージ（自分のターン開始時と、自分のフォロワーが進化した時だけ増える） */
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

const g = await pg.evaluate(async () => {
  const o = {};
  startGame({ p1: { deck: { goblin_001: 40 }, cls: 'formation', name: 'A' },
              p2: { deck: { goblin_001: 40 }, cls: 'formation', name: 'B' }, timer: 0, first: 'p1', mode: 'pvp' });
  G.phase = 'play'; G.active = 0; await beginTurn();
  const A = G.players[0], B = G.players[1];
  o.start = [A.okugi, okugiValue(A.hand[0])];
  /* 後から手札に来た札も同じ値（札ごとではなくゲージなので） */
  const late = makeInstance('goblin_001', 0); A.hand.push(late);
  o.sameForAll = okugiValue(late) === okugiValue(A.hand[0]);
  /* 自分のフォロワーの進化で+1 */
  A.pp = 20; A.ep = 5; A.sep = 5;
  const f = makeInstance('goblin_001', 0); f.summonedThisTurn = false; A.board.push(f);
  const v1 = A.okugi; await applyEvolve(f, false, true);
  o.ownEvolve = [v1, A.okugi];
  /* 相手のフォロワーの進化では自分は増えず、相手だけ増える */
  const e = makeInstance('goblin_001', 1); B.board.push(e);
  const v2 = A.okugi, w2 = B.okugi; await applyEvolve(e, false, true);
  o.enemyEvolveMe = [v2, A.okugi];
  o.enemyEvolveThem = [w2, B.okugi];
  /* 自分のターン開始で+1、相手のターン開始では増えない */
  const v3 = A.okugi; G.active = 0; await beginTurn();
  o.myTurn = [v3, A.okugi];
  const v4 = A.okugi; G.active = 1; await beginTurn();
  o.theirTurn = [v4, A.okugi];
  /* 超進化でも増える */
  G.active = 0;
  const s = makeInstance('goblin_001', 0); s.summonedThisTurn = false; A.board.push(s);
  const v5 = A.okugi; await applyEvolve(s, true, true);
  o.superEvolve = [v5, A.okugi];
  /* プレイした瞬間の値で固定される（場に出たあとゲージが動いても変わらない） */
  const c = A.hand[0]; A.pp = 20; await playCard(c.uid, null);
  const fixed = c._okugiAt;
  const f2 = makeInstance('goblin_001', 0); f2.summonedThisTurn = false; A.board.push(f2);
  await applyEvolve(f2, false, true);
  o.frozen = [fixed, c._okugiAt, A.okugi];
  /* 奥義の段の判定がゲージを見ている */
  const t = makeInstance('iiwia_001', 0);                      // 奥義10
  A.okugi = 9; o.below = okugiReached(t).length;
  A.okugi = 10; o.atOrAbove = okugiReached(t).length;
  return o;
});
ok('1ターン目のゲージは1', g.start[0] === 1 && g.start[1] === 1, JSON.stringify(g.start));
ok('手札のどの札も同じ値になる', g.sameForAll, String(g.sameForAll));
ok('自分のフォロワーが進化すると+1', g.ownEvolve[1] === g.ownEvolve[0] + 1, JSON.stringify(g.ownEvolve));
ok('相手のフォロワーの進化では増えない', g.enemyEvolveMe[1] === g.enemyEvolveMe[0], JSON.stringify(g.enemyEvolveMe));
ok('相手の進化では相手のゲージが増える', g.enemyEvolveThem[1] === g.enemyEvolveThem[0] + 1, JSON.stringify(g.enemyEvolveThem));
ok('自分のターン開始で+1', g.myTurn[1] === g.myTurn[0] + 1, JSON.stringify(g.myTurn));
ok('相手のターン開始では増えない', g.theirTurn[1] === g.theirTurn[0], JSON.stringify(g.theirTurn));
ok('超進化でも+1', g.superEvolve[1] === g.superEvolve[0] + 1, JSON.stringify(g.superEvolve));
ok('プレイした瞬間の値で固定される',
   g.frozen[0] === g.frozen[1] && g.frozen[2] > g.frozen[0], JSON.stringify(g.frozen));
ok('しきい値の判定がゲージを見ている', g.below === 0 && g.atOrAbove === 1, JSON.stringify([g.below, g.atOrAbove]));

const txt = await pg.evaluate(() => ({
  desc: KEYWORDS.okugi.desc,
  stale: /ターン数/.test(KEYWORDS.okugi.desc),
  hasGauge: /奥義ゲージ/.test(KEYWORDS.okugi.desc),
  noOldField: typeof makeInstance('goblin_001', 0).okugiEvolves === 'undefined'
}));
ok('説明がゲージの話になっている', txt.hasGauge && !txt.stale, txt.desc.slice(0, 60));
ok('古い札ごとの数え上げが残っていない', txt.noOldField, String(txt.noOldField));
ok('ページの例外がない', errs.length === 0, errs.join(' | '));
await b.close();
console.log(OUT.join('\n'));
console.log('==== ' + OUT.filter(l => l.startsWith('PASS')).length + ' pass / ' + OUT.filter(l => l.startsWith('FAIL')).length + ' fail ====');
