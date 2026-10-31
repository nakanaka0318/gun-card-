/* ver9 後半（ドミニオン・アルカナ・マキナ）の挙動 */
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
await pg.evaluate(() => {
  window.fresh = async (deck, cls) => {
    startGame({ p1: { deck: deck || { soldier_001: 40 }, cls: cls || 'dominion', name: 'A' },
                p2: { deck: { soldier_001: 40 }, cls: 'accel', name: 'B' }, timer: 0, first: 'p1' });
    G.sim = true; G.phase = 'play'; G.active = 0; await beginTurn();
    const P = G.players[0]; P.pp = 10; P.maxPP = 10; Sfx.on = false; Bgm.on = false; P.hand = [];
    return P;
  };
  window.ctx0 = src => ({ owner: 0, source: src || null,
    pick: (sel, pr) => resolveTargets(sel || 'self', 0, src || null, pr || {}) });
});

/* ========== ドミニオン：財布 ========== */
const w1 = await pg.evaluate(async () => {
  const P = await fresh();
  const w = makeInstance('wallet_001', 0); P.hand.push(w);
  const start = w.x;
  /* 融合でレアリティぶん購入値が増える */
  const mats = ['satan_001', 'soldier_001'].map(i => makeInstance(i, 0));  // レジェンド+4 / ブロンズ+1
  mats.forEach(m => P.hand.push(m));
  await performFusion(0, w.uid, mats.map(m => m.uid));
  return { start, after: w.x, rar: mats.map(m => CARD_BY_ID[m.cardId].rarity) };
});
ok('財布は購入値0から始まる', w1.start === 0, String(w1.start));
ok('融合でレアリティぶん購入値が増える（レジェンド+4・ブロンズ+1）',
   w1.after === 5, JSON.stringify(w1));

const w2 = await pg.evaluate(async () => {
  const P = await fresh({ soldier_001: 20, mage_001: 10, satan_001: 5, wallet_001: 5 });
  const w = makeInstance('wallet_001', 0); w.x = 7; P.hand.push(w);
  const before = { hand: P.hand.length, src: (P.srcIds || []).length };
  /* ④ レジェンドを1枚（-7、コスト-2） */
  const c = ctx0(w);
  await EFFECTS.buyValueSpend(c, { amount: 7, then: [
    { type: 'addFromDeckList', params: { rarity: 'legend', costMod: -2 } }] });
  const got = P.hand[P.hand.length - 1];
  return { before, x: w.x, got: got.name, rar: CARD_BY_ID[got.cardId].rarity,
           cost: costOf(got), base: CARD_BY_ID[got.cardId].cost,
           srcHasWallet: (P.srcIds || []).indexOf('wallet_001') >= 0 };
});
ok('組んだ40枚の構成を覚えている', w2.before.src === 40, JSON.stringify(w2.before));
ok('購入値7でレジェンドを1枚、コストは-2される',
   w2.x === 0 && w2.rar === 'legend' && w2.cost === w2.base - 2, JSON.stringify(w2));
ok('財布そのものは引き替えの候補に出ない（デッキに入っていても）',
   w2.srcHasWallet && w2.got !== '財布', JSON.stringify({ got: w2.got }));

const w3 = await pg.evaluate(async () => {
  const P = await fresh();
  const w = makeInstance('wallet_001', 0); w.x = 3; P.hand.push(w);
  const before = P.hand.length;
  await EFFECTS.keepSelfInHand(ctx0(w), {});
  const kept = P.hand[P.hand.length - 1];
  /* 購入値が足りない時は何も起きない */
  const w2 = makeInstance('wallet_001', 0); w2.x = 1;
  let fired = false;
  await EFFECTS.buyValueSpend({ owner: 0, source: w2, pick: () => [] },
    { amount: 5, then: [{ type: 'draw', params: { amount: 1 } }] });
  return { before, after: P.hand.length, keptX: kept.x, keptId: kept.cardId, lowX: w2.x };
});
ok('財布はプレイしても同じ購入値で手札に残る',
   w3.after === w3.before + 1 && w3.keptId === 'wallet_001' && w3.keptX === 3, JSON.stringify(w3));
