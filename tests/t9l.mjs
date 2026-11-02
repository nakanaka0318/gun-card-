/* 追加ルール：威圧と覇気は、相手のリーダーを攻撃すると失われる */
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

console.log(OUT.join('\n'));
await b.close();
