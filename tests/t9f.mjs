/* 音楽（BGM）の仕組みを確かめる。実際に音は聞けないので、
   「いつ・どの曲が・どれだけの音量で・何個の音として予約されたか」を数えて見る。 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
const PAGE = pathToFileURL(join(dirname(dirname(fileURLToPath(import.meta.url))), 'index.html')).href;
const URL = PAGE;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
const OUT = [];
const ok = (n, c, d = '') => OUT.push((c ? 'PASS ' : 'FAIL ') + n + (d ? ' :: ' + d : ''));
const pg = await b.newPage({ viewport: { width: 412, height: 892 } });
const warns = []; pg.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') warns.push(m.text()); });
const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.route('**/*fonts.g*.com/**', r => r.abort());
await pg.goto(URL); await pg.waitForTimeout(800);

/* --- 触られる前は何も鳴らない --- */
const before = await pg.evaluate(() => ({ ctx: !!Sfx.ctx, master: !!Bgm.master, timer: !!Bgm.timer, on: Bgm.on, key: Bgm.key }));
ok('触られる前は音楽の装置も作らない',
   before.ctx === false && before.master === false && before.timer === false, JSON.stringify(before));
ok('設定としては音楽が入になっている（鳴るのは触られてから）',
   before.on === true && before.key === 'home', JSON.stringify(before));
ok('読み込みだけでは音の警告が出ない', !warns.some(w => /AudioContext/.test(w)), warns.filter(w => /AudioContext/.test(w)).join(' | '));

/* --- 曲の設計そのものが成り立っているか --- */
const design = await pg.evaluate(() => {
  const bad = [], kinds = new Set();
  Object.keys(BGM_TRACKS).forEach(k => {
    const t = BGM_TRACKS[k];
    if (!t.name || !t.bpm || !t.bars || !t.chords || !t.voices) bad.push(k + ':欠け');
    if (t.chords.length < 1) bad.push(k + ':和音なし');
    if (t.bpm < 40 || t.bpm > 180) bad.push(k + ':bpm=' + t.bpm);
    t.chords.forEach(c => c.forEach(n => { if (n < 24 || n > 96) bad.push(k + ':音域' + n); }));
    t.voices.forEach(v => {
      kinds.add(v.v);
      if (!v.pat || !v.pat.length) bad.push(k + ':' + v.v + ':pat なし');
      v.pat.forEach(p => { if (p < 0 || p > 15) bad.push(k + ':' + v.v + ':pat=' + p); });
      if (!(v.gain > 0 && v.gain < .4)) bad.push(k + ':' + v.v + ':gain=' + v.gain);
      if (v.bars) v.bars.forEach(bb => { if (bb >= t.bars) bad.push(k + ':' + v.v + ':bars=' + bb); });
    });
  });
  const screens = SCREENS.filter(s => !BGM_FOR_SCREEN[s]);
  const missing = Object.values(BGM_FOR_SCREEN).filter(v => !BGM_TRACKS[v]);
  return { n: Object.keys(BGM_TRACKS).length, bad, kinds: [...kinds], screens, missing,
           names: Object.keys(BGM_TRACKS).map(k => BGM_TRACKS[k].name) };
});
ok('曲が7つある', design.n === 7, String(design.n) + ' / ' + design.names.join('・'));
ok('どの曲も設計が成り立っている（音域・速さ・音量・小節）', design.bad.length === 0, design.bad.slice(0, 6).join(' | '));
ok('全ての画面に曲が割り当たっている', design.screens.length === 0, design.screens.join(','));
ok('割り当て先の曲が全て実在する', design.missing.length === 0, design.missing.join(','));
ok('音色が6種そろっている', design.kinds.length >= 6, design.kinds.join(','));

/* --- 触ると鳴り始める --- */
await pg.mouse.click(6, 6); await pg.waitForTimeout(400);
const after = await pg.evaluate(() => ({ ctx: !!Sfx.ctx, master: !!Bgm.master, timer: !!Bgm.timer,
  key: Bgm.key, gain: Bgm.master ? +Bgm.master.gain.value.toFixed(3) : null, step: Bgm.step }));
