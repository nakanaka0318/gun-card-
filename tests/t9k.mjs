/* 戦績：自分がやった試合から相性表をつくる画面 */
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

/* ---------- 入り口 ---------- */
const home = await pg.evaluate(() => ({
  btn: !!document.querySelector('[data-go="record"]'),
  inScreens: SCREENS.indexOf('record') >= 0
}));
ok('ホームに戦績の入り口がある', home.btn, JSON.stringify(home));
ok('画面として登録されている', home.inScreens, JSON.stringify(home));

/* ---------- 何も無いとき ---------- */
await pg.evaluate(() => UI.go('record')); await pg.waitForTimeout(350);
const empty = await pg.evaluate(() => ({
  shown: !document.getElementById('sc-record').hidden,
  formOpen: !document.getElementById('recForm').hidden,
  msg: (document.querySelector('#recOut .recempty') || {}).textContent || '',
  cls: document.getElementById('recMeCls').options.length,
  firsts: document.querySelectorAll('#recFirst .chip').length,
  results: document.querySelectorAll('#recResult .chip').length,
  list: document.getElementById('recDeckList').options.length
}));
ok('戦績の画面が開く', empty.shown, JSON.stringify(empty));
ok('1件も無いときは入力欄が開いている', empty.formOpen, JSON.stringify(empty));
ok('まだ無いことが文で分かる', empty.msg.indexOf('まだ1試合も') >= 0, empty.msg);
ok('クラスは5つから選ぶ', empty.cls === 5, String(empty.cls));
ok('先攻後攻と結果が3つずつ出る', empty.firsts === 3 && empty.results === 3, JSON.stringify(empty));
ok('デッキ名の候補が出る', empty.list > 0, String(empty.list));

/* ---------- 手で入れる ---------- */
const added = await pg.evaluate(() => {
  const add = (me, md, op, od, first, res, t) => {
    document.getElementById('recMeCls').value = me; document.getElementById('recMeDeck').value = md;
    document.getElementById('recOppCls').value = op; document.getElementById('recOppDeck').value = od;
    RecForm.first = first; RecForm.result = res; UI.renderRecord();
    document.getElementById('recTurns').value = t || '';
    document.getElementById('recAdd').click();
  };
  add('accel', 'ディスカ', 'dominion', '購入', 'me', 'win', 9);
  add('accel', 'ディスカ', 'dominion', '購入', 'opp', 'win', 11);
  add('accel', 'ディスカ', 'arcana', 'バッジ', 'me', 'lose', 12);
  add('arcana', 'スペル', 'accel', 'リノ', 'me', 'draw', 20);
  const cellOf = (r, c) => {
    const tr = [...document.querySelectorAll('#recOut .mtx tbody tr')]
      .find(x => x.querySelector('th').textContent.indexOf(CLASSES[r].name) >= 0);
    if (!tr) return null;
    const i = MATCHUP_CLASSES.indexOf(c);
    const td = tr.querySelectorAll('td')[i];
    return td ? td.textContent.trim() : null;
  };
  return {
    n: MyRecords.length,
    rows: document.querySelectorAll('#recOut .recrow').length,
    sum: [...document.querySelectorAll('#recOut .msum-card .mrate')].map(x => x.textContent),
    accelVsDominion: cellOf('accel', 'dominion'),
    accelVsArcana: cellOf('accel', 'arcana'),
    arcanaVsAccel: cellOf('arcana', 'accel'),
    turns: MyRecords[0].turns, first: MyRecords[1].first
  };
});
ok('入れた試合がそのまま残る', added.n === 4, JSON.stringify(added));
ok('履歴が入れた数だけ出る', added.rows === 4, String(added.rows));
ok('通算の勝率が出る（2勝1敗1分＝67%）', added.sum[0] === '67%', JSON.stringify(added.sum));
ok('先攻のときの勝率が出る（1勝1敗＝50%）', added.sum[1] === '50%', JSON.stringify(added.sum));
ok('後攻のときの勝率が出る（1勝0敗＝100%）', added.sum[2] === '100%', JSON.stringify(added.sum));
ok('相性表のマスが勝敗どおり（アクセル対ドミニオンは2-0）',
   /100%/.test(added.accelVsDominion) && /2-0/.test(added.accelVsDominion), String(added.accelVsDominion));
