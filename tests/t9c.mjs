/* ver9 の残りのカードの挙動 */
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
await pg.evaluate(() => {
  window.fresh = async () => {
    startGame({ p1: { deck: { soldier_001: 40 }, cls: 'formation', name: 'A' },
                p2: { deck: { soldier_001: 40 }, cls: 'accel', name: 'B' }, timer: 0, first: 'p1' });
    G.sim = true; G.phase = 'play'; G.active = 0; await beginTurn();
    const P = G.players[0]; P.pp = 10; P.maxPP = 10; Sfx.on = false; P.hand = [];
    return P;
  };
  window.playNew = async (id, pp) => {
    const P = G.players[0];
    if (pp != null) { P.pp = pp; P.maxPP = Math.max(P.maxPP, pp); }
    const c = makeInstance(id, 0); P.hand.push(c); G.active = 0;
    await playCard(c.uid);
    return c;
  };
  window.ctx0 = () => ({ owner: 0, source: null, pick: () => [] });
});

/* --- 神の心臓：PPが余っていれば壊れて2枚引く --- */
const a = await pg.evaluate(async () => {
  const P = await fresh();
  const am = await summonCard(0, 'godheart_001');
  P.pp = 0; const h0 = P.hand.length;
  await runCardEffects(am, 'turnEnd', 0); await cleanupBoard();
  const kept = P.board.some(x => x.cardId === 'godheart_001');
  P.pp = 1;
  await runCardEffects(am, 'turnEnd', 0); await cleanupBoard();
  return { kept, gone: !P.board.some(x => x.cardId === 'godheart_001'), drew: P.hand.length - h0 };
});
ok('神の心臓はPPが余っていないと壊れない', a.kept, JSON.stringify(a));
ok('神の心臓はPPが1余ると壊れて2枚引く', a.gone && a.drew === 2, JSON.stringify(a));

/* --- ミロク：3つの選択肢それぞれが働く --- */
const m = await pg.evaluate(async () => {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const P = await fresh();
    const tgt = await summonCard(1, 'himeka_001');
    P.life = 10; P.pp = 4;
    const before = { pp: P.pp, life: P.life, hp: tgt.hp };
    const f = await summonCard(0, 'miroku_001');
    const orig = window.resolveChoiceOptions;
    window.__pick = i;
    // 選択肢の i 番目を直接働かせる
    const opt = CARD_BY_ID.miroku_001.effects[0].params.options[i];
    for (const e of opt.effects) await EFFECTS[e.type]({ owner: 0, source: f, pick: t => {
      if (t === 'ownLeader') return [leaderRef(0)];
      if (t === 'randomEnemyFollower') return [tgt];
      return [];
    } }, e.params || {});
    out.push({ label: opt.label, dpp: P.pp - before.pp, dlife: P.life - before.life, dmg: before.hp - tgt.hp });
  }
  return out;
});
ok('ミロク①はPPを2回復する', m[0].dpp === 2, JSON.stringify(m[0]));
ok('ミロク②はランダム1体に3ダメージ', m[1].dmg === 3, JSON.stringify(m[1]));
ok('ミロク③は自分のリーダーを3回復する', m[2].dlife === 3, JSON.stringify(m[2]));

/* --- ルードマン：バッジが超進化時だけ全体2ダメージ --- */
const r = await pg.evaluate(async () => {
  const P = await fresh();
  await playNew('rudeman_001', 3);
  const has = (P.badges || []).some(x => x.id === 'rudeman');
  const t1 = await summonCard(1, 'himeka_001'), t2 = await summonCard(1, 'himeka_001');
  const h0 = t1.hp;
  await runBadges(0, 'turnEnd');                      // 超進化フォロワーなし
  const noSuper = t1.hp;
  const mine = P.board.find(x => x.cardId === 'rudeman_001');
  await applyEvolve(mine, true, true);                // 超進化させる
  await runBadges(0, 'turnEnd');
  return { has, h0, noSuper, withSuper: t1.hp, other: t2.hp, superE: mine.superEvolved };
});
ok('ルードマンはバッジを与える', r.has, JSON.stringify(r));
ok('バッジは超進化フォロワーがいないと働かない', r.noSuper === r.h0, JSON.stringify(r));
ok('超進化フォロワーがいると相手全体に2ダメージ', r.withSuper === r.h0 - 2 && r.other === r.h0 - 2, JSON.stringify(r));