ok('購入値が足りない時は払われない', w3.lowX === 1, JSON.stringify(w3));

const w4 = await pg.evaluate(async () => {
  const P = await fresh();
  P.turnCount = 1;
  /* 初手の引きに左右されないよう、山札を直接組む */
  P.deck = [makeInstance('wallet_001', 0), makeInstance('wallet_001', 0),
            makeInstance('wallet_001', 0), makeInstance('soldier_001', 0)];
  const inDeck = P.deck.filter(c => c.cardId === 'wallet_001').length;
  const src = P.deck.find(c => c.cardId === 'wallet_001');
  await runCardEffects(src, 'deckTurnStart', 0);
  return { inDeck, hand: P.hand.filter(c => c.cardId === 'wallet_001').length,
           left: P.deck.filter(c => c.cardId === 'wallet_001').length,
           grave: P.grave.filter(c => c.cardId === 'wallet_001').length };
});
ok('ターン1に財布を1枚引き、山札の残りは捨てて1枚にする',
   w4.inDeck === 3 && w4.hand === 1 && w4.left === 0 && w4.grave === 2, JSON.stringify(w4));

/* ========== ドミニオン：その他 ========== */
const d1 = await pg.evaluate(async () => {
  const P = await fresh();
  const w = makeInstance('wallet_001', 0); w.x = 0; P.hand.push(w);
  const f = await summonCard(0, 'goldwork_001');
  await runCardEffects(f, 'turnEnd', 0);
  const afterTurn = w.x;
  await applyEvolve(f, false);
  return { afterTurn, afterEvolve: w.x, kw: CARD_BY_ID.goldwork_001.keywords };
});
ok('金塊の工夫はターン終了時に購入値+2、進化時にも+2',
   d1.afterTurn === 2 && d1.afterEvolve === 4 && d1.kw.indexOf('ward') >= 0, JSON.stringify(d1));

const d2 = await pg.evaluate(async () => {
  const P = await fresh();
  const w = makeInstance('wallet_001', 0); P.hand.push(w);
  await summonCard(0, 'satan_001');                       // 場にレジェンド
  const f1 = await summonCard(0, 'merchant_001');
  await runCardEffects(f1, 'fanfare', 0);
  const withLegend = w.x;
  const P2 = G.players[0]; P2.board = P2.board.filter(x => x.cardId !== 'satan_001');
  w.x = 0;
  const f2 = await summonCard(0, 'merchant_001');
  await runCardEffects(f2, 'fanfare', 0);
  return { withLegend, without: w.x };
});
ok('交易の商人は場にレジェンドがある時だけ購入値+5',
   d2.withLegend === 5 && d2.without === 0, JSON.stringify(d2));

const d3 = await pg.evaluate(async () => {
  const P = await fresh();
  const big = await summonCard(1, 'himeka_001');          // 0/12
  const small = await summonCard(1, 'soldier_001');       // 2/2
  const f = await summonCard(0, 'mukan_001');
  await applyEvolve(f, false); await cleanupBoard();
  return { bigGone: big.destroyed || !G.players[1].board.includes(big),
           smallAlive: G.players[1].board.some(x => x.uid === small.uid && !x.destroyed) };
});
ok('ムカンは進化時に体力が最も高い相手を破壊する', d3.bigGone && d3.smallAlive, JSON.stringify(d3));

