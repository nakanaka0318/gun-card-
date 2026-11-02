/* 追加ルール（威圧・覇気はリーダー攻撃で失う）と、能力調整の反映 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
const URL = pathToFileURL(join(dirname(dirname(fileURLToPath(import.meta.url))), 'index.html')).href;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const OUT = [];
const ok = (n, c, d = '') => OUT.push((c ? 'PASS ' : 'FAIL ') + n + (d ? ' :: ' + d : ''));
const pg = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/*fonts.g*.com/**', r => r.abort());
await pg.goto(URL); await pg.waitForTimeout(900);

const r = await pg.evaluate(async () => {
  Sfx.on = false; Bgm.on = false;
  const setup = () => {
    startGame({ p1: { deck: { goblin_001: 40 }, cls: 'formation', name: 'A' },
                p2: { deck: { goblin_001: 40 }, cls: 'formation', name: 'B' }, timer: 0, first: 'p1' });
    G.sim = true; G.phase = 'play'; G.active = 0; G.players[0].pp = 10;
  };
  const put = (pIdx, id) => { const f = makeInstance(id, pIdx); G.players[pIdx].board.push(f);
    f.summonedThisTurn = false; f.attacksLeft = 1; return f; };
  const out = {};

  setup();
  let a = put(0, 'assassin_001');                 // 必殺・覇気・威圧
  out.before = a.keywords.slice();
  await doAttack(a, leaderRef(1));
  out.afterLeader = a.keywords.slice();
  out.logged = G.log.some(l => l.indexOf('失った') >= 0);

  setup();
  a = put(0, 'assassin_001');
  await doAttack(a, put(1, 'himeka_001'));        // 0/12 なので相打ちにならない
  out.afterFollower = a.keywords.slice();

  setup();
  const k = put(0, 'ronavero_001');               // 覇気のみ
  await doAttack(k, leaderRef(1));
  out.auraOnly = k.keywords.slice();

  setup();
  const w = put(0, 'kaito_001');                  // 守護・覇気
  await doAttack(w, leaderRef(1));
  out.kaito = w.keywords.slice();

  setup();
  const z = put(0, 'assassin_001');
  await doAttack(z, leaderRef(1));
  G.active = 1;
  out.targetable = attackTargets(put(1, 'goblin_001')).followers.indexOf(z.uid) >= 0;

  /* 威圧も覇気も持たないフォロワーは、リーダーを殴っても何も変わらない */
  setup();
  const g = put(0, 'goliath_001');                // 守護のみ
  await doAttack(g, leaderRef(1));
  out.plain = g.keywords.slice();

  return out;
});
ok('リーダーを攻撃すると威圧と覇気を失う',
   r.before.join() === 'bane,aura,intimidate' && r.afterLeader.join() === 'bane', JSON.stringify(r));
ok('必殺など他のキーワードは残る', r.afterLeader.indexOf('bane') >= 0, r.afterLeader.join());
ok('失ったことが記録に残る', r.logged === true, String(r.logged));
ok('フォロワーを攻撃した場合は失わない',
   r.afterFollower.join() === 'bane,aura,intimidate', r.afterFollower.join());
ok('覇気だけ持つフォロワーでも失う', r.auraOnly.length === 0, r.auraOnly.join());
ok('守護は巻き添えで消えない', r.kaito.join() === 'ward', r.kaito.join());
ok('失ったあとはフォロワーからの攻撃で選べるようになる', r.targetable === true, String(r.targetable));
ok('威圧も覇気も無いフォロワーは何も変わらない', r.plain.join() === 'ward', r.plain.join());

/* 用語の説明とルールブックに、この決まりが書いてあるか */
const doc = await pg.evaluate(() => {
  UI.go('rule');
  const txt = document.getElementById('sc-rule').textContent;
  return { kwAura: KEYWORDS.aura.desc, kwInt: KEYWORDS.intimidate.desc,
           rule: txt.indexOf('威圧と覇気は、相手のリーダーを攻撃した時点で失われる') >= 0 };
});
ok('覇気の説明に書いてある', doc.kwAura.indexOf('リーダーを攻撃すると失われる') >= 0, doc.kwAura);
ok('威圧の説明に書いてある', doc.kwInt.indexOf('リーダーを攻撃すると失われる') >= 0, doc.kwInt);
ok('ルールブックに書いてある', doc.rule, String(doc.rule));
ok('ページエラーなし', errs.length === 0, errs.join(' | '));