ok('一度触れば音楽が鳴り始める', after.ctx && after.master && after.timer && after.key === 'home', JSON.stringify(after));
ok('ステップが進んでいる（曲が流れている）', after.step > 0, JSON.stringify(after));

/* --- 実際に音が予約されているか（オシレーターの数を数える） --- */
const sched = await pg.evaluate(async () => {
  const ac = Sfx.ac();
  let osc = 0, buf = 0;
  const o1 = ac.createOscillator.bind(ac), b1 = ac.createBufferSource.bind(ac);
  ac.createOscillator = () => { osc++; return o1(); };
  ac.createBufferSource = () => { buf++; return b1(); };
  const s0 = Bgm.step;
  await new Promise(r => setTimeout(r, 1500));
  ac.createOscillator = o1; ac.createBufferSource = b1;
  return { osc, buf, steps: Bgm.step - s0 };
});
ok('音符が実際に予約されている', sched.osc > 0, JSON.stringify(sched));
ok('打楽器も鳴っている', sched.buf > 0, JSON.stringify(sched));

/* --- 画面ごとに曲が替わる --- */
const per = await pg.evaluate(async () => {
  const seen = {};
  for (const sc of ['home', 'setup', 'deck', 'cards', 'rule', 'matchup', 'battle', 'format']) {
    UI.go(sc); await new Promise(r => setTimeout(r, 60));
    seen[sc] = Bgm.key;
  }
  return seen;
});
ok('ホームは「荒野の夕暮れ」', per.home === 'home', JSON.stringify(per));
ok('デッキ編成とカード一覧は同じ静かな曲', per.deck === 'deck' && per.cards === 'deck', JSON.stringify(per));
ok('ルールブックは最も静かな曲', per.rule === 'rule', JSON.stringify(per));
ok('相性検証は刻みの曲', per.matchup === 'matchup', JSON.stringify(per));
ok('決闘は対峙の曲', per.battle === 'battle', JSON.stringify(per));
ok('設営とフォーマットは支度の曲', per.setup === 'menu' && per.format === 'menu', JSON.stringify(per));

/* --- 同じ曲の画面を行き来しても鳴り直さない（途切れない） --- */
const cont = await pg.evaluate(async () => {
  UI.go('deck'); await new Promise(r => setTimeout(r, 120));
  const s1 = Bgm.step;
  UI.go('cards'); await new Promise(r => setTimeout(r, 120));
  const s2 = Bgm.step;
  UI.go('rule'); await new Promise(r => setTimeout(r, 60));
  const s3 = Bgm.step;
  return { s1, s2, s3 };
});
ok('同じ曲の画面に移っても曲が頭に戻らない', cont.s2 > cont.s1, JSON.stringify(cont));
ok('違う曲の画面に移ると頭から始まる', cont.s3 < cont.s2, JSON.stringify(cont));

/* --- 音量は効果音より控えめ／切替が効く --- */
const vol = await pg.evaluate(async () => {
  UI.go('battle'); await new Promise(r => setTimeout(r, 700));
  const loud = +Bgm.master.gain.value.toFixed(3);
  const off = Bgm.toggle(); await new Promise(r => setTimeout(r, 700));
  const muted = +Bgm.master.gain.value.toFixed(3);
  const on = Bgm.toggle(); await new Promise(r => setTimeout(r, 700));
  return { loud, muted, on, off, back: +Bgm.master.gain.value.toFixed(3), stored: Bgm.on };
});
/* つまみ自体は BGM_LEVEL ぶん上げてあり、実際の大きさは頭を抑える装置が決める */
ok('音楽の音量つまみが想定の範囲にある', vol.loud > .1 && vol.loud <= 2, JSON.stringify(vol));
ok('音楽を切ると無音になる', vol.off === false && vol.muted < .01, JSON.stringify(vol));
ok('もう一度押すと戻る', vol.on === true && vol.back > 0, JSON.stringify(vol));