const d4 = await pg.evaluate(async () => {
  const P = await fresh();
  const w = makeInstance('wallet_001', 0); w.x = 5; P.hand.push(w);
  P.pp = 3;
  const f = await summonCard(0, 'edelweiss_001');
  await runCardEffects(f, 'fanfare', 0);
  return { x: w.x, evolved: f.evolved, atk: f.attack, pp: P.pp, hand: P.hand.length };
});
ok('エーデルワイスは購入値-2できたら進化し、PPを2回復して1枚引く',
   d4.x === 3 && d4.evolved === true && d4.atk === 4 && d4.pp === 5, JSON.stringify(d4));

const d5 = await pg.evaluate(async () => {
  const P = await fresh();
  const counts = [];
  for (let i = 0; i < 3; i++) {
    P.board = []; P.hand = []; P.pp = 10;
    const c = makeInstance('lulunai_001', 0); P.hand.push(c);
    G.active = 0; await playCard(c.uid);
    counts.push({ entered: P.cardEnterCounts.lulunai_001, board: P.board.filter(x => x.cardId === 'lulunai_001').length });
  }
  const E = G.players[1];
  return { counts, life: E.life, kw: CARD_BY_ID.lulunai_001.keywords };
});
ok('ルルナイは累計で場に出た数ぶん追加で出る（場の上限5まで）',
   d5.counts[0].board >= 1 && d5.counts[1].board > d5.counts[0].board, JSON.stringify(d5.counts));
const d5b = await pg.evaluate(async () => {
  const P = await fresh();
  /* X はファンファーレの時点での累計。5体ぶん（＋自分で6）になるよう仕込む */
  P.cardEnterCounts = { lulunai_001: 5 };   // 自分を足して X=6
  const E = G.players[1]; const l0 = E.life;
  const c = makeInstance('lulunai_001', 0); P.hand.push(c);
  G.active = 0; P.pp = 10; await playCard(c.uid);
  const x6 = { x: P.cardEnterCounts.lulunai_001, life: E.life };
  /* 5以下なら撃たない */
  const P2 = await fresh();
  P2.cardEnterCounts = { lulunai_001: 2 };  // 自分を足して X=3
  const E2 = G.players[1]; const l2 = E2.life;
  const c2 = makeInstance('lulunai_001', 0); P2.hand.push(c2);
  G.active = 0; P2.pp = 10; await playCard(c2.uid);
  return { l0, x6, l2, lifeLow: E2.life };
});
ok('ルルナイはXが6以上なら相手リーダーに4ダメージ', d5b.x6.life === d5b.l0 - 4, JSON.stringify(d5b.x6));
ok('Xが6未満なら撃たない', d5b.lifeLow === d5b.l2, JSON.stringify(d5b));

const d6 = await pg.evaluate(async () => {
  const P = await fresh(); const E = G.players[1];
  const w = makeInstance('wallet_001', 0); P.hand.push(w);
  const l0 = [P.life, E.life];
  const f = await summonCard(0, 'varnalek_001');
  await runCardEffects(f, 'fanfare', 0);
  const h0 = P.hand.length;
  await applyEvolve(f, false);
  const h1 = P.hand.length;
  await applyEvolve(f, true);
  return { l0, l1: [P.life, E.life], x: w.x, h0, h1, badge: P.badges.some(x => x.id === 'loveright'),
           kw: CARD_BY_ID.varnalek_001.keywords };
});
ok('ヴァーナレクは双方のリーダーに1ダメージ、購入値+1、疾走持ち',
   d6.l1[0] === d6.l0[0] - 1 && d6.l1[1] === d6.l0[1] - 1 && d6.x === 1 && d6.kw.indexOf('storm') >= 0, JSON.stringify(d6));
ok('ヴァーナレクは進化で自分を1枚手札に、超進化でバッジ',
   d6.h1 === d6.h0 + 1 && d6.badge, JSON.stringify(d6));

const d7 = await pg.evaluate(async () => {
  const P = await fresh();
  const f = await summonCard(0, 'troy_001');
  const h0 = P.hand.length;
  destroyByEffect(f); await cleanupBoard();
  return { h0, h1: P.hand.length, names: P.hand.map(c => c.cardId) };
});
ok('トロイはラストワードで自分を2枚手札に加える',
   d7.h1 === d7.h0 + 2 && d7.names.filter(x => x === 'troy_001').length === 2, JSON.stringify(d7));