/* ---------- 能力調整：数字とキーワード ---------- */
const nums = await pg.evaluate(() => {
  const g = id => { const c = CARD_BY_ID[id];
    return { c: c.cost, a: c.attack, d: c.defense, kw: (c.keywords || []).join(','),
             gr: c.growth && c.growth.cost, cd: c.countdown }; };
  return {
    wilbert: g('wilbert_001'), goliath: g('goliath_001'), voralai: g('voralai_001'),
    ripefish: g('ripefish_001'), reargente: g('reargente_001'), sagatsumatsu: g('sagatsumatsu_001'),
    lowtoy: g('lowtoy_001'), morphei: g('morphei_001'), ortenia: g('ortenia_001'),
    holyscripture: g('holyscripture_001'), victoria: g('victoria_001'), nova: g('nova_001'),
    wimuel: g('wimuel_001'), lastdancer: g('lastdancer_001'),
    relievewolf: g('relievewolf_001'), saintstaff: g('saintstaff_001'), expstart: g('expstart_001'),
    axeStorm: /疾走/.test(CARD_BY_ID['axeabyss_001'].text),
    sagaBane: /必殺/.test(CARD_BY_ID['sagatsumatsu_001'].text),
    leiantose5: /5枚以上/.test(CARD_BY_ID['leiantose_001'].text),
    novaMinus2: /コストを-2/.test(CARD_BY_ID['nova_001'].text),
    lion2: /2回行う/.test(CARD_BY_ID['sleepinglion_001'].text)
  };
});
ok('ウィルバートが1/5', nums.wilbert.a === 1 && nums.wilbert.d === 5, JSON.stringify(nums.wilbert));
ok('激震のゴリアテが3/6', nums.goliath.a === 3 && nums.goliath.d === 6, JSON.stringify(nums.goliath));
ok('ヴォーラライが0/2', nums.voralai.a === 0 && nums.voralai.d === 2, JSON.stringify(nums.voralai));
ok('完熟の海魚が1/1', nums.ripefish.a === 1 && nums.ripefish.d === 1, JSON.stringify(nums.ripefish));
ok('Re銀色の清純・アルジャンテが3/2', nums.reargente.a === 3 && nums.reargente.d === 2, JSON.stringify(nums.reargente));
ok('サガツマツから必殺が消えている',
   nums.sagatsumatsu.kw === 'storm' && !nums.sagaBane, JSON.stringify(nums.sagatsumatsu));
ok('低劣の玩具が1/2', nums.lowtoy.a === 1 && nums.lowtoy.d === 2, JSON.stringify(nums.lowtoy));
ok('モルフェイが3/1', nums.morphei.a === 3 && nums.morphei.d === 1, JSON.stringify(nums.morphei));
ok('オルテニアが8コス', nums.ortenia.c === 8, JSON.stringify(nums.ortenia));
ok('救済の聖典がカウントダウン3', nums.holyscripture.cd === 3, JSON.stringify(nums.holyscripture));
ok('ヴィクトリアが必殺と突進を持つ',
   nums.victoria.kw.indexOf('bane') >= 0 && nums.victoria.kw.indexOf('rush') >= 0, nums.victoria.kw);
ok('機構ノヴァが3/3でコストダウンが-2',
   nums.nova.a === 3 && nums.nova.d === 3 && nums.novaMinus2, JSON.stringify(nums.nova));
ok('ウィムエルが7コス', nums.wimuel.c === 7, JSON.stringify(nums.wimuel));
ok('ラストダンサーが2コス2/2',
   nums.lastdancer.c === 2 && nums.lastdancer.a === 2 && nums.lastdancer.d === 2, JSON.stringify(nums.lastdancer));