ok('負けたマスは0%になる', /0%/.test(added.accelVsArcana) && /0-1/.test(added.accelVsArcana), String(added.accelVsArcana));
ok('引き分けだけのマスは勝率を出さない', /0-0-1/.test(added.arcanaVsAccel), String(added.arcanaVsAccel));
ok('ターン数と先攻後攻も残る', added.turns === 9 && added.first === 'opp', JSON.stringify(added));

/* ---------- 単位の切り替え ---------- */
const unit = await pg.evaluate(() => {
  document.querySelector('[data-rec-unit="deck"]').click();
  const decks = [...document.querySelectorAll('#recOut .mtx tbody th')].map(x => x.textContent.trim());
  const heads = [...document.querySelectorAll('#recOut .mtx thead th')].map(x => x.textContent.trim());
  document.querySelector('[data-rec-unit="class"]').click();
  const cls = [...document.querySelectorAll('#recOut .mtx tbody th')].map(x => x.textContent.trim());
  return { decks, heads, cls };
});
/* 自分が使ったデッキ（ディスカ・スペル）と、相手に使ったデッキ（購入・バッジ・リノ）の両方が行に出る */
ok('デッキ同士の表になり、相手に使ったデッキも行に出る',
   unit.decks.length === 5 && ['ディスカ', 'スペル', '購入', 'バッジ', 'リノ'].every(n => unit.decks.indexOf(n) >= 0),
   JSON.stringify(unit.decks));
ok('横の見出しもデッキ名になる',
   unit.heads.indexOf('購入') >= 0 && unit.heads[0].indexOf('デッキ') >= 0, JSON.stringify(unit.heads));
ok('クラス単位に戻せる', unit.cls.length === 5, JSON.stringify(unit.cls));

/* ---------- 同じクラス同士でも、勝った側と負けた側の両方が残る ---------- */
const mirror = await pg.evaluate(() => {
  const keep = MyRecords.slice();
  MyRecords = [];
  addRecord({ meCls: 'formation', meDeck: 'ver1フォメ', oppCls: 'formation', oppDeck: 'ver2フォメ',
              first: 'opp', result: 'win', turns: 16, note: '' });
  RecUnit = 'deck'; UI.renderRecordOut();
  const read = () => [...document.querySelectorAll('#recOut .mtx tbody tr')].map(tr => ({
    name: tr.querySelector('th').textContent.trim(),
    cells: [...tr.querySelectorAll('td')].map(td => td.textContent.trim())
  }));
  const rows = read();
  MyRecords = keep; saveRecords(); RecUnit = 'class'; UI.renderRecord();
  return rows;
});
ok('片方しか記録しなくても両方のデッキが行に出る', mirror.length === 2,
   JSON.stringify(mirror.map(r => r.name)));
ok('勝った側は勝ちとして出る',
   /100%/.test((mirror[0] || {}).cells[1] || '') && /1-0/.test(mirror[0].cells[1]), JSON.stringify(mirror[0]));
ok('負けた側は裏返して負けとして出る',
   /0%/.test((mirror[1] || {}).cells[0] || '') && /0-1/.test(mirror[1].cells[0]), JSON.stringify(mirror[1]));