const d8 = await pg.evaluate(async () => {
  const P = await fresh();
  const w = makeInstance('wallet_001', 0); w.x = 0; P.hand.push(w);
  const am = await summonCard(0, 'stock_001');
  const cd = am.countdown;
  tickCountdowns(0); tickCountdowns(0); await cleanupBoard();
  return { cd, x: w.x, gone: !P.board.some(c => c.cardId === 'stock_001') };
});
ok('株はカウント2で消え、購入値を+4〜+18増やす',
   d8.cd === 2 && d8.gone && d8.x >= 4 && d8.x <= 18, JSON.stringify(d8));

const d9 = await pg.evaluate(async () => {
  const P = await fresh();
  await summonCard(0, 'soldier_001'); await summonCard(1, 'soldier_001');
  const f = await summonCard(0, 'okuribito_001');
  await runCardEffects(f, 'fanfare', 0); await cleanupBoard();
  return { mine: P.board.filter(x => !x.destroyed).map(x => x.cardId),
           enemy: G.players[1].board.filter(x => !x.destroyed).length,
           kw: CARD_BY_ID.okuribito_001.keywords, atk: CARD_BY_ID.okuribito_001.attack };
});
ok('億り人は20/20で威圧と覇気を持つ',
   d9.atk === 20 && d9.kw.join(',') === 'intimidate,aura', JSON.stringify(d9.kw));
ok('億り人は場のフォロワーを全て壊してゴブリンを4体出す',
   d9.enemy === 0 && d9.mine.filter(x => x === 'goblin_001').length === 4, JSON.stringify(d9));

/* ========== アルカナ：そのターン攻撃していない ========== */
const a1 = await pg.evaluate(async () => {
  const P = await fresh(undefined, 'arcana');
  P.life = 10;
  const f = await summonCard(0, 'restwarrior_001');
  await runCardEffects(f, 'fanfare', 0);
  const has = P.badges.some(x => x.id === 'restwarrior');
  /* 攻撃していない → 回復する */
  P.attackedThisTurn = false;
  await runBadges(0, 'turnEnd');
  const noAtk = P.life;
  /* 攻撃した → 回復しない */
  P.attackedThisTurn = true;
  await runBadges(0, 'turnEnd');
  return { has, noAtk, afterAtk: P.life };
});
ok('安息の武者はバッジを与える', a1.has, JSON.stringify(a1));
ok('攻撃していないターンだけリーダーを2回復する',
   a1.noAtk === 12 && a1.afterAtk === 12, JSON.stringify(a1));

const a2 = await pg.evaluate(async () => {
  const P = await fresh(undefined, 'arcana');
  const e1 = await summonCard(1, 'himeka_001');
  const h0 = e1.hp;
  const f = await summonCard(0, 'restprayer_001');
  await runCardEffects(f, 'fanfare', 0);
  const dmg = h0 - e1.hp;
  await applyEvolve(f, false);
  return { dmg, badge: P.badges.some(x => x.id === 'restprayer') };
});
ok('安息の祈祷者は相手全体に3ダメージ、進化でバッジ', a2.dmg === 3 && a2.badge, JSON.stringify(a2));

const a3 = await pg.evaluate(async () => {
  const P = await fresh(undefined, 'arcana');
  await summonCard(1, 'soldier_001');
  grantBadge(0, 'restwarrior');
  const before = P.badges[0].turnsLeft;
  const f = await summonCard(0, 'ronavero_001');
  const e0 = G.players[1].board.filter(x => !x.destroyed).length;
  await applyEvolve(f, false); await cleanupBoard();
  return { before, after: P.badges[0].turnsLeft, killed: e0 - G.players[1].board.filter(x => !x.destroyed).length,
           kw: CARD_BY_ID.ronavero_001.keywords };
});
ok('ロナヴェロは覇気を持つ', a3.kw.join(',') === 'aura', JSON.stringify(a3.kw));
ok('ロナヴェロは進化でファンファーレ再演＋バッジの持続+1',
   a3.killed >= 1 && a3.after === a3.before + 1, JSON.stringify(a3));