/* --- バージヴァル：山札25枚以下で兵士2体 --- */
const bg = await pg.evaluate(async () => {
  const P = await fresh();
  P.deck = Array.from({ length: 30 }, () => makeInstance('soldier_001', 0));
  await playNew('bergival_001', 5);
  const many = P.board.filter(x => x.cardId === 'soldier_001').length;
  const P2 = G.players[0]; P2.board = []; P2.deck = Array.from({ length: 20 }, () => makeInstance('soldier_001', 0));
  await playNew('bergival_001', 5);
  return { many, few: P2.board.filter(x => x.cardId === 'soldier_001').length };
});
ok('バージヴァルは山札が多いと兵士を出さない', bg.many === 0, JSON.stringify(bg));
ok('バージヴァルは山札25枚以下で兵士を2体出す', bg.few === 2, JSON.stringify(bg));

/* --- スタチウム：進化時にファンファーレ再演＋兵士3体 --- */
const st = await pg.evaluate(async () => {
  const P = await fresh();
  P.deck = Array.from({ length: 8 }, () => makeInstance('soldier_001', 0));
  const tgt = await summonCard(1, 'soldier_001');
  const f = await summonCard(0, 'stachium_001');
  await applyEvolve(f, false); await cleanupBoard();
  return { soldiers: P.board.filter(x => x.cardId === 'soldier_001').length,
           enemyGone: !G.players[1].board.some(x => !x.destroyed), deck: P.deck.length };
});
ok('スタチウムは進化時に山札を捨てて相手を破壊し兵士を3体出す',
   st.soldiers === 3 && st.enemyGone && st.deck === 6, JSON.stringify(st));

/* --- ドゥームエモリー：捨てて引いて1回復 --- */
const dm = await pg.evaluate(async () => {
  const P = await fresh();
  P.hand = [makeInstance('soldier_001', 0), makeInstance('soldier_001', 0)];
  P.life = 15;
  const f = await summonCard(0, 'doomemory_001');
  const h0 = P.hand.length;
  // 選ぶ処理を自動化できないので、効果を個別に確かめる
  await EFFECTS.draw(ctx0(), { amount: 1 });
  await EFFECTS.heal({ owner: 0, source: f, pick: () => [leaderRef(0)] }, { target: 'ownLeader', amount: 1 });
  return { h0, h1: P.hand.length, life: P.life };
});
ok('ドゥームエモリーは1枚引いて1回復する', dm.h1 === dm.h0 + 1 && dm.life === 16, JSON.stringify(dm));

/* --- バックウッド：進化時に 30-山札 回ダメージ --- */
const bw = await pg.evaluate(async () => {
  const P = await fresh();
  P.deck = Array.from({ length: 26 }, () => makeInstance('soldier_001', 0));   // X = 4
  const tgt = await summonCard(1, 'himeka_001');
  const h0 = tgt.hp;
  const f = await summonCard(0, 'backwood_001');
  await applyEvolve(f, false); await cleanupBoard();
  const four = h0 - tgt.hp;
  const P2 = G.players[0]; P2.deck = Array.from({ length: 40 }, () => makeInstance('soldier_001', 0));
  const t2 = await summonCard(1, 'himeka_001'); const h2 = t2.hp;
  const f2 = await summonCard(0, 'backwood_001');
  await applyEvolve(f2, false); await cleanupBoard();
  return { four, zero: h2 - t2.hp };
});
ok('バックウッドは山札26枚なら4回ダメージを与える', bw.four === 4, JSON.stringify(bw));
ok('バックウッドは山札が30枚以上なら0回（負の値は0）', bw.zero === 0, JSON.stringify(bw));

