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
  document.querySelector('[data-rec-unit="class"]').click();
  const cls = [...document.querySelectorAll('#recOut .mtx tbody th')].map(x => x.textContent.trim());
  return { decks, cls };
});
ok('自分のデッキ単位に切り替えられる',
   unit.decks.length === 2 && unit.decks.join().indexOf('ディスカ') >= 0, JSON.stringify(unit.decks));
ok('クラス単位に戻せる', unit.cls.length === 5, JSON.stringify(unit.cls));

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

console.log(OUT.join('\n'));
await b.close();