const a4 = await pg.evaluate(async () => {
  const P = await fresh(undefined, 'arcana');
  const e = await summonCard(1, 'soldier_001');
  const f = await summonCard(0, 'marwin_001');
  await runCardEffects(f, 'fanfare', 0); await cleanupBoard();
  const banished = !G.players[1].board.some(x => x.uid === e.uid);
  const graveHas = G.players[1].grave.some(x => x.uid === e.uid);
  await applyEvolve(f, false);
  /* バッジ：攻撃していなければ、バッジの数ぶんランダムに1ダメージ */
  P.attackedThisTurn = false;
  const E = G.players[1]; const before = E.life + E.board.reduce((a, x) => a + x.hp, 0);
  await runBadges(0, 'turnEnd');
  const after = E.life + E.board.reduce((a, x) => a + x.hp, 0);
  return { banished, graveHas, badge: P.badges.some(x => x.id === 'despairform'),
           n: P.badges.length, dealt: before - after };
});
ok('マーウィンは相手を消滅させる（墓場に行かない）', a4.banished && !a4.graveHas, JSON.stringify(a4));
ok('絶望の顕現はバッジの数ぶんダメージを与える',
   a4.badge && a4.dealt === a4.n, JSON.stringify(a4));

const a5 = await pg.evaluate(async () => {
  const P = await fresh(undefined, 'arcana');
  const e1 = await summonCard(1, 'himeka_001'); const h0 = e1.hp;
  P.pp = 4;
  const c1 = makeInstance('saintflash_001', 0); P.hand.push(c1);
  const low = { cost: costOf(c1), grown: grownNow(c1) };
  G.active = 0; await playCard(c1.uid);
  low.dmg = h0 - e1.hp;
  const h1 = e1.hp; G.players[0].pp = 7;
  const c2 = makeInstance('saintflash_001', 0); G.players[0].hand.push(c2);
  const hi = { cost: costOf(c2), grown: grownNow(c2) };
  await playCard(c2.uid);
  hi.dmg = h1 - e1.hp;
  return { low, hi };
});
ok('セイントフラッシュは通常3ダメージ（コスト4）',
   a5.low.cost === 4 && a5.low.grown === false && a5.low.dmg === 3, JSON.stringify(a5.low));
ok('成長7なら7ダメージ（コスト7）',
   a5.hi.cost === 7 && a5.hi.grown === true && a5.hi.dmg === 7, JSON.stringify(a5.hi));

const a6 = await pg.evaluate(async () => {
  const P = await fresh(undefined, 'arcana');
  P.life = 5; P.pp = 2;
  const c = makeInstance('maddance_001', 0); P.hand.push(c);
  G.active = 0; await playCard(c.uid);
  const healed = P.life;
  const has = P.badges.some(x => x.id === 'maddance');
  for (let i = 0; i < 2; i++) await tickBadges(0);
  return { healed, has, after: P.life, still: P.badges.some(x => x.id === 'maddance') };
});
ok('狂いの踊りは10回復してバッジを持つ', a6.healed === 15 && a6.has, JSON.stringify(a6));
ok('バッジが切れると自分のリーダーに10ダメージ',
   a6.still === false && a6.after === a6.healed - 10, JSON.stringify(a6));