/* ---------- 決着の画面から1押しで残す ---------- */
const fromResult = await pg.evaluate(async () => {
  const A = FORMAT_DECKS.find(x => x.key === 'discard_accel_v4'), B = FORMAT_DECKS.find(x => x.key === 'dominion_v9');
  startGame({ p1: { deck: A.list, cls: A.cls, name: A.name, label: '自分' },
              p2: { deck: B.list, cls: B.cls, name: B.name, label: '相手（AI）' },
              timer: 0, first: 'p1', mode: 'pve' });
  G.phase = 'play'; G.active = 0; await beginTurn();
  G.players[1].life = 0; G.phase = 'over'; G.winner = 0;
  UI.showResult();
  const before = MyRecords.length;
  const btn = document.getElementById('resRecord');
  btn.click(); btn.click();                                 // 二度押しても増えない
  const r = MyRecords[MyRecords.length - 1];
  document.getElementById('ovResult').hidden = true;
  return { before, after: MyRecords.length, label: btn.textContent, disabled: btn.disabled,
           meCls: r.meCls, meDeck: r.meDeck, oppCls: r.oppCls, result: r.result, first: r.first };
});
ok('決着の画面に「戦績に残す」がある', fromResult.label.length > 0, JSON.stringify(fromResult));
ok('1押しで1件だけ増える', fromResult.after === fromResult.before + 1, JSON.stringify(fromResult));
ok('二度押しても増えない', fromResult.disabled === true, JSON.stringify(fromResult));
ok('自分と相手のクラスが正しく入る',
   fromResult.meCls === 'accel' && fromResult.oppCls === 'dominion', JSON.stringify(fromResult));
ok('プレイヤー名ではなくデッキ名が入る',
   fromResult.meDeck.indexOf('ディスカ') >= 0, String(fromResult.meDeck));
ok('勝敗と先攻後攻が正しく入る',
   fromResult.result === 'win' && fromResult.first === 'me', JSON.stringify(fromResult));

/* ---------- 消す・残る ---------- */
const del = await pg.evaluate(() => {
  const n = MyRecords.length;
  document.querySelector('[data-rec-del]').click();
  return { before: n, after: MyRecords.length, stored: (store.get('myRecords', []) || []).length };
});
ok('1件ずつ消せる', del.after === del.before - 1, JSON.stringify(del));
ok('消した結果が保存される', del.stored === del.after, JSON.stringify(del));

await pg.reload(); await pg.waitForTimeout(900);
const kept = await pg.evaluate(() => { Sfx.on = false; Bgm.on = false; UI.go('record'); return MyRecords.length; });
ok('画面を閉じても戦績が残る', kept === del.after, `${kept} / ${del.after}`);