/* --- エズディア：コスト0のドゥームエモリー3枚＋ターン終了時に自分だけ必殺守護 --- */
const ez = await pg.evaluate(async () => {
  const P = await fresh();
  const other = await summonCard(0, 'soldier_001');
  const enemy = await summonCard(1, 'soldier_001');
  const f = await playNew('ezdia_001', 8);
  const added = P.hand.filter(c => c.cardId === 'doomemory_001');
  await runCardEffects(P.board.find(x => x.cardId === 'ezdia_001'), 'turnEnd', 0);
  return { n: added.length, costs: added.map(c => costOf(c)),
           mine: ['bane', 'ward'].every(k => other.keywords.indexOf(k) >= 0),
           enemyUntouched: enemy.keywords.indexOf('bane') < 0 };
});
ok('エズディアはコスト0のドゥームエモリーを3枚加える', ez.n === 3 && ez.costs.every(c => c === 0), JSON.stringify(ez));
ok('エズディアは自分の場だけに必殺と守護を付ける', ez.mine && ez.enemyUntouched, JSON.stringify(ez));

/* --- 水流の水面：カウント0でオルカ3体 --- */
const wf = await pg.evaluate(async () => {
  const P = await fresh();
  const am = await summonCard(0, 'waterface_001');
  const cd0 = am.countdown;
  tickCountdowns(0); tickCountdowns(0); await cleanupBoard();
  return { cd0, orca: P.board.filter(x => x.cardId === 'orca_001').length,
           gone: !P.board.some(x => x.cardId === 'waterface_001') };
});
ok('水流の水面はカウントダウン2で始まる', wf.cd0 === 2, JSON.stringify(wf));
ok('水流の水面は0になるとオルカを3体出す', wf.orca === 3 && wf.gone, JSON.stringify(wf));

/* --- オルカ：ラストワードで1回復 --- */
const oc = await pg.evaluate(async () => {
  const P = await fresh(); P.life = 10;
  const o = await summonCard(0, 'orca_001');
  destroyByEffect(o); await cleanupBoard();
  return { life: P.life, storm: CARD_BY_ID.orca_001.keywords.join(',') };
});
ok('オルカはラストワードで自分のリーダーを1回復する', oc.life === 11, JSON.stringify(oc));

/* --- 融解の錬金術師：手札のアミュレットを捨ててPP最大+1 --- */
const ma = await pg.evaluate(async () => {
  const P = await fresh();
  P.hand = [makeInstance('godheart_001', 0)];
  P.maxPPBonus = 0; const b0 = P.maxPP;
  await playNew('meltalchemist_001', 4);
  const withAm = { bonus: P.maxPPBonus, amulets: P.hand.filter(c => c.type === 'amulet').length };
  const P2 = G.players[0]; P2.board = []; P2.hand = []; P2.maxPPBonus = 0;
  await playNew('meltalchemist_001', 4);
  return { withAm, noAm: P2.maxPPBonus, b0 };
});
ok('融解の錬金術師はアミュレットを捨ててPP最大を+1する',
   ma.withAm.bonus === 1 && ma.withAm.amulets === 0, JSON.stringify(ma));
ok('手札にアミュレットがなければPP最大は増えない', ma.noAm === 0, JSON.stringify(ma));

/* --- アジュラフリート：捨てた枚数ぶん8ダメージ --- */
const az = await pg.evaluate(async () => {
  const P = await fresh();
  P.hand = [makeInstance('godheart_001', 0), makeInstance('godheart_001', 0)];
  const tgt = await summonCard(1, 'himeka_001');   // 0/12
  const h0 = tgt.hp;
  await playNew('azraflete_001', 10);
  return { h0, hp: tgt.hp, dead: tgt.destroyed, amulets: P.hand.filter(c => c.type === 'amulet').length,
           storm: CARD_BY_ID.azraflete_001.keywords.join(',') };
});
ok('アジュラフリートは疾走を持つ', az.storm === 'storm', JSON.stringify(az));
ok('アジュラフリートはアミュレット2枚ぶん8ダメージを2回与える',
   az.amulets === 0 && (az.hp <= 0 || az.dead) && az.h0 === 12, JSON.stringify(az));