const a7 = await pg.evaluate(async () => {
  const P = await fresh(undefined, 'arcana');
  const e = await summonCard(1, 'himeka_001'); const h0 = e.hp;
  P.pp = 0;
  const f = await summonCard(0, 'medalist_001');
  await runCardEffects(f, 'fanfare', 0);
  const pp = P.pp;
  P.pp = 2;
  await runCardEffects(f, 'turnEnd', 0);
  return { pp, dealt: h0 - e.hp };
});
ok('勲章の装着士はPPを4回復する', a7.pp === 4, JSON.stringify(a7));
ok('ターン終了時、あまったPPの数ぶん3ダメージを繰り返す', a7.dealt === 6, JSON.stringify(a7));

const a8 = await pg.evaluate(async () => {
  const P = await fresh(undefined, 'arcana');
  const c = makeInstance('ara_001', 0); P.hand.push(c);
  const base = costOf(c);
  await runHandHook('handSpellPlayed', 0, {});
  await runHandHook('handSpellPlayed', 0, {});
  return { base, after: costOf(c) };
});
ok('アラは自分がスペルを使うたびコストが-1される',
   a8.base === 8 && a8.after === 6, JSON.stringify(a8));

/* ========== マキナ：共鳴 ========== */
const m1 = await pg.evaluate(() => {
  const P = G.players[0];
  const set = n => { P.deck = Array.from({ length: n }, () => makeInstance('soldier_001', 0)); };
  const probe = () => condOK({ resonance: true }, { owner: 0 }, { owner: 0 });
  const probeNot = () => condOK({ notResonance: true }, { owner: 0 }, { owner: 0 });
  set(10); const even = [probe(), probeNot()];
  set(9);  const odd = [probe(), probeNot()];
  set(0);  const zero = [probe(), probeNot()];
  return { even, odd, zero };
});
ok('共鳴は山札が偶数のときだけ成り立つ',
   m1.even.join() === 'true,false' && m1.odd.join() === 'false,true', JSON.stringify(m1));
ok('山札0枚も偶数として共鳴する', m1.zero.join() === 'true,false', JSON.stringify(m1.zero));

const m2 = await pg.evaluate(async () => {
  const out = {};
  for (const n of [10, 9]) {
    const P = await fresh(undefined, 'machina');
    P.deck = Array.from({ length: n }, () => makeInstance('soldier_001', 0));
    const e = await summonCard(1, 'himeka_001'); const h0 = e.hp;
    const f = await summonCard(0, 'evenbolt_001');
    await runCardEffects(f, 'fanfare', 0);
    out[n % 2 === 0 ? 'even' : 'odd'] = { rush: f.keywords.indexOf('rush') >= 0, dmg: h0 - e.hp, hand: P.hand.length };
  }
  return out;
});
ok('偶数の弾芯は共鳴時だけ突進と2ダメージを得る',
   m2.even.rush && m2.even.dmg === 2 && !m2.odd.rush && m2.odd.dmg === 0, JSON.stringify(m2));
ok('共鳴していなくても1枚引く部分は働く',
   m2.even.hand >= 1 && m2.odd.hand >= 1, JSON.stringify(m2));

const m3 = await pg.evaluate(async () => {
  const out = {};
  for (const n of [10, 9]) {
    const P = await fresh(undefined, 'machina');
    P.deck = Array.from({ length: n }, () => makeInstance('soldier_001', 0));
    const e1 = await summonCard(1, 'himeka_001'), e2 = await summonCard(1, 'himeka_001');
    const h = [e1.hp, e2.hp];
    const f = await summonCard(0, 'twinbarrel_001');
    await runCardEffects(f, 'fanfare', 0);
    out[n % 2 === 0 ? 'even' : 'odd'] = { d1: h[0] - e1.hp, d2: h[1] - e2.hp };
  }
  return out;
});
ok('双胴の連装砲は共鳴時だけ全体2ダメージ（通常はランダム1体）',
   m3.even.d1 === 2 && m3.even.d2 === 2 && (m3.odd.d1 + m3.odd.d2) === 2, JSON.stringify(m3));