/* ---------- 画面の作り ---------- */
await pg.waitForTimeout(350);
const layout = await pg.evaluate(() => {
  const bad = [];
  document.querySelectorAll('#sc-record button, #sc-record select, #sc-record input').forEach(n => {
    const r = n.getBoundingClientRect();
    if (r.width > 0 && (r.height < 36 || r.width < 36)) bad.push((n.id || n.className) + ':' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  /* 相性表は箱の中で横に巻く作りなので、その中は見ない */
  const over = [...document.querySelectorAll('#sc-record *')].filter(n => {
    if (n.closest('.mtwrap')) return false;
    const r = n.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1.5 || r.left < -1.5);
  }).length;
  const wrap = document.querySelector('#recOut .mtwrap');
  const wr = wrap.getBoundingClientRect();
  return { bad, over, table: !!document.querySelector('#recOut .mtx'),
           page: document.documentElement.scrollWidth > innerWidth,
           wrapFits: wr.right <= innerWidth + 1.5, scrolls: wrap.scrollWidth > wrap.clientWidth };
});
ok('押す部品はどれも36px以上ある', layout.bad.length === 0, layout.bad.join(' | '));
ok('細い画面でも横にはみ出さない', layout.over === 0 && !layout.page, JSON.stringify(layout));
ok('相性表は箱の中で横に巻く（画面を押し広げない）', layout.wrapFits, JSON.stringify(layout));
ok('戦績があるときは相性表が出ている', layout.table, '');
ok('戦績の画面でページエラーなし', errs.length === 0, errs.join(' | '));

/* ---------- 決闘の準備：自分のデッキからランダムに選ぶ ---------- */
const rnd = await pg.evaluate(() => {
  FORMAT_DECKS.slice(0, 5).forEach((f, i) =>
    Decks.push({ id: 'fd' + i, name: f.name, cls: f.cls, list: JSON.parse(JSON.stringify(f.list)), limit: true }));
  Decks.push({ id: 'half', name: '未完成', cls: 'accel', list: { goblin_001: 3 }, limit: true });
  saveDecks(); UI.go('setup');
  const picks = []; let same = 0;
  for (let i = 0; i < 30; i++) {
    const before = MatchDecks.p1;
    document.getElementById('p1DeckRand').click();
    if (MatchDecks.p1 === before) same++;
    picks.push(MatchDecks.p1);
    document.getElementById('p2DeckRand').click();
    picks.push(MatchDecks.p2);
  }
  return {
    both: !!document.getElementById('p1DeckRand') && !!document.getElementById('p2DeckRand'),
    uniq: [...new Set(picks)].length, same,
    half: picks.indexOf('half') >= 0,
    selSync: document.getElementById('p1DeckSelect').value === MatchDecks.p1
          && document.getElementById('p2DeckSelect').value === MatchDecks.p2,
    stored: (store.get('matchDecks', {}) || {}).p2 === MatchDecks.p2
  };
});
ok('プレイヤー1・2それぞれにランダムのボタンがある', rnd.both, JSON.stringify(rnd));
ok('押すたびに自分のデッキから選び直される', rnd.uniq >= 3, JSON.stringify(rnd));
ok('同じデッキが連続で選ばれない', rnd.same === 0, JSON.stringify(rnd));
ok('40枚そろっていないデッキは選ばれない', rnd.half === false, JSON.stringify(rnd));
ok('選び口と表示もそろって変わる', rnd.selSync, JSON.stringify(rnd));
ok('選んだデッキが保存される', rnd.stored, JSON.stringify(rnd));

const rndLay = await pg.evaluate(() => {
  const bad = [];
  document.querySelectorAll('#sc-setup button, #sc-setup select').forEach(n => {
    const r = n.getBoundingClientRect();
    if (r.width > 0 && (r.height < 36 || r.width < 36)) bad.push((n.id || n.className) + ':' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  return { bad, over: document.documentElement.scrollWidth > innerWidth };
});
ok('準備画面の押す部品はどれも36px以上ある', rndLay.bad.length === 0, rndLay.bad.join(' | '));
ok('ランダムを足しても準備画面が横にはみ出さない', !rndLay.over, '');

/* ---------- AI検証タブ ---------- */
await pg.evaluate(() => UI.go('record')); await pg.waitForTimeout(300);
const tabs = await pg.evaluate(() => {
  const names = [...document.querySelectorAll('#recTabs .chip')].map(x => x.textContent);
  document.querySelector('[data-rec-tab="ai"]').click();
  const ai = { realHidden: document.getElementById('recReal').hidden, aiShown: !document.getElementById('recAi').hidden };
  document.querySelector('[data-rec-tab="real"]').click();
  const real = { realShown: !document.getElementById('recReal').hidden, aiHidden: document.getElementById('recAi').hidden };
  document.querySelector('[data-rec-tab="ai"]').click();
  return { names, ai, real };
});
ok('実戦とAI検証のタブがある', tabs.names.join() === '実戦,AI検証', JSON.stringify(tabs.names));
ok('AI検証に切り替わる', tabs.ai.realHidden && tabs.ai.aiShown, JSON.stringify(tabs.ai));
ok('実戦に戻せる', tabs.real.realShown && tabs.real.aiHidden, JSON.stringify(tabs.real));

/* 焼き込んだ結果そのものの筋が通っているか */
const data = await pg.evaluate(() => {
  const n = AI_MATCHUP.keys.length;
  const want = n * (n - 1) / 2;
  const seen = new Set();
  let badRange = 0, badOrder = 0;
  AI_MATCHUP.pairs.forEach(([i, j, aw, dr]) => {
    seen.add(i + ',' + j);
    if (i >= j) badOrder++;
    if (aw < 0 || dr < 0 || aw + dr > AI_MATCHUP.games) badRange++;
  });
  const missingDeck = AI_MATCHUP.keys.filter(k => !FORMAT_DECKS.some(f => f.key === k));
  /* 裏返しても足して100戦になるか */
  const a = AI_MATCHUP.keys[0], b2 = AI_MATCHUP.keys[1];
  const x = aiPairTally(a, b2), y = aiPairTally(b2, a);
  return { n, want, pairs: AI_MATCHUP.pairs.length, uniq: seen.size, badRange, badOrder,
           missingDeck, games: AI_MATCHUP.games, total: AI_MATCHUP.total,
           flip: x.win === y.lose && x.lose === y.win && x.draw === y.draw,
           sum: x.win + x.lose + x.draw };
});
ok('45デッキぶんの組が全て揃っている',
   data.pairs === data.want && data.uniq === data.want, JSON.stringify(data));
ok('焼き込んだデッキが全て実在する', data.missingDeck.length === 0, data.missingDeck.join());
ok('勝ち数と引き分けが試合数の中に収まっている', data.badRange === 0, String(data.badRange));
ok('組は小さい番号→大きい番号の向きで入っている', data.badOrder === 0, String(data.badOrder));
ok('総試合数が組数×1組の試合数と合う',
   data.total === data.want * data.games, `${data.total} / ${data.want * data.games}`);
ok('裏から読んでも勝敗が入れ替わるだけ', data.flip && data.sum === data.games, JSON.stringify(data));

const aiv = await pg.evaluate(() => {
  const all = { rows: document.querySelectorAll('#recAi .airow').length,
                cols: document.querySelectorAll('#recAi .mtx thead th').length,
                want: AI_MATCHUP.keys.length };
  document.querySelector('[data-ai-ver="9"]').click();
  const v9 = { rows: document.querySelectorAll('#recAi .airow').length,
               cols: document.querySelectorAll('#recAi .mtx thead th').length,
               names: [...document.querySelectorAll('#recAi .airow .aname')].map(x => x.textContent) };
  document.querySelector('[data-ai-ver="' + VER_AI + '"]').click();
  const vai = { rows: document.querySelectorAll('#recAi .airow').length,
                names: [...document.querySelectorAll('#recAi .airow .aname')].map(x => x.textContent) };
  document.querySelector('[data-ai-pick]').click();
  const det = document.querySelector('#recAi .aidetail');
  /* 開いた札そのものを除いた、今の範囲の残り全部が並ぶ */
  const open = { rows: det ? det.querySelectorAll('.adrow').length : 0,
                 want: document.querySelectorAll('#recAi .airow').length - 1 };
  document.querySelector('[data-ai-ver="all"]').click();
  return { all, v9, vai, open };
});
ok('全デッキのランキングと表が出る',
   aiv.all.rows === aiv.all.want && aiv.all.cols === aiv.all.want + 2, JSON.stringify(aiv.all));
ok('バージョンで絞れる',
   aiv.v9.rows === 5 && aiv.v9.cols === 7 && aiv.v9.names.every(n => n.indexOf('ver9') >= 0), JSON.stringify(aiv.v9));
ok('デッキを押すと相手ごとの相性が開く',
   aiv.open.rows > 0 && aiv.open.rows === aiv.open.want, JSON.stringify(aiv.open));
ok('verAIで絞るとverAIのデッキだけになる',
   aiv.vai.rows === 10 && aiv.vai.names.every(n => n.indexOf('verAI') >= 0), JSON.stringify(aiv.vai));

/* verAI はどのクラスでも、そのクラスの既存最良デッキより上に来ているはず */
const vaiTop = await pg.evaluate(() => {
  const tot = aiTotals(AI_MATCHUP.keys);
  const clsOf = k => (FORMAT_DECKS.find(f => f.key === k) || {}).cls;
  const verOf = k => (FORMAT_DECKS.find(f => f.key === k) || {}).ver;
  const out = [];
  MATCHUP_CLASSES.forEach(cls => {
    const rows = tot.filter(t => clsOf(t.key) === cls);
    /* _vai はAIに合わせて組んだ方、_vaih は人間向けの理論の方 */
    const ai = rows.find(t => /_vai$/.test(t.key));
    const theory = rows.find(t => /_vaih$/.test(t.key));
    const bestOld = rows.filter(t => verOf(t.key) !== VER_AI)[0];
    out.push({ cls, ai: ai && +ai.pct.toFixed(1), theory: theory && +theory.pct.toFixed(1),
               old: bestOld && +bestOld.pct.toFixed(1), oldKey: bestOld && bestOld.key,
               top: !!(ai && bestOld && ai.pct > bestOld.pct), hasTheory: !!theory });
  });
  return out;
});
ok('AIに合わせたverAIが5クラスすべてにある', vaiTop.every(x => x.ai != null), JSON.stringify(vaiTop));
ok('人間向けのverAI理論も5クラスすべてにある', vaiTop.every(x => x.hasTheory), JSON.stringify(vaiTop));
ok('AIに合わせたverAIはどのクラスでも既存の最良デッキを上回る',
   vaiTop.every(x => x.top), JSON.stringify(vaiTop));

const aiLay = await pg.evaluate(() => {
  const bad = [];
  document.querySelectorAll('#recAi button').forEach(n => {
    const r = n.getBoundingClientRect();
    if (r.width > 0 && (r.height < 36 || r.width < 36)) bad.push((n.className || '') + ':' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  const over = [...document.querySelectorAll('#recAi *')].filter(n => {
    if (n.closest('.mtwrap')) return false;
    const r = n.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1.5 || r.left < -1.5);
  }).length;
  return { bad, over, page: document.documentElement.scrollWidth > innerWidth };
});
ok('AI検証の押す部品はどれも36px以上ある', aiLay.bad.length === 0, aiLay.bad.join(' | '));
ok('AI検証が横にはみ出さない', aiLay.over === 0 && !aiLay.page, JSON.stringify(aiLay));

/* 賢い打ち方のAIが製品に入っているか */
const brain = await pg.evaluate(() => ({
  pick: typeof simPickCard === 'function',
  atk: typeof simPickAttackTarget === 'function',
  used: String(simPlayTurn).indexOf('simPickCard') >= 0 && String(simPlayTurn).indexOf('simPickAttackTarget') >= 0,
  noRandomHand: String(simPlayTurn).indexOf('hand[Math.floor(Math.random()') < 0
}));
ok('賢い打ち方のAIが使われている', brain.pick && brain.atk && brain.used, JSON.stringify(brain));
ok('手札からランダムに出す打ち方は残っていない', brain.noRandomHand, JSON.stringify(brain));

/* PPを使い切る選び方になっているか（1と5がある手札で、PPが5なら5を出す） */
const ppUse = await pg.evaluate(async () => {
  startGame({ p1: { deck: { goblin_001: 40 }, cls: 'formation', name: 'A' },
              p2: { deck: { goblin_001: 40 }, cls: 'formation', name: 'B' }, timer: 0, first: 'p1' });
  G.sim = true; G.phase = 'play'; G.active = 0;
  const p = G.players[0];
  p.pp = 5; p.hand = [];
  const mk = id => { const c = makeInstance(id, 0); p.hand.push(c); return c; };
  const one = mk('goblin_001');                  // コスト1
  const five = mk('goblinraid_001');             // コスト5
  const picked = simPickCard(p.hand.filter(c => canPlay(c)));
  return { ok: !!picked, name: picked && picked.name, five: five.name, one: one.name,
           fiveCost: costOf(five), oneCost: costOf(one) };
});
ok('PPを余らせない札を選ぶ', ppUse.ok && ppUse.name === ppUse.five, JSON.stringify(ppUse));

console.log(OUT.join('\n'));
await b.close();
