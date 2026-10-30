/* ver9 の新しい仕組み（山札で捨てる・エンハンス・融合:カード・デッキ切れ勝利）の挙動 */
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
const pg = await b.newPage({ viewport: { width: 412, height: 892 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/*fonts.g*.com/**', r => r.abort());
await pg.goto(URL); await pg.waitForTimeout(900);

await pg.evaluate(() => {
  window.fresh = async (deck) => {
    startGame({ p1: { deck: deck || { soldier_001: 40 }, cls: 'formation', name: 'あなた' },
                p2: { deck: { soldier_001: 40 }, cls: 'accel', name: '相手' }, timer: 0, first: 'p1' });
    G.sim = true; G.phase = 'play'; G.active = 0; await beginTurn();
    const P = G.players[0]; P.pp = 10; P.maxPP = 10; Sfx.on = false;
    P.hand = [];
    return P;
  };
  window.playNew = async (id, pp) => {
    const P = G.players[0];
    if (pp != null) { P.pp = pp; P.maxPP = Math.max(P.maxPP, pp); }
    const c = makeInstance(id, 0); P.hand.push(c);
    G.active = 0;
    await playCard(c.uid);
    return c;
  };
});

/* --- トレント：山札から捨てられたら場に出る --- */
const t1 = await pg.evaluate(async () => {
  const P = await fresh();
  P.deck = [makeInstance('trent_001', 0), makeInstance('trent_001', 0), makeInstance('soldier_001', 0)];
  const before = P.board.length;
  await EFFECTS.discardDeck({ owner: 0, source: null, pick: () => [] }, { amount: 3 });
  return { board: P.board.filter(f => f.cardId === 'trent_001').length, deck: P.deck.length, before };
});
ok('トレントは山札から捨てられると場に出る', t1.board === 2 && t1.deck === 0, JSON.stringify(t1));

/* --- 手札から捨てても山札側の効果は働かない --- */
const t2 = await pg.evaluate(async () => {
  const P = await fresh();
  const c = makeInstance('trent_001', 0); P.hand.push(c);
  await discardCard(0, c);
  return { board: P.board.length, grave: P.grave.length };
});
ok('トレントは手札から捨てても場に出ない', t2.board === 0 && t2.grave === 1, JSON.stringify(t2));

/* --- 捨て札の喰らいの餓鬼：山札でも手札でも出る --- */
const t3 = await pg.evaluate(async () => {
  const P = await fresh();
  P.deck = [makeInstance('graveeater_001', 0)];
  await EFFECTS.discardDeck({ owner: 0, source: null, pick: () => [] }, { amount: 1 });
  const fromDeck = P.board.filter(f => f.cardId === 'graveeater_001').length;
  const h = makeInstance('graveeater_001', 0); P.hand.push(h);
  await discardCard(0, h);
  return { fromDeck, total: P.board.filter(f => f.cardId === 'graveeater_001').length };
});
ok('餓鬼は山札からも手札からも場に出る', t3.fromDeck === 1 && t3.total === 2, JSON.stringify(t3));

/* --- セントリーナイト：山札10枚以下なら相手リーダーに2 --- */
const t4 = await pg.evaluate(async () => {
  const P = await fresh(); const E = G.players[1];
  P.deck = Array.from({ length: 30 }, () => makeInstance('soldier_001', 0));
  const l0 = E.life; await playNew('sentryknight_001', 3);
  const big = E.life;
  const P2 = G.players[0]; P2.deck = Array.from({ length: 5 }, () => makeInstance('soldier_001', 0));
  P2.board = []; await playNew('sentryknight_001', 3);
  return { l0, afterBig: big, afterSmall: E.life, deck: P2.deck.length };
});
ok('セントリーナイトは山札が多い時はリーダーを殴らない', t4.afterBig === t4.l0, JSON.stringify(t4));
ok('セントリーナイトは山札10枚以下でリーダーに2ダメージ', t4.afterSmall === t4.afterBig - 2, JSON.stringify(t4));

/* --- エンハンス5：PPを5以上残して出した時だけ進化する --- */
const t5 = await pg.evaluate(async () => {
  const P = await fresh();
  await playNew('fildore_001', 4);                        // PP4 → エンハンス不成立
  const low = P.board[P.board.length - 1];
  const a = { evolved: low.evolved, at: low._enhanceAt };
  P.board = [];
  await playNew('fildore_001', 7);                        // PP7 → 成立
  const hi = P.board[P.board.length - 1];
  return { a, b: { evolved: hi.evolved, at: hi._enhanceAt, atk: hi.attack, hp: hi.hp } };
});
ok('エンハンス5はPP4では働かない', t5.a.evolved === false && t5.a.at === 4, JSON.stringify(t5.a));
ok('エンハンス5はPP7で働いて進化する', t5.b.evolved === true && t5.b.atk === 4 && t5.b.hp === 4, JSON.stringify(t5.b));

/* --- フィルドア：効果で進化しても「進化した時」は働く（onEvolve） --- */
const t6 = await pg.evaluate(async () => {
  const P = await fresh(); const E = G.players[1];
  await summonCard(1, 'soldier_001'); await summonCard(1, 'soldier_001');
  const n0 = E.board.length;
  await playNew('fildore_001', 7);
  await cleanupBoard();
  return { n0, n1: E.board.filter(f => !f.destroyed).length };
});
ok('フィルドアは効果進化でも相手を1体破壊する', t6.n1 === t6.n0 - 1, JSON.stringify(t6));

/* --- リュウフウ：PP最大7以上で進化し、進化時にPP最大+1 --- */
const t7 = await pg.evaluate(async () => {
  const P = await fresh();
  P.maxPP = 5; await playNew('ryufu_001', 5);
  const a = P.board[P.board.length - 1];
  const r1 = { evolved: a.evolved, maxPP: P.maxPP };
  P.board = []; P.maxPP = 7; P.maxPPBonus = 0;
  await playNew('ryufu_001', 7);
  const c = P.board[P.board.length - 1];
  return { r1, r2: { evolved: c.evolved, maxPP: P.maxPP, bonus: P.maxPPBonus } };
});
ok('リュウフウはPP最大5では進化しない', t7.r1.evolved === false && t7.r1.maxPP === 5, JSON.stringify(t7.r1));
ok('リュウフウはPP最大7で進化しPP最大が+1される', t7.r2.evolved === true && t7.r2.bonus === 1, JSON.stringify(t7.r2));

/* --- 融合:カード は手札のどれでも素材にできる --- */
const t8 = await pg.evaluate(async () => {
  const P = await fresh();
  const host = makeInstance('tokimeki_001', 0);
  const m1 = makeInstance('soldier_001', 0), m2 = makeInstance('godheart_001', 0);
  P.hand = [host, m1, m2];
  const can = [canFuseInto(CARD_BY_ID.tokimeki_001, m1), canFuseInto(CARD_BY_ID.tokimeki_001, m2)];
  const E = G.players[1]; const tgt = await summonCard(1, 'himeka_001');   // 0/12 なので2ダメージでは死なない
  const hp0 = tgt.hp; P.pp = 5;
  await performFusion(0, host.uid, [m1.uid, m2.uid]);
  return { can, fused: host.fusedCount, hand: P.hand.length, pp: P.pp, dmg: hp0 - tgt.hp, onBoard: P.board.length };
});
ok('融合:カード はフォロワーもアミュレットも素材にできる', t8.can[0] === true && t8.can[1] === true, JSON.stringify(t8.can));
ok('融合するとPPを1消費して2ダメージを与える', t8.pp === 4 && t8.dmg === 2, JSON.stringify(t8));
ok('融合しただけでは場に出ない', t8.onBoard === 0 && t8.fused === 2 && t8.hand === 1, JSON.stringify(t8));

/* --- 唯我の証明：引いたのが同名ならPP回復 --- */
const t9 = await pg.evaluate(async () => {
  const P = await fresh();
  P.deck = [makeInstance('solipsism_001', 0)]; P.pp = 3;
  await EFFECTS.drawThenIfId({ owner: 0, source: null, pick: () => [] },
    { cardId: 'solipsism_001', then: [{ type: 'refillPP', params: { amount: 1 } }] });
  const hit = P.pp;
  P.deck = [makeInstance('soldier_001', 0)]; P.pp = 3;
  await EFFECTS.drawThenIfId({ owner: 0, source: null, pick: () => [] },
    { cardId: 'solipsism_001', then: [{ type: 'refillPP', params: { amount: 1 } }] });
  return { hit, miss: P.pp };
});
ok('唯我の証明は同名を引いた時だけPPが回復する', t9.hit === 4 && t9.miss === 3, JSON.stringify(t9));

/* --- マゼルベイン：進化時に山札へ唯我の証明を10枚 --- */
const t10 = await pg.evaluate(async () => {
  const P = await fresh();
  await summonCard(1, 'soldier_001'); await summonCard(1, 'soldier_001'); await summonCard(1, 'soldier_001');
  const f = await summonCard(0, 'mazelbane_001');
  const d0 = P.deck.length, e0 = G.players[1].board.filter(x => !x.destroyed).length;
  await applyEvolve(f, false);                            // 進化ボタン相当（free でない）
  await cleanupBoard();
  return { added: P.deck.filter(c => c.cardId === 'solipsism_001').length, d0,
           killed: e0 - G.players[1].board.filter(x => !x.destroyed).length };
});
ok('マゼルベインは進化時に相手2体を破壊する', t10.killed === 2, JSON.stringify(t10));
ok('マゼルベインは進化時に唯我の証明を10枚山札へ加える', t10.added === 10, JSON.stringify(t10));

/* --- バッジ「空絶の顕現」：デッキ切れでも勝つ --- */
const t11 = await pg.evaluate(async () => {
  const P = await fresh();
  await playNew('octrice_001', 7);
  const hasB = (P.badges || []).some(x => x.id === 'voidend');
  P.deck = [];
  await drawCards(0, 1);
  return { hasB, phase: G.phase, winner: G.winner, me: P.idx };
});
ok('オクトリスはバッジ「空絶の顕現」を与える', t11.hasB, JSON.stringify(t11));
ok('空絶の顕現があればデッキ切れで勝利になる', t11.phase === 'over' && t11.winner === 0, JSON.stringify(t11));

/* --- バッジなしなら従来どおり敗北 --- */
const t12 = await pg.evaluate(async () => {
  const P = await fresh(); P.deck = [];
  await drawCards(0, 1);
  return { phase: G.phase, winner: G.winner };
});
ok('バッジがなければデッキ切れは敗北のまま', t12.phase === 'over' && t12.winner === 1, JSON.stringify(t12));

console.log(OUT.join('\n'));
console.log('pageerrors: ' + errs.length + (errs.length ? ' :: ' + errs.slice(0,3).join(' | ') : ''));
console.log('---- ' + OUT.filter(x => x.startsWith('PASS')).length + ' pass / ' + OUT.filter(x => x.startsWith('FAIL')).length + ' fail');
await b.close();