const m4 = await pg.evaluate(async () => {
  const out = {};
  for (const n of [10, 9]) {
    const P = await fresh(undefined, 'machina');
    P.deck = Array.from({ length: n }, () => makeInstance('soldier_001', 0));
    /* 3ダメージでは死なない相手にして、破壊と3ダメージを見分ける */
    const e1 = await summonCard(1, 'himeka_001'), e2 = await summonCard(1, 'himeka_001');
    const h = [e1.hp, e2.hp];
    const hand0 = P.hand.length;
    const f = await summonCard(0, 'raio_001');
    await runCardEffects(f, 'fanfare', 0); await cleanupBoard();
    out[n % 2 === 0 ? 'even' : 'odd'] = { alive: G.players[1].board.filter(x => !x.destroyed).length,
      dmg: h[0] - e1.hp, drew: P.hand.length - hand0 };
  }
  return out;
});
ok('ライオは共鳴時に相手のフォロワーを全て破壊する',
   m4.even.alive === 0, JSON.stringify(m4));
ok('共鳴していないときは全体3ダメージと1ドローに変わる',
   m4.odd.alive === 2 && m4.odd.dmg === 3 && m4.odd.drew === 1, JSON.stringify(m4));

const m5 = await pg.evaluate(async () => {
  const P = await fresh(undefined, 'machina');
  P.deck = Array.from({ length: 10 }, () => makeInstance('soldier_001', 0));
  P.pp = 0;
  const f = await summonCard(0, 'unkei_001');
  await runCardEffects(f, 'fanfare', 0);
  const even = { arts: P.board.filter(x => x.cardId === 'artifact_001').length, pp: P.pp };
  const c = makeInstance('unkei_001', 0); P.hand = [c];
  const base = costOf(c);
  await runHandHook('handAllySummon', 0, {});
  return { even, base, afterSummon: costOf(c) };
});
ok('ウンケイは共鳴時にアーティファクト2体とPP2回復',
   m5.even.arts === 2 && m5.even.pp === 2, JSON.stringify(m5.even));
ok('ウンケイは自分の場にフォロワーが出るたびコスト-1',
   m5.base === 4 && m5.afterSummon === 3, JSON.stringify(m5));

const m6 = await pg.evaluate(async () => {
  const P = await fresh(undefined, 'machina');
  P.deck = Array.from({ length: 11 }, () => makeInstance('soldier_001', 0));
  const f = await summonCard(0, 'tuningdoll_001');
  const before = P.deck.length;
  await runCardEffects(f, 'turnStart', 0);
  return { before, after: P.deck.length, life: P.life };
});
ok('調律の歯車人形は山札を1枚捨てて偶数奇数を入れ替えられる',
   m6.after === m6.before - 1, JSON.stringify(m6));

const m7 = await pg.evaluate(async () => {
  const P = await fresh(undefined, 'machina');
  P.deck = Array.from({ length: 10 }, () => makeInstance('soldier_001', 0));
  await summonCard(1, 'himeka_001');
  const f = await summonCard(0, 'raio_001');
  await applyEvolve(f, true, true);
  await runCardEffects(f, 'superEvolve', 0);
  const has = P.badges.some(x => x.id === 'eternalres');
  const e = G.players[1].board[0]; const h0 = e.hp;
  await runBadges(0, 'turnStart');
  return { has, dmg: h0 - e.hp };
});
ok('ライオの超進化でバッジ「絶尽の共鳴」を持ち、共鳴時に全体2ダメージ',
   m7.has && m7.dmg === 2, JSON.stringify(m7));

console.log(OUT.join('\n'));
console.log('pageerrors: ' + errs.length + (errs.length ? ' :: ' + errs.slice(0, 3).join(' | ') : ''));
console.log('---- ' + OUT.filter(x => x.startsWith('PASS')).length + ' pass / ' + OUT.filter(x => x.startsWith('FAIL')).length + ' fail');
await b.close();