/* --- 切替ボタンが画面にある --- */
const btns = await pg.evaluate(() => {
  UI.go('home');
  const h = document.querySelector('#musicHome'), m = document.querySelector('#mMusic');
  return { home: h ? h.textContent.trim() : null, menu: m ? m.textContent.trim() : null,
           homeBox: h ? Math.round(h.getBoundingClientRect().height) : 0 };
});
ok('ホームに音楽の切替ボタンがある', !!btns.home && btns.home.indexOf('音楽') >= 0, JSON.stringify(btns));
ok('決闘中の設定にも音楽の切替がある', btns.menu === 'ON' || btns.menu === 'OFF', JSON.stringify(btns));

/* --- 決着すると余韻の曲になる --- */
const res = await pg.evaluate(async () => {
  startGame({ p1: { deck: { soldier_001: 40 }, cls: 'formation', name: 'A' },
              p2: { deck: { soldier_001: 40 }, cls: 'accel', name: 'B' }, timer: 0, first: 'p1' });
  G.sim = false; G.phase = 'play'; G.active = 0; await beginTurn();
  UI.go('battle'); await new Promise(r => setTimeout(r, 80));
  const inBattle = Bgm.key;
  G.players[1].life = 0; checkWin();
  await new Promise(r => setTimeout(r, 80));
  return { inBattle, after: Bgm.key, phase: G.phase };
});
ok('決着すると余韻の曲に替わる', res.inBattle === 'battle' && res.after === 'result', JSON.stringify(res));

/* --- 実際に音を書き出して、割れていないか・無音でないかを測る --- */
const wav = await pg.evaluate(async () => {
  const out = {};
  for (const key of Object.keys(BGM_TRACKS)) {
    const t = BGM_TRACKS[key];
    const secs = (60 / t.bpm) * 4 * t.bars + 1;              // 1周ぶん＋余韻
    const off = new OfflineAudioContext(1, Math.ceil(44100 * secs), 44100);
    const realAc = Sfx.ac, realCtx = Sfx.ctx;
    Sfx.touched = true; Sfx.ctx = off; Sfx.ac = () => off;    // 書き出し用の装置に差し替える
    Bgm.master = null; Bgm.key = key; Bgm.track = t; Bgm.step = 0;
    Bgm.out().gain.value = BGM_LEVEL * (t.gain || 1);
    const stepDur = 60 / t.bpm / 4;
    for (let i = 0; i < 16 * t.bars; i++) { Bgm.step = i; Bgm.schedule(i * stepDur + .01); }
    const d = (await off.startRendering()).getChannelData(0);
    let peak = 0, sum = 0, clipped = 0, nonSilent = 0;
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
      if (a > .999) clipped++;
      if (a > .002) nonSilent++;
      sum += d[i] * d[i];
    }
    out[key] = { name: t.name, peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(4),
                 clipped, fill: +(nonSilent / d.length).toFixed(2) };
    Sfx.ac = realAc; Sfx.ctx = realCtx; Bgm.master = null; Bgm.key = null; Bgm.track = null;
  }
  return out;
});
const ws = Object.values(wav);
const brief = ws.map(w => `${w.name} peak${w.peak}/rms${w.rms}`).join(' | ');
ok('どの曲も音が割れていない', ws.every(w => w.clipped === 0), brief);
ok('どの曲も効果音を乗せる余地がある（最大0.42以下）', ws.every(w => w.peak <= .42), brief);
ok('頭を抑える装置が入っていて、音量を上げても上限で止まる',
   await pg.evaluate(() => !!Bgm.limiter && BGM_CEIL > 0 && BGM_CEIL < .5), '');
ok('どの曲も無音ではない（実際に音が出ている）', ws.every(w => w.rms > .008 && w.fill > .1), brief);
ok('静かな曲ほど実際に静かになっている',
   wav.rule.rms < wav.deck.rms && wav.deck.rms < wav.home.rms, brief);

ok('音楽を入れてもページエラーなし', errs.length === 0, errs.join(' | '));
console.log(OUT.join('\n'));
console.log('---- ' + OUT.filter(x => x.startsWith('PASS')).length + ' pass / ' + OUT.filter(x => x.startsWith('FAIL')).length + ' fail');
await b.close();