ok('リリーブウルフが成長5', nums.relievewolf.gr === 5, JSON.stringify(nums.relievewolf));
ok('聖女の杖が2コス', nums.saintstaff.c === 2, JSON.stringify(nums.saintstaff));
ok('天斧の深淵から疾走が消えている', nums.axeStorm === false, String(nums.axeStorm));
ok('リアントースの条件が5枚', nums.leiantose5, String(nums.leiantose5));
ok('眠れる獅子が2回行うようになった', nums.lion2, String(nums.lion2));
ok('実験開始に成長8が付いた', nums.expstart.gr === 8, JSON.stringify(nums.expstart));

/* ---------- 能力調整：実際の働き ---------- */
const beh = await pg.evaluate(async () => {
  const setup = pp => {
    startGame({ p1: { deck: { goblin_001: 40 }, cls: 'machina', name: 'A' },
                p2: { deck: { goblin_001: 40 }, cls: 'machina', name: 'B' }, timer: 0, first: 'p1' });
    G.sim = true; G.phase = 'play'; G.active = 0; G.players[0].pp = pp; G.players[0].hand = [];
  };
  const give = id => { const c = makeInstance(id, 0); G.players[0].hand.push(c); return c; };
  const board = () => G.players[0].board.map(f => f.cardId + ':' + (f.keywords || []).join('/'));
  const out = {};

  setup(2); give('goblin_001');
  await playCard(give('expstart_001').uid);
  out.expNormal = board();
  setup(8);
  await playCard(give('expstart_001').uid);
  out.expGrown = board();

  setup(10); await playCard(give('kukishiro_001').uid);
  out.kukishiro = board().filter(x => x.indexOf('mdash_001') === 0).length;

  setup(10); await playCard(give('catapult_001').uid);
  await destroyByEffect(G.players[0].board.find(f => f.cardId === 'catapult_001'));
  await cleanupBoard();
  out.catapult = board().filter(x => x.indexOf('mward_001') === 0).length;

  setup(10); await playCard(give('vivaty_001').uid);
  out.vivatyMana = board().some(x => x.indexOf('mana_001') === 0);

  setup(10);
  const t = give('treasure_001');
  const before = costOf(t);
  await playCard(give('vanishdemon_001').uid);
  out.treasure = { before, after: costOf(t) };

  setup(10); await playCard(give('sleepinglion_001').uid);
  for (let i = 0; i < 3; i++) G.players[1].board.push(Object.assign(makeInstance('himeka_001', 1), { summonedThisTurn: false }));
  await runBoardHook('turnEnd', 0);
  out.lionHits = G.players[1].board.reduce((a, f) => a + (f.maxHp - f.hp), 0);
  return out;
});
ok('実験開始：成長前は実験体1体', beh.expNormal.filter(x => x.indexOf('exp_001') === 0).length === 1,
   JSON.stringify(beh.expNormal));
ok('実験開始：成長8で実験体4体', beh.expGrown.filter(x => x.indexOf('exp_001') === 0).length === 4,
   JSON.stringify(beh.expGrown));
ok('実験開始：1体目が守護・2体目が必殺・3体目が吸血',
   /ward/.test(beh.expGrown[0]) && /bane/.test(beh.expGrown[1]) && /drain/.test(beh.expGrown[2]),
   JSON.stringify(beh.expGrown));
ok('クキシロが疾走の機械を2体出す', beh.kukishiro === 2, String(beh.kukishiro));
ok('カタパルトのラストワードで守護の機械が2体出る', beh.catapult === 2, String(beh.catapult));
ok('ビバティーがマナを1つ出す', beh.vivatyMana === true, String(beh.vivatyMana));
ok('消える魔が手札のコスト1の財宝を1安くする',
   beh.treasure.before === 1 && beh.treasure.after === 0, JSON.stringify(beh.treasure));
ok('眠れる獅子が合計4ダメージ与える（2ダメージ×2回）', beh.lionHits === 4, String(beh.lionHits));

/* バッジ「奥夜花」に マナ が入ったか */
const badge = await pg.evaluate(() => ({
  desc: BADGES.okuyoka_badge.desc,
  mana: BADGES.okuyoka_badge.effects.some(e => e.type === 'summon' && e.params.cardId === 'mana_001')
}));
ok('バッジ「奥夜花」が守護兵と一緒にマナも出す', badge.mana === true, badge.desc);

console.log(OUT.join('\n'));
await b.close();
