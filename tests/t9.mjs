/* ver9 の整合性と挙動を確かめる */
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

/* ---------- [A] データ整合性 ---------- */
const A = await pg.evaluate(() => {
  const v9 = CARDS.filter(c => c.ver === 9);
  const ids = v9.map(c => c.id);
  const badIds = [], badEff = [], badBadge = [], badKw = [], badArt = [], badCls = [], badTribe = [], badText = [];
  const refIds = [];
  CARDS.filter(c => c.ver === 9).forEach(c => {
    if (!CARD_BY_ID[c.id]) badIds.push(c.id);
    if (!CLASSES[c.cls]) badCls.push(c.id + ':' + c.cls);
    if (c.tribe && !TRIBES[c.tribe]) badTribe.push(c.id + ':' + c.tribe);
    if (!SHAPES[c.art]) badArt.push(c.id + ':' + c.art);
    (c.keywords || []).forEach(k => { if (!KEYWORDS[k]) badKw.push(c.id + ':' + k); });
    if (!c.text || !c.flavor) badText.push(c.id);
    const walk = list => (list || []).forEach(e => {
      if (e.type && !EFFECTS[e.type]) badEff.push(c.id + ':' + e.type);
      if (e.hook && !ABILITY_TERMS[e.hook]) badEff.push(c.id + ':hook=' + e.hook);
      const p = e.params || {};
      if (p.badgeId && !BADGES[p.badgeId]) badBadge.push(c.id + ':' + p.badgeId);
      if (p.cardId) refIds.push(c.id + '>' + p.cardId);
      ['then', 'each', 'perCard'].forEach(k => walk(p[k]));
      (p.options || []).forEach(o => walk(o.effects));
    });
    walk(c.effects);
    (c.related || []).forEach(r => refIds.push(c.id + '>' + r));
    (c.relatedBadges || []).forEach(r => { if (!BADGES[r]) badBadge.push(c.id + ':' + r); });
    if (c.fusion && !fusionAcceptText(c)) badText.push(c.id + ':fusionText');
  });
  const deadRef = refIds.filter(r => !CARD_BY_ID[r.split('>')[1]]);
  return {
    n: v9.length, ids,
    byCls: ['neutral', 'formation', 'accel'].map(k => v9.filter(c => c.cls === k).length),
    otherCls: v9.filter(c => ['neutral', 'formation', 'accel'].indexOf(c.cls) < 0).map(c => c.id),
    badIds, badEff: [...new Set(badEff)], badBadge: [...new Set(badBadge)], badKw, badArt, badCls, badTribe, badText, deadRef,
    versions: VERSIONS.join(','), verLabel9: verLabel(9),
    dupIds: ids.filter((x, i) => ids.indexOf(x) !== i),
    tribeNotNone: v9.filter(c => c.tribe && c.tribe !== 'none').map(c => c.id + ':' + c.tribe),
    tokens: v9.filter(c => c.token).map(c => c.id)
  };
});
ok('ver9 のカードが24枚ある', A.n === 24, String(A.n));
ok('エニグマ8・フォーメーション8・アクセル8', A.byCls.join(',') === '8,8,8', A.byCls.join(',') + ' / 他クラス:' + A.otherCls.join(','));
ok('IDの重複がない', A.dupIds.length === 0, A.dupIds.join(','));
ok('全カードが索引に載っている', A.badIds.length === 0, A.badIds.join(','));
ok('効果の種類とフックが全て実在する', A.badEff.length === 0, A.badEff.join(' | '));
ok('参照しているバッジが全て実在する', A.badBadge.length === 0, A.badBadge.join(','));
ok('キーワードが全て実在する', A.badKw.length === 0, A.badKw.join(','));
ok('アートが全て実在する', A.badArt.length === 0, A.badArt.join(','));
ok('クラス指定が正しい', A.badCls.length === 0, A.badCls.join(','));
ok('タイプ（種族）指定が正しい', A.badTribe.length === 0, A.badTribe.join(','));
ok('参照カードIDが全て実在する', A.deadRef.length === 0, A.deadRef.join(' | '));
ok('説明文とフレーバーが全カードにある', A.badText.length === 0, A.badText.join(','));
ok('VERSIONS に 9 が入っている', A.versions === '1,2,3,4,5,6,7,8,9' && A.verLabel9 === 'ver9', A.versions);
/* 指定のない種族・トークンは付けない（取り決め） */
ok('タイプ行にない種族を付けていない', A.tribeNotNone.length === 0, A.tribeNotNone.join(','));
ok('指定のないトークン扱いをしていない', A.tokens.length === 0, A.tokens.join(','));

/* ---------- [B] 用語集の網羅 ---------- */
const Bx = await pg.evaluate(() => ({
  enhanceKw: !!KEYWORDS.enhance, deckDiscarded: !!ABILITY_TERMS.deckDiscarded,
  rudeman: !!BADGES.rudeman, voidend: !!BADGES.voidend,
  badgeDesc: [BADGES.rudeman, BADGES.voidend].every(x => x && x.name && x.desc && x.kana && x.glyph)
}));
ok('キーワード「エンハンス」が用語集にある', Bx.enhanceKw, '');
ok('「山札で捨てられた時」が用語集にある', Bx.deckDiscarded, '');
ok('バッジ2種が登録され説明も揃っている', Bx.rudeman && Bx.voidend && Bx.badgeDesc, JSON.stringify(Bx));

console.log(OUT.join('\n'));
console.log('pageerrors: ' + errs.length + (errs.length ? ' :: ' + errs.slice(0,2).join(' | ') : ''));
console.log('---- ' + OUT.filter(x => x.startsWith('PASS')).length + ' pass / ' + OUT.filter(x => x.startsWith('FAIL')).length + ' fail');
await b.close();