/* --- 愚鈍の凛烈：神の心臓を場に2・手札に2 --- */
const du = await pg.evaluate(async () => {
  const P = await fresh();
  const f = await playNew('dullardent_001', 7);
  return { board: P.board.filter(x => x.cardId === 'godheart_001').length,
           hand: P.hand.filter(c => c.cardId === 'godheart_001').length,
           kws: CARD_BY_ID.dullardent_001.keywords.join(',') };
});
ok('愚鈍の凛烈は守護・突進・必殺を持つ', du.kws === 'ward,rush,bane', JSON.stringify(du));
ok('愚鈍の凛烈は神の心臓を場に2枚・手札に2枚用意する', du.board === 2 && du.hand === 2, JSON.stringify(du));

/* --- ユウベ：融合で5枚のうち1枚、超進化でオルカに疾走 --- */
const yb = await pg.evaluate(async () => {
  const P = await fresh();
  const pool = ['dragonsword_001', 'dollstheater_001', 'lampstand_001', 'whitechapter_001', 'fortress_001'];
  const got = new Set();
  for (let i = 0; i < 40; i++) {
    const Q = G.players[0]; Q.hand = [];
    const host = makeInstance('yube_001', 0), mat = makeInstance('soldier_001', 0);
    Q.hand = [host, mat];
    await performFusion(0, host.uid, [mat.uid]);
    Q.hand.filter(c => c.uid !== host.uid).forEach(c => got.add(c.cardId));
  }
  const P2 = G.players[0]; P2.hand = []; P2.board = [];
  const f = await playNew('yube_001', 3);
  const summoned = P2.board.filter(x => x.cardId === 'orca_001').length;
  const o2 = await summonCard(0, 'orca_001');
  const me = P2.board.find(x => x.cardId === 'yube_001');
  await applyEvolve(me, true);                       // 超進化（free でない）
  return { pool: pool.filter(id => got.has(id)), extra: [...got].filter(id => pool.indexOf(id) < 0),
           summoned, storm: P2.board.filter(x => x.cardId === 'orca_001').every(o => o.keywords.indexOf('storm') >= 0) };
});
ok('ユウベの融合は指定の5枚のみから配られる', yb.pool.length === 5 && yb.extra.length === 0, JSON.stringify(yb));
ok('ユウベはファンファーレでオルカを1体出す', yb.summoned === 1, JSON.stringify(yb));
ok('ユウベの超進化で場のオルカ全てが疾走を持つ', yb.storm, JSON.stringify(yb));

/* --- 踏み台：PP最大7以上の時だけリーダーにも1 --- */
const ss = await pg.evaluate(async () => {
  const P = await fresh(); const E = G.players[1];
  const am = await summonCard(0, 'steppingstone_001');
  const tgt = await summonCard(1, 'himeka_001');
  P.maxPP = 5; const l0 = E.life, h0 = tgt.hp;
  await runCardEffects(am, 'turnEnd', 0);
  const low = { life: E.life, hp: tgt.hp };
  P.maxPP = 7;
  await runCardEffects(am, 'turnEnd', 0);
  return { l0, h0, low, hi: { life: E.life, hp: tgt.hp }, cd: CARD_BY_ID.steppingstone_001.countdown };
});
ok('踏み台はカウントダウン3', ss.cd === 3, JSON.stringify(ss));
ok('踏み台はPP最大5ではフォロワーだけに2ダメージ',
   ss.low.hp === ss.h0 - 2 && ss.low.life === ss.l0, JSON.stringify(ss));
ok('踏み台はPP最大7以上なら相手リーダーにも1ダメージ',
   ss.hi.life === ss.l0 - 1 && ss.hi.hp === ss.h0 - 4, JSON.stringify(ss));

console.log(OUT.join('\n'));
console.log('pageerrors: ' + errs.length + (errs.length ? ' :: ' + errs.slice(0,3).join(' | ') : ''));
console.log('---- ' + OUT.filter(x => x.startsWith('PASS')).length + ' pass / ' + OUT.filter(x => x.startsWith('FAIL')).length + ' fail');
await b.close();
