/* 節酒サポート E2Eスモークテスト
   実行: node tests/smoke.cjs (要: 起動済みローカルサーバー localhost:8130) */
/* playwright はローカル環境ではグローバル、CIでは node_modules から読み込む */
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const URL = process.env.TEST_URL || 'http://localhost:8130/index.html';
const EXEC = process.env.CHROME_PATH ||
  (require('fs').existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : '');
let failures = [];
function check(name, cond) {
  console.log((cond ? '  ok ' : '  NG ') + name);
  if (!cond) failures.push(name);
}
(async () => {
  const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  // ── 1. 新規ユーザー: オンボーディング ──
  await page.goto(URL);
  await page.waitForTimeout(400);
  check('新規: オンボーディング表示', !(await page.$eval('#onboarding', el => el.classList.contains('hidden'))));
  const past = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  await page.fill('#obStartDate', past);
  await page.click('#reasonChips .trigger[data-reason="健康のため"]');
  await page.click('#reasonChips .trigger[data-reason="お金を貯めたい"]');
  await page.click('#obNext1');
  await page.fill('#obDrinks', '3');
  await page.fill('#obPrice', '500');
  await page.click('#obNext2');
  await page.fill('#obGoal', '30');
  await page.fill('#obBirth', '1985-03-10');
  await page.click('#obFinish');
  await page.waitForTimeout(600);
  check('オンボーディング完了で閉じる', await page.$eval('#onboarding', el => el.classList.contains('hidden')));
  await page.waitForTimeout(800); // count-up 完了待ち
  check('継続10日', (await page.textContent('#daysCount')) === '10');
  check('通算10日', (await page.textContent('#chipTotal b')) === '10');
  check('通算は開始日からの経過日数を分母にした分数表示', /10\s*\/\s*10日/.test(await page.textContent('#chipTotal')));
  check('最長10日(まだ一度も脱線していないので連続日数と同じ)', (await page.textContent('#chipBest b')) === '10');
  check('節約¥15,000', (await page.textContent('#moneySaved')) === '¥15,000');
  check('禁酒率100%', (await page.textContent('#soberRate')) === '100%');
  check('あいさつ表示', ((await page.textContent('#greeting')) || '').length > 3);
  check('週間ストリップ7日分', (await page.$$('#weekStrip .ws-day')).length === 7);

  // ── 1b. アドバイスが「0日目」の文面のまま固定されない ──
  // 初回起動時(まだ0日)に作られた文面がキャッシュに残ると、オンボーディングで
  // 開始日を10日前にしても、その日いっぱい「スタート」のままになっていた
  check('アドバイスが0日目の文面のまま残らない',
    /10 日目/.test(await page.textContent('#adviceBody')));

  // ── 2. 今日を記録（気分必須） ──
  await page.click('#recordTodayBtn');
  await page.click('#saveLogBtn'); // 気分未選択 → エラートースト
  await page.waitForTimeout(200);
  check('気分未選択で保存できない', !(await page.$eval('#recordSheet', el => el.classList.contains('hidden'))));
  await page.click('.mood[data-mood="4"]');
  await page.$eval('#craving', el => { el.value = 6; el.dispatchEvent(new Event('input')); });
  await page.click('#triggerRow .trigger[data-trigger="ストレス"]');
  await page.fill('#note', 'テストメモ');
  await page.click('#saveLogBtn');
  await page.waitForTimeout(400);
  check('記録シートが閉じる', await page.$eval('#recordSheet', el => el.classList.contains('hidden')));
  await page.click('.nav-item[data-tab="log"]');
  const summary = await page.textContent('#todaySummary');
  check('今日のサマリーに記録済み表示', summary.includes('記録済み') && summary.includes('6/10'));

  // ── 3. タロットめくり ──
  await page.click('.nav-item[data-tab="home"]');
  check('タロットは伏せた状態', !(await page.$eval('#tarotFlip', el => el.classList.contains('flipped'))));
  await page.click('#tarotFlip');
  await page.waitForTimeout(150);
  check('タップ直後: シャッフル演出中', await page.$eval('#tarotFlip', el => el.classList.contains('shuffling')));
  await page.waitForTimeout(700);
  check('タロットがめくれる', await page.$eval('#tarotFlip', el => el.classList.contains('flipped')));
  check('シャッフル演出は終了している', !(await page.$eval('#tarotFlip', el => el.classList.contains('shuffling'))));
  check('カード名表示', ((await page.textContent('#fortuneName')) || '').length > 1);
  const luckyText = await page.textContent('#fortuneLucky');
  check('ラッキーカラーに名前が表示される(値なしのカンマ落ちバグの再発防止)', /ラッキーカラー: \S/.test(luckyText), luckyText);
  await page.reload(); await page.waitForTimeout(500);
  check('リロード後もめくれたまま', await page.$eval('#tarotFlip', el => el.classList.contains('flipped')));

  // ── 4. スリップ（昨日）＋undo → 通算は保持 ──
  await page.click('#relapseBtn');
  await page.click('#relapseDaySeg .seg-btn[data-day="1"]');
  await page.fill('#relapseNote', '飲み会で断れなかった');
  await page.click('#saveRelapseBtn');
  await page.waitForTimeout(600);
  check('スリップ後: 連続0日(今日から再開)', (await page.textContent('#chipStreak b')) === '0');
  check('スリップ後: 通算9日(保持)', (await page.textContent('#chipTotal b')) === '9');
  const money2 = await page.textContent('#moneySaved');
  check('スリップ後も節約額は保持', money2 === '¥13,500');
  // undo（中央ポップの確認カード）
  const confirmVisible = !(await page.$eval('#relapseConfirm', el => el.classList.contains('hidden')));
  check('スリップ確認カード表示', confirmVisible);
  await page.click('#rcUndo');
  await page.waitForTimeout(500);
  check('undo後: 連続10日に戻る', (await page.textContent('#chipStreak b')) === '10');
  check('undo後: 確認カードが閉じる', await page.$eval('#relapseConfirm', el => el.classList.contains('hidden')));

  // ── 5. SOS ──
  await page.click('#sosBtn');
  await page.waitForTimeout(200);
  const sosText = await page.textContent('#sosReasons');
  check('SOSに登録した理由が出る', sosText.includes('健康のため'));
  await page.click('#sosStart');
  await page.waitForTimeout(1200);
  const phase = await page.textContent('#breathPhase');
  check('呼吸フェーズ進行', ['吸って…', '止めて', '吐いて…'].includes(phase));

  // ── 5b. 深呼吸完了後: 「よく乗り越えました」を強調＋「続ける」ボタンで再開 ──
  check('SOS: 開始/続けるボタンが閉じるボタンの直前(真ん中付近)に配置', await page.$eval('#sosStart', el => el.nextElementSibling && el.nextElementSibling.id === 'sosClose'));
  await page.click('#sosClose');
  await page.click('#sosBtn');
  await page.waitForTimeout(50);
  await page.clock.install();
  await page.click('#sosStart');
  await page.clock.runFor(60000);
  check('深呼吸完了: 完了メッセージが強調表示される(breath-doneクラス)', await page.$eval('#breathPhase', el => el.classList.contains('breath-done')));
  const repeatVisible = await page.$eval('#sosStart', el => !el.hidden);
  const repeatLabel = await page.textContent('#sosStart');
  check('深呼吸完了: 「続ける」ボタンが閉じるボタンの上に表示される', repeatVisible && repeatLabel.includes('続ける'));
  await page.click('#sosStart');
  check('「続ける」タップで深呼吸が再開する(ボタンが再び隠れる)', await page.$eval('#sosStart', el => el.hidden));
  await page.clock.runFor(1000);
  const phase2 = await page.textContent('#breathPhase');
  check('再開後: 呼吸フェーズが進行する', ['吸って…', '止めて', '吐いて…'].includes(phase2));
  await page.clock.resume();
  await page.click('#sosClose');

  // ── 6. カレンダー詳細 ──
  await page.click('.nav-item[data-tab="stats"]');
  await page.waitForTimeout(300);
  await page.click(`#calendar button.cal-cell.today`);
  await page.waitForTimeout(200);
  const dd = await page.textContent('#dayDetail');
  check('日別詳細に記録内容', dd.includes('渇望 6/10') && dd.includes('テストメモ'));

  // ── 6b. カレンダーの週の始まり設定(日曜⇔月曜) ──
  check('デフォルトは日曜始まり', (await page.textContent('#calendar .cal-cell.dow')) === '日');
  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  check('設定の初期状態は日曜始まりが選択', await page.$eval('#weekStartSeg .seg-btn[data-week="sun"]', el => el.classList.contains('active')));
  await page.click('#weekStartSeg .seg-btn[data-week="mon"]');
  await page.waitForTimeout(200);
  await page.click('#closeSettings');
  await page.waitForTimeout(200);
  check('月曜始まりに切り替えるとカレンダー先頭が月曜になる', (await page.textContent('#calendar .cal-cell.dow')) === '月');
  await page.reload(); await page.waitForTimeout(600);
  await page.click('.nav-item[data-tab="stats"]');
  await page.waitForTimeout(300);
  check('リロード後も月曜始まりの設定を保持', (await page.textContent('#calendar .cal-cell.dow')) === '月');
  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  await page.click('#weekStartSeg .seg-btn[data-week="sun"]');
  await page.waitForTimeout(200);
  await page.click('#closeSettings');
  await page.waitForTimeout(200);
  check('日曜始まりに戻せる', (await page.textContent('#calendar .cal-cell.dow')) === '日');

  // ── 7. 設定・テーマ・エクスポート ──
  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  await page.click('#themeSeg .seg-btn[data-theme="dark"]');
  check('ダークテーマ適用', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.click('#exportBtn'),
  ]);
  check('エクスポートDL発火', (download.suggestedFilename() || '').startsWith('sesshu-backup-'));

  // ── 7b. ごほうび貯金（節約¥15,000 / 目標¥20,000 → あと¥5,000） ──
  await page.fill('#rewardName', 'イヤホン');
  await page.fill('#rewardPrice', '20000');
  await page.click('#saveSettings');
  await page.waitForTimeout(400);
  check('ごほうびカード表示', !(await page.$eval('#rewardCard', el => el.hidden)));
  const rw = await page.textContent('#rewardSub');
  check('ごほうび残額あと¥5,000', rw.includes('あと ¥5,000'));

  // ── 7b-2. ニックネーム設定 → ホームの挨拶に反映される ──
  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  check('設定を開いた時点でニックネーム欄は空', (await page.inputValue('#nickname')) === '');
  await page.fill('#nickname', 'たろう');
  await page.click('#saveSettings');
  await page.waitForTimeout(300);
  check('挨拶にニックネームが反映される', (await page.textContent('#greeting')).includes('たろうさん、'));
  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  check('設定を再度開くと入力したニックネームが復元される', (await page.inputValue('#nickname')) === 'たろう');
  await page.fill('#nickname', '');
  await page.click('#saveSettings');
  await page.waitForTimeout(300);
  check('ニックネームを空にすると挨拶が元に戻る', !(await page.textContent('#greeting')).includes('さん、'));

  // ── 7c. 戻るボタンでシートが閉じる ──
  await page.click('.nav-item[data-tab="home"]');
  await page.click('#recordTodayBtn');
  await page.waitForTimeout(250);
  check('記録シート再表示', !(await page.$eval('#recordSheet', el => el.classList.contains('hidden'))));
  await page.goBack();
  await page.waitForTimeout(350);
  check('戻る操作でシートが閉じる', await page.$eval('#recordSheet', el => el.classList.contains('hidden')));

  // ── 7d. シェアボタン ──
  await page.click('.nav-item[data-tab="badges"]');
  check('シェアボタンあり', !!(await page.$('#shareBtn')));

  // ── 7d-2. 禁酒継続の円タップで達成タブのマイルストーンへジャンプ ──
  await page.click('.nav-item[data-tab="home"]');
  await page.waitForTimeout(200);
  await page.click('#ringWrap');
  await page.waitForTimeout(200);
  check('円タップで達成タブに切り替わる', await page.$eval('#badges', el => el.classList.contains('active')));
  check('円タップ後、達成タブのマイルストーンが見える', await page.$eval('#badgeGrid', el => el.children.length > 0));

  // ── 7e. 記録リストに修正ボタン ──
  await page.click('.nav-item[data-tab="log"]');
  await page.waitForTimeout(200);
  check('記録リストに修正ボタン表示', (await page.$$('#logList .li-edit')).length >= 1);

  // ── 7f. スリップ「別の日」で4日前を記録 → 連続3日 → undo ──
  await page.click('.nav-item[data-tab="home"]');
  await page.click('#relapseBtn');
  await page.waitForTimeout(250);
  check('別の日ボタンあり', !!(await page.$('#relapseDaySeg .seg-btn[data-day="other"]')));
  await page.click('#relapseDaySeg .seg-btn[data-day="other"]');
  await page.waitForTimeout(150);
  check('別の日: 日付欄が出る', !(await page.$eval('#relapseDateField', el => el.hidden)));
  const day4ago = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
  await page.fill('#relapseDate', day4ago);
  await page.click('#saveRelapseBtn');
  await page.waitForTimeout(600);
  check('別の日スリップ後: 連続3日', (await page.textContent('#chipStreak b')) === '3');
  await page.click('#rcUndo'); // undo
  await page.waitForTimeout(500);
  check('別の日スリップundo後: 連続10日', (await page.textContent('#chipStreak b')) === '10');

  // ── 7g. スリップ確認カードの✕ボタン → undoせず記録は残る ──
  await page.click('#relapseBtn');
  await page.waitForTimeout(250);
  await page.click('#saveRelapseBtn'); // 今日を記録
  await page.waitForTimeout(500);
  check('✕ボタン前: 連続0日', (await page.textContent('#chipStreak b')) === '0');
  await page.click('#rcClose');
  await page.waitForTimeout(500);
  check('✕ボタンで確認カードが閉じる', await page.$eval('#relapseConfirm', el => el.classList.contains('hidden')));
  check('✕ボタンはundoしない: 連続0日のまま', (await page.textContent('#chipStreak b')) === '0');

  // ── 7h. 肝臓イラスト自体をタップするとポップアップ(タップ前は脈打つ演出とタップ表示→タップ後もイラストは押せる+隣に小さいアイコンも追加) ──
  check('肝臓: 見出しが断定的な医学表現を避けている', !(await page.textContent('#liverCaption')).includes('健康な肝臓'));
  check('肝臓: 初回はheroSideにliver-seenクラスなし(脈打つ演出あり)', !(await page.$eval('#heroSide', el => el.classList.contains('liver-seen'))));
  check('肝臓: 初回はタップボタンが表示されている', await page.$eval('#liverInfoBtn', el => el.offsetParent !== null));
  check('肝臓: 「タップ」ラベルが表示されている', (await page.textContent('#liverInfoBtn')).includes('タップ'));
  check('肝臓: 初回はイメージ図隣のアイコンは非表示', await page.$eval('#liverInfoIcon', el => el.offsetParent === null));
  await page.click('#liverInfoBtn');
  await page.waitForTimeout(300);
  check('肝臓: ボタンタップでポップアップが開く', !(await page.$eval('#liverInfoSheet', el => el.classList.contains('hidden'))));
  check('肝臓: 一度タップ後はheroSideにliver-seenクラスが付く', await page.$eval('#heroSide', el => el.classList.contains('liver-seen')));
  await page.click('#closeLiverInfo');
  await page.waitForTimeout(300);
  check('肝臓: タップ後は「タップ」ラベルが消える', await page.$eval('.liver-tap-label', el => getComputedStyle(el).display === 'none'));
  check('肝臓: タップ後もイラスト自体は引き続き押せる', await page.$eval('#liverInfoBtn', el => el.offsetParent !== null));
  check('肝臓: タップ後はイメージ図隣のアイコンも表示される', await page.$eval('#liverInfoIcon', el => el.offsetParent !== null));
  check('肝臓: タップ後もイラスト自体を押すとポップアップが開く', await (async () => {
    await page.click('#liverInfoBtn');
    await page.waitForTimeout(300);
    const opened = !(await page.$eval('#liverInfoSheet', el => el.classList.contains('hidden')));
    await page.click('#closeLiverInfo');
    await page.waitForTimeout(300);
    return opened;
  })());
  const liverBody = await page.textContent('.liver-info-body');
  check('肝臓: 注意書きに「医学的な診断ではない」旨を明記', liverBody.includes('医学的な診断'));
  check('肝臓: 注意書きに受診の案内を明記', liverBody.includes('医療機関'));
  check('肝臓: 隣のアイコンを再タップしてもポップアップが開く', await (async () => {
    await page.click('#liverInfoIcon');
    await page.waitForTimeout(300);
    const opened = !(await page.$eval('#liverInfoSheet', el => el.classList.contains('hidden')));
    await page.click('#closeLiverInfo');
    await page.waitForTimeout(300);
    return opened;
  })());
  await page.reload(); await page.waitForTimeout(600);
  check('肝臓: リロード後もliver-seen状態を保持', await page.$eval('#heroSide', el => el.classList.contains('liver-seen')));

  // ── 7i. 特別な日（例外日）機能。ここまでの操作で「今日」は失敗記録が残ったまま
  //        （7g・未undo）。継続0日・通算9日・節約¥13,500の状態から検証する。 ──
  await page.click('.nav-item[data-tab="home"]');
  await page.waitForTimeout(200);
  check('特別な日ボタンあり', !!(await page.$('#exceptionBtn')));
  await page.click('#exceptionBtn');
  await page.waitForTimeout(250);
  check('特別な日シートが開く(今日が選択された状態)',
    await page.$eval('#exceptionDaySeg .seg-btn[data-day="today"]', el => el.classList.contains('active')));
  await page.click('#saveExceptionBtn'); // メモ未入力 → 保存できない
  await page.waitForTimeout(200);
  check('メモ未入力では保存できない', !(await page.$eval('#exceptionSheet', el => el.classList.contains('hidden'))));
  await page.click('#exceptionReasonChips .trigger[data-reason="結婚式"]');
  check('理由チップタップでメモ欄に自動入力される', (await page.inputValue('#exceptionNote')) === '結婚式');
  await page.click('#saveExceptionBtn');
  await page.waitForTimeout(600);
  check('特別な日シートが閉じる', await page.$eval('#exceptionSheet', el => el.classList.contains('hidden')));
  check('特別な日にすると、同日の失敗記録が置き換わり継続日数が回復する',
    (await page.textContent('#chipStreak b')) === '10');
  check('特別な日も実際に飲んだ日として節約額には数えない(増えない)',
    (await page.textContent('#moneySaved')) === '¥13,500');
  const liverAfterException = await page.$eval('#liverBody', el => el.getAttribute('fill'));
  check('肝臓は継続日数と別に、特別な日でも最も濃い色に戻る', liverAfterException === 'rgb(43, 24, 16)');

  await page.click('.nav-item[data-tab="stats"]');
  await page.waitForTimeout(200);
  const todayCellClass = await page.$eval('.cal-cell.today', el => el.className);
  check('カレンダーの今日のセルがexceptionクラスを持つ', /\bexception\b/.test(todayCellClass));
  await page.click('.cal-cell.today');
  await page.waitForTimeout(200);
  const ddText = await page.textContent('#dayDetail');
  check('日付詳細に特別な日のメモが表示される', ddText.includes('結婚式'));
  check('「特別な日を取り消す」ボタンが表示される', !!(await page.$('#ddUnexception')));
  await page.click('#ddUnexception');
  await page.waitForTimeout(300);
  await page.click('.nav-item[data-tab="home"]');
  await page.waitForTimeout(200);
  check('特別な日を取り消しても継続日数は変わらない(もともと途切れていないため)',
    (await page.textContent('#chipStreak b')) === '10');
  check('特別な日を取り消すと、また節約日としてカウントされ節約額が増える',
    (await page.textContent('#moneySaved')) === '¥15,000');
  const liverAfterDelete = await page.$eval('#liverBody', el => el.getAttribute('fill'));
  check('特別な日を取り消すと肝臓の色も若返る', liverAfterDelete !== 'rgb(43, 24, 16)');

  // これからの予定として登録 → 過ぎるまでは今の日数・節約額に影響しない
  await page.click('#exceptionBtn');
  await page.waitForTimeout(250);
  await page.click('#exceptionDaySeg .seg-btn[data-day="future"]');
  await page.waitForTimeout(150);
  check('これからの予定を選ぶと日付欄が出る', !(await page.$eval('#exceptionDateField', el => el.hidden)));
  await page.click('#exceptionReasonChips .trigger[data-reason="旅行"]');
  await page.click('#saveExceptionBtn');
  await page.waitForTimeout(600);
  check('未来の特別な日を予約しても、現在の継続日数は変わらない',
    (await page.textContent('#chipStreak b')) === '10');
  check('未来の特別な日を予約しても、現在の節約額は変わらない',
    (await page.textContent('#moneySaved')) === '¥15,000');

  // ── 7j. 「すべてのデータを削除」で肝臓イラストの脈打つ演出も最初の状態に戻る ──
  page.once('dialog', d => d.accept());
  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  await page.click('#resetAll');
  await page.waitForTimeout(500);
  check('肝臓: 「すべてのデータを削除」でliver-seenクラスが外れ、再び脈打つ状態に戻る', !(await page.$eval('#heroSide', el => el.classList.contains('liver-seen'))));

  // ── 8. 既存ユーザーの移行（旧形式localStorage） ──
  await page.evaluate(() => {
    localStorage.setItem('sesshu_v1', JSON.stringify({
      startDate: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10),
      drinksPerDay: 2, pricePerDrink: 400, calPerDrink: 150,
      relapses: [], logs: {}, checkIns: [], bestStreak: 5,
      goalDays: 30, reminderOn: false, reminderTime: '21:00',
    }));
  });
  await page.reload(); await page.waitForTimeout(600);
  check('旧データ移行: オンボーディングをスキップ', await page.$eval('#onboarding', el => el.classList.contains('hidden')));
  await page.waitForTimeout(800);
  check('旧データ移行: 継続5日', (await page.textContent('#daysCount')) === '5');

  // ── 9. 言語切替（設定→English→UI英語化＋$表示） ──
  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  await page.click('#langSeg .seg-btn[data-lang="en"]');
  await page.waitForTimeout(300);
  check('EN: html langがen', (await page.evaluate(() => document.documentElement.lang)) === 'en');
  check('EN: タイトル英語化', (await page.textContent('.app-header h1')).includes('Moderation Support'));
  check('EN: ナビ英語化', (await page.textContent('.nav-item[data-tab="home"] .nav-label')) === 'Home');
  check('EN: マニフェストが英語版に切替', (await page.$eval('#manifestLink', el => el.href)).endsWith('manifest-en.json'));
  await page.click('#closeSettings');
  await page.waitForTimeout(200);
  check('EN: 記録ボタン英語化', (await page.textContent('#recordTodayBtn')).includes('Log today'));
  const enAdvice = await page.textContent('#adviceBody');
  check('EN: AIアドバイス英語生成', /alcohol-free|Day/.test(enAdvice) && /Did you know/.test(enAdvice));
  // 言語を日本語に戻す→日本語UI
  await page.click('#settingsBtn');
  await page.waitForTimeout(200);
  await page.click('#langSeg .seg-btn[data-lang="ja"]');
  await page.waitForTimeout(300);
  check('JA復帰: タイトル日本語', (await page.textContent('.app-header h1')).includes('節酒サポート'));
  check('JA復帰: マニフェストが日本語版に戻る', (await page.$eval('#manifestLink', el => el.href)).endsWith('manifest.json'));
  await page.click('#closeSettings');

  // ── 10. 英語ロケールの新規ユーザー（自動判定＋USD） ──
  const pageEn = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'en-US' });
  pageEn.on('pageerror', e => errors.push('EN: ' + e.message));
  await pageEn.goto(URL);
  await pageEn.waitForTimeout(500);
  check('EN新規: オンボーディング英語', (await pageEn.textContent('#onboarding h2')).includes('Welcome'));
  const enPast = new Date(Date.now() - 4 * 86400000).toISOString().slice(0, 10);
  await pageEn.fill('#obStartDate', enPast);
  await pageEn.click('#obNext1');
  await pageEn.fill('#obDrinks', '2');
  await pageEn.fill('#obPrice', '10');
  await pageEn.click('#obNext2');
  await pageEn.click('#obFinish');
  await pageEn.waitForTimeout(900);
  check('EN新規: 節約$80表示', (await pageEn.textContent('#moneySaved')) === '$80');
  check('EN新規: html=en', (await pageEn.evaluate(() => document.documentElement.lang)) === 'en');
  /* 日本語ブロックと英語ブロックを取り違えると、英語環境で日本語の窓口案内が
     出てしまう。ここで両方向を止める。 */
  check('EN: 相談窓口も英語', /Where to get help/.test(await pageEn.textContent('.help-card')));
  await pageEn.click('#openHelp');
  await pageEn.waitForTimeout(300);
  const helpEn = await pageEn.textContent('#helpSheet');
  check('EN: 窓口の中身も英語', /24 hours/.test(helpEn) && !/受付時間/.test(helpEn));
  check('EN: 電話番号は日本のまま', /0120-279-338/.test(helpEn));
  await pageEn.click('#closeHelp');
  await pageEn.waitForTimeout(200);
  await pageEn.close();

  // ── 11. タロット78枚デッキ＋大吉ジャックポット ──
  const colorCheck = await page.evaluate(() => {
    let missingJa = 0, missingEn = 0;
    for (let i = 0; i < 200; i++) {
      const d = Util.addDays(Util.todayStr(), -i);
      if (!Tarot.drawFortune('1985-03-10', d, 'ja').color.name) missingJa++;
      if (!Tarot.drawFortune('1985-03-10', d, 'en').color.name) missingEn++;
    }
    return { missingJa, missingEn };
  });
  check('ラッキーカラー: 日本語名が全日で解決される', colorCheck.missingJa === 0, `missing=${colorCheck.missingJa}`);
  check('ラッキーカラー: 英語名が全日で解決される', colorCheck.missingEn === 0, `missing=${colorCheck.missingEn}`);

  const variety = await page.evaluate(() => {
    let minor = 0, major = 0, jack = 0;
    for (let i = 0; i < 400; i++) {
      const d = Util.addDays(Util.todayStr(), -i);
      const f = Tarot.drawFortune('1985-03-10', d);
      if (f.card.kind === 'minor') minor++; else major++;
      if (f.jackpot) jack++;
    }
    return { minor, major, jack };
  });
  check('タロット: 小アルカナが引かれる', variety.minor > 100, `minor=${variety.minor}`);
  check('タロット: 大アルカナも引かれる', variety.major > 40, `major=${variety.major}`);
  check('タロット: 大吉はレア(400日中1〜70回)', variety.jack >= 1 && variety.jack <= 70, `jack=${variety.jack}`);
  check('タロット: デッキは78枚', (await page.evaluate(() => Tarot.DECK_SIZE)) === 78);

  // 今日が大吉になる誕生日を探して、めくり→演出→閉じるまで検証
  const jackBirth = await page.evaluate(() => {
    for (let y = 1950; y < 2010; y++) for (let m = 1; m <= 12; m++) {
      const b = `${y}-${String(m).padStart(2, '0')}-15`;
      if (Tarot.drawFortune(b, Util.todayStr()).jackpot) return b;
    }
    return null;
  });
  check('大吉になる誕生日が見つかる', !!jackBirth, jackBirth);
  if (jackBirth) {
    await page.evaluate((b) => {
      const s = JSON.parse(localStorage.getItem('sesshu_v1'));
      s.birthDate = b; s.tarotFlipped = ''; s.advice = null;
      localStorage.setItem('sesshu_v1', JSON.stringify(s));
    }, jackBirth);
    await page.reload(); await page.waitForTimeout(600);
    await page.click('#tarotFlip');
    await page.waitForTimeout(1700);
    check('大吉: ジャックポット演出が表示', !(await page.$eval('#jackpotOverlay', el => el.classList.contains('hidden'))));
    check('大吉: カードが金色仕様', await page.$eval('#tarotVisual', el => el.classList.contains('gold')));
    check('大吉: 演出優先のため線画アイコンには差し替えない', !(await page.$eval('#tarotVisual', el => el.classList.contains('major'))));
    const jpTitle = await page.textContent('.jp-title');
    check('大吉: タイトル表示', jpTitle.includes('大吉') || jpTitle.includes('JACKPOT'));
    await page.click('#jackpotOverlay');
    await page.waitForTimeout(300);
    check('大吉: タップで演出が閉じる', await page.$eval('#jackpotOverlay', el => el.classList.contains('hidden')));
  }

  // ── 11b. 大アルカナの線画アイコン(大吉を除く)・小アルカナは絵文字のまま ──
  const majorBirth = await page.evaluate(() => {
    for (let y = 1950; y < 2010; y++) for (let m = 1; m <= 12; m++) {
      const b = `${y}-${String(m).padStart(2, '0')}-03`;
      const f = Tarot.drawFortune(b, Util.todayStr());
      if (f.card.kind === 'major' && !f.jackpot) return b;
    }
    return null;
  });
  check('大アルカナ(非大吉)になる誕生日が見つかる', !!majorBirth, majorBirth);
  if (majorBirth) {
    await page.evaluate((b) => {
      const s = JSON.parse(localStorage.getItem('sesshu_v1'));
      s.birthDate = b; s.tarotFlipped = ''; s.advice = null;
      localStorage.setItem('sesshu_v1', JSON.stringify(s));
    }, majorBirth);
    await page.reload(); await page.waitForTimeout(500);
    await page.click('#tarotFlip');
    await page.waitForTimeout(900);
    check('大アルカナ: カードに.majorクラスが付く', await page.$eval('#tarotVisual', el => el.classList.contains('major')));
    check('大アルカナ: 線画SVGアイコンが描画される', await page.$eval('#tarotEmoji', el => !!el.querySelector('svg')));
  }
  const minorBirth = await page.evaluate(() => {
    for (let y = 1950; y < 2010; y++) for (let m = 1; m <= 12; m++) {
      const b = `${y}-${String(m).padStart(2, '0')}-07`;
      if (Tarot.drawFortune(b, Util.todayStr()).card.kind === 'minor') return b;
    }
    return null;
  });
  check('小アルカナになる誕生日が見つかる', !!minorBirth, minorBirth);
  if (minorBirth) {
    await page.evaluate((b) => {
      const s = JSON.parse(localStorage.getItem('sesshu_v1'));
      s.birthDate = b; s.tarotFlipped = ''; s.advice = null;
      localStorage.setItem('sesshu_v1', JSON.stringify(s));
    }, minorBirth);
    await page.reload(); await page.waitForTimeout(500);
    await page.click('#tarotFlip');
    await page.waitForTimeout(900);
    check('小アルカナ: .majorクラスは付かない', !(await page.$eval('#tarotVisual', el => el.classList.contains('major'))));
    check('小アルカナ: 絵文字のまま(SVGなし)', !(await page.$eval('#tarotEmoji', el => !!el.querySelector('svg'))));
  }

  // ── 12. Service Worker更新（キャッシュ総入れ替え）でも記録データは消えないか検証 ──
  const beforeUpdate = {
    total: await page.textContent('#chipTotal b'),
    money: await page.textContent('#moneySaved'),
    raw: await page.evaluate(() => localStorage.getItem('sesshu_v1')),
  };
  const swSource = await page.evaluate(() => fetch('sw.js').then(r => r.text()));
  // SWは記録本体（localStorageのsesshu_v1）には一切触れない設計。
  // （通知用の別置き設定 sesshu-sw のIndexedDBのみ使用可）
  check('sw.jsは記録データに触れない設計', !/localStorage|sesshu_v1/.test(swSource));
  await page.evaluate(async () => {
    // 新バージョンが降ってきて古いキャッシュを丸ごと入れ替える状況を再現
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
  });
  await page.reload();
  await page.waitForTimeout(700);
  const afterUpdate = {
    total: await page.textContent('#chipTotal b'),
    money: await page.textContent('#moneySaved'),
    raw: await page.evaluate(() => localStorage.getItem('sesshu_v1')),
  };
  check('SW更新後も記録データ(生データ)が完全一致', beforeUpdate.raw === afterUpdate.raw);
  check('SW更新後も通算日数が変わらない', beforeUpdate.total === afterUpdate.total);
  check('SW更新後も節約額が変わらない', beforeUpdate.money === afterUpdate.money);

  // ── 13. 通貨変更の警告表示 ──
  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  check('通貨警告: 初期状態は非表示', await page.$eval('#currencyWarn', el => el.hidden));
  await page.selectOption('#currency', 'USD');
  check('通貨警告: 変更すると表示', !(await page.$eval('#currencyWarn', el => el.hidden)));
  await page.selectOption('#currency', 'JPY');
  check('通貨警告: 元に戻すと消える', await page.$eval('#currencyWarn', el => el.hidden));

  // ── 14. バックアップ読み込みの確認ダイアログ ──
  const fixture = require('path').join(require('os').tmpdir(), 'sesshu-import-test.json');
  const fixDate = new Date(Date.now() - 8 * 86400000).toISOString().slice(0, 10);
  require('fs').writeFileSync(fixture, JSON.stringify({
    startDate: fixDate, drinksPerDay: 2, pricePerDrink: 300, calPerDrink: 100,
    logs: { [fixDate]: { mood: 4, craving: 2, note: 'インポートテスト', triggers: [] } },
    relapses: [], goalDays: 30,
  }));
  const beforeImport = await page.evaluate(() => localStorage.getItem('sesshu_v1'));
  page.once('dialog', d => d.dismiss());        // (a) キャンセル
  await page.setInputFiles('#importFile', fixture);
  await page.waitForTimeout(500);
  check('読み込みをキャンセル→データは無変更', (await page.evaluate(() => localStorage.getItem('sesshu_v1'))) === beforeImport);
  page.once('dialog', d => d.accept());          // (b) OK
  await page.setInputFiles('#importFile', fixture);
  await page.waitForTimeout(600);
  check('読み込みOK→データが置き換わる', (await page.evaluate(() => JSON.parse(localStorage.getItem('sesshu_v1')).startDate)) === fixDate);

  // ── 14b. バックアップ促しカードが、開いている画面の上に重ならない ──
  // 促しは起動3秒後に出るため、その時点で開いていたシートのボタンを
  // 覆って押せなくしてしまっていた
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('sesshu_v1'));
    s.lastBackupAt = ''; s.backupNudgedAt = ''; s.backupNudgeMuted = false;
    localStorage.setItem('sesshu_v1', JSON.stringify(s));
  });
  await page.reload();
  await page.waitForTimeout(600);
  await page.click('#settingsBtn');            // 促しが出る前にシートを開く
  await page.waitForTimeout(3800);
  check('シートを開いている間は促しカードを出さない',
    await page.$eval('#backupNudge', el => el.classList.contains('hidden')));
  check('シートのボタンが促しカードに覆われず押せる',
    await page.$eval('#closeSettings', el => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return el.contains(top) || el === top;
    }));
  await page.click('#closeSettings');
  await page.waitForTimeout(2400);
  check('シートを閉じたあとに促しカードが出る',
    !(await page.$eval('#backupNudge', el => el.classList.contains('hidden'))));
  await page.click('#backupNudgeLater');
  await page.waitForTimeout(200);

  // ── 15. バックアップ促し（30日以上未保存なら月1回、専用カードで表示） ──
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('sesshu_v1'));
    s.lastBackupAt = ''; s.backupNudgedAt = ''; s.backupNudgeMuted = false;
    localStorage.setItem('sesshu_v1', JSON.stringify(s));
  });
  await page.reload();
  await page.waitForTimeout(3800);   // 促しは起動3秒後に出る
  check('バックアップ促しカード表示', !(await page.$eval('#backupNudge', el => el.classList.contains('hidden'))));
  const nudgeMsg = await page.textContent('#backupNudge .backup-nudge-msg');
  check('バックアップ促しカードの文言', nudgeMsg.includes('バックアップ'));
  const [nudgeDl] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.click('#backupNudgeSave'),
  ]);
  check('促しから保存できる', (nudgeDl.suggestedFilename() || '').startsWith('sesshu-backup-'));
  check('保存後カードが閉じる', await page.$eval('#backupNudge', el => el.classList.contains('hidden')));
  check('保存日を記録（次の促しは30日後）', (await page.evaluate(() => JSON.parse(localStorage.getItem('sesshu_v1')).lastBackupAt)).length === 10);

  // ── 15a2. 「もう表示しない」を押すと二度と出ない ──
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('sesshu_v1'));
    s.lastBackupAt = ''; s.backupNudgedAt = ''; s.backupNudgeMuted = false;
    localStorage.setItem('sesshu_v1', JSON.stringify(s));
  });
  await page.reload();
  await page.waitForTimeout(3800);
  await page.click('#backupNudgeMute');
  check('「もう表示しない」でカードが閉じる', await page.$eval('#backupNudge', el => el.classList.contains('hidden')));
  check('mute状態が保存される', await page.evaluate(() => JSON.parse(localStorage.getItem('sesshu_v1')).backupNudgeMuted) === true);
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('sesshu_v1'));
    s.backupNudgedAt = '';   // 抑制期間もリセットして、mute自体が効いているか検証
    localStorage.setItem('sesshu_v1', JSON.stringify(s));
  });
  await page.reload();
  await page.waitForTimeout(3800);
  check('mute後は再読み込みしても促しカードが出ない', await page.$eval('#backupNudge', el => el.classList.contains('hidden')));

  // ── 15a3. 設定画面に機種変更の手順（折りたたみ）がある ──
  await page.click('#settingsBtn');
  await page.waitForTimeout(200);
  check('設定に「機種変更するときは」の項目がある', await page.$eval('.migrate-details summary', el => el.textContent.includes('機種変更')));
  check('初期状態は閉じている', !(await page.$eval('.migrate-details', el => el.hasAttribute('open'))));
  await page.click('.migrate-details summary');
  check('タップで開いて手順が読める', await page.$eval('.migrate-details', el => el.hasAttribute('open')) &&
    (await page.textContent('.migrate-steps')).includes('バックアップを読み込み'));

  // ── 姉妹アプリへのリンク（独自ドメインへ移すときに切れやすいので固定する） ──
  const sibHrefs = await page.$$eval('.link-btn', els => els.map(a => a.getAttribute('href')));
  check('姉妹アプリへのリンクが3本ある', sibHrefs.length === 3);
  check('禁酒へのリンクがある', sibHrefs.some(h => h.startsWith('https://kinshu.roguepink.com/')));
  check('禁煙へのリンクがある', sibHrefs.some(h => h.startsWith('https://kinen.roguepink.com/')));
  check('ギャンブル断ちへのリンクがある', sibHrefs.some(h => h.startsWith('https://dangamble.roguepink.com/')));
  check('自分自身へは張っていない', !sibHrefs.some(h => h.startsWith('https://sesshu.roguepink.com/')));
  check('姉妹アプリのリンクは参照元を渡さない',
    await page.$$eval('.link-btn', els => els.every(a => (a.rel || '').includes('noopener'))));
  await page.click('#closeSettings');
  await page.waitForTimeout(200);

  // ── 毎日の声かけ: 端末のカレンダーに登録できる ──
  // 通知はアプリを閉じていると時刻どおりに鳴らせないため、カレンダーに任せる方式に変更した
  check('通知のオン/オフ設定は無くなっている', !(await page.$('#reminderOn')));
  await page.click('#settingsBtn');
  await page.waitForTimeout(300);
  await page.fill('#reminderTime', '20:30');
  const [icsDl] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.click('#addCalendar'),
  ]);
  check('カレンダー用のファイルが作られる', (icsDl.suggestedFilename() || '').endsWith('-reminder.ics'));
  const icsText = require('fs').readFileSync(await icsDl.path(), 'utf8');
  check('毎日くり返す予定になっている', /RRULE:FREQ=DAILY/.test(icsText));
  // 英語の文言が日本語側を上書きしていたことがあるため、言語を明示して確認する
  check('日本語表示では予定名も日本語',
    await page.evaluate(() => { I18N.setLang('ja'); return /[ぁ-んァ-ヶ一-龠]/.test(I18N.t('ics.summary')); }));
  check('英語表示では予定名も英語',
    await page.evaluate(() => { I18N.setLang('en'); const v = I18N.t('ics.summary');
      I18N.setLang('ja'); return !/[ぁ-んァ-ヶ一-龠]/.test(v); }));
  check('指定した時刻が入っている', /DTSTART:\d{8}T203000/.test(icsText));
  check('タイムゾーン指定なし(その土地の時刻で鳴る)', !/DTSTART;TZID/.test(icsText));
  check('アラームが設定されている', /BEGIN:VALARM[\s\S]*ACTION:DISPLAY[\s\S]*END:VALARM/.test(icsText));
  check('改行がCRLF(仕様どおり)', icsText.includes('\r\n') && !/[^\r]\n/.test(icsText));
  check('1行75バイト以内に折り返されている',
    icsText.split('\r\n').every(l => Buffer.byteLength(l, 'utf8') <= 75));
  check('保存だけで終わらないよう、次の手順が画面に残る',
    !(await page.$eval('#calAfter', el => el.hidden)));
  check('案内に保存したファイル名が入る',
    /-reminder\.ics/.test(await page.textContent('#calAfter')));
  check('Googleカレンダーで開く導線がある', !!(await page.$('#calGoogle')));
  check('Googleカレンダーへ正しい内容で渡している', await page.evaluate(() => {
    const u = new URL(document.querySelector('#calGoogle').dataset.testUrl || '');
    return u.searchParams.get('recur') === 'RRULE:FREQ=DAILY' &&
           /T203000$/.test((u.searchParams.get('dates') || '').split('/')[0]);
  }));
  check('入力した時刻が保存される',
    (await page.evaluate(() => JSON.parse(localStorage.getItem('sesshu_v1')).reminderTime)) === '20:30');
  await page.click('#closeSettings');
  await page.waitForTimeout(300);

  // ── 相談窓口: 掲載内容が消えない／受付時間と通話料が必ず書いてある ──
  /* 番号そのものは 2026-08 に確認済み。ここで守りたいのは「掛けたのに出ない」を
     防ぐ書き方（24時間でない窓口の受付時間、ナビダイヤルの通話料）が
     あとから削られないこと。 */
  await page.click('.nav-item[data-tab="home"]');
  await page.waitForTimeout(200);
  await page.click('#openHelp');
  await page.waitForTimeout(300);
  check('相談窓口シートが開く', !(await page.$eval('#helpSheet', el => el.classList.contains('hidden'))));
  const helpText = await page.textContent('#helpSheet');
  check('危機時の案内が最初に出ている', /死にたい/.test(await page.textContent('.help-urgent')));
  check('24時間の窓口に直接かけられる',
    (await page.getAttribute('#helpUrgentTel a', 'href')) === 'tel:0120279338');
  check('窓口が種類ごとに分けられている', (await page.$$('#helpList .help-group')).length === 4);
  check('各窓口にも発信ボタンがある', (await page.$$('#helpList .help-tel')).length === 5);
  check('確認日が明記されている', /2026年8月に確認/.test(helpText));
  check('有料の番号は通話料を明示している', /通話料は自己負担/.test(helpText));
  /* 大量に飲んでいた人が急にやめると離脱症状で命に関わることがある。
     この警告だけは絶対に落とさない。 */
  check('離脱症状の警告が出ている',
    /離脱症状/.test(await page.textContent('.help-med')) &&
    /自己判断/.test(await page.textContent('.help-med')));
  check('自助グループ(AA)の案内がある', /アルコホーリクス・アノニマス/.test(helpText));
  check('家族向けの窓口(アラノン)がある', /アラノン/.test(helpText));
  check('専門の窓口に受付時間が書いてある',
    /平日9:00〜17:00/.test(helpText) && /10:30〜15:00/.test(helpText));
  check('減らす選択肢(減酒外来)が案内されている', /減酒外来/.test(helpText));
  /* 外部サイトへ飛ぶとき、どのアプリから来たかを相手に渡さない。 */
  const helpLinks = await page.$$eval('#helpList .help-link',
    els => els.map(e => ({ rel: e.getAttribute('rel'), target: e.getAttribute('target') })));
  check('外部リンクがある', helpLinks.length === 7);
  check('外部リンクは参照元を渡さない', helpLinks.every(l => /noreferrer/.test(l.rel || '')));
  check('外部リンクは別タブで開く', helpLinks.every(l => l.target === '_blank'));
  await page.click('#closeHelp');
  await page.waitForTimeout(300);
  check('相談窓口シートが閉じる', await page.$eval('#helpSheet', el => el.classList.contains('hidden')));

  // ── 15b. sticky指定のトースト(アプリ更新通知など)は自動で消えない ──
  await page.evaluate(() => window.toast('スティッキーテスト', { label: 'ボタン', fn: () => {} }, { sticky: true }));
  await page.waitForTimeout(6500);
  check('sticky指定のトーストは6.5秒待っても消えない', !(await page.$eval('#toast', el => el.classList.contains('hidden'))));
  await page.click('#toast button');
  check('sticky指定のトーストもボタン操作で閉じる', await page.$eval('#toast', el => el.classList.contains('hidden')));

  // ── 15c. 通算チップ: 開始当日(経過0日)は分数表示にならない ──
  await page.evaluate(() => {
    localStorage.setItem('sesshu_v1', JSON.stringify({
      startDate: new Date().toISOString().slice(0, 10),
      drinksPerDay: 3, pricePerDrink: 500, calPerDrink: 150,
      relapses: [], logs: {}, goalDays: 30, reminderOn: false, reminderTime: '21:00', onboarded: true,
    }));
  });
  await page.reload(); await page.waitForTimeout(600);
  check('開始当日は通算が分数表示にならない(0/0を避ける)', !/\//.test(await page.textContent('#chipTotal')));
  check('開始当日は通算0日と表示', (await page.textContent('#chipTotal b')) === '0');

  // ── 15d. 最長記録: 過去に遡って脱線日を追加すると再計算される(旧: 一度上がったら固定されるバグ) ──
  const d = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  await page.evaluate((start) => {
    localStorage.setItem('sesshu_v1', JSON.stringify({
      startDate: start,
      drinksPerDay: 3, pricePerDrink: 500, calPerDrink: 150,
      relapses: [], logs: {}, goalDays: 30, reminderOn: false, reminderTime: '21:00', onboarded: true,
    }));
  }, d(20));
  await page.reload(); await page.waitForTimeout(600);
  check('脱線なし: 最長20日', (await page.textContent('#chipBest b')) === '20');
  await page.evaluate((mid) => {
    const s = JSON.parse(localStorage.getItem('sesshu_v1'));
    s.relapses = [mid];
    localStorage.setItem('sesshu_v1', JSON.stringify(s));
  }, d(10));
  await page.reload(); await page.waitForTimeout(600);
  check('過去に脱線日を追加すると最長記録が正しく再計算される(以前は20日のまま固定されるバグがあった)', (await page.textContent('#chipBest b')) === '10');
  check('連続日数もその脱線日の翌日から数え直される', (await page.textContent('#chipStreak b')) === '9');

  // ── 16. 端末salt・テーマ先読み・マニフェスト ──
  check('deviceSaltが生成・保存される', (await page.evaluate(() => (JSON.parse(localStorage.getItem('sesshu_v1')).deviceSalt || '').length)) >= 8);
  check('生年月日なしでも端末ごとに占いが変わる', await page.evaluate(() => {
    const d = Util.todayStr();
    let diff = false;
    for (let i = 0; i < 30 && !diff; i++) {   // 30日分みれば必ずどこかで差が出る
      const a = Tarot.drawFortune('dev-aaaa', Util.addDays(d, -i));
      const b = Tarot.drawFortune('dev-bbbb', Util.addDays(d, -i));
      if (a.name !== b.name) diff = true;
    }
    return diff;
  }));
  const htmlSrc = await page.evaluate(() => fetch('index.html').then(r => r.text()));
  check('テーマ先読みスクリプトがheadにある', /dataset\.theme/.test(htmlSrc.split('styles.css')[0]));
  const manifests = await page.evaluate(async () => ({
    ja: await fetch('manifest.json').then(r => r.json()),
    en: await fetch('manifest-en.json').then(r => r.json()),
  }));
  check('マニフェストJA: 日本語名のみ', manifests.ja.short_name === '節酒');
  check('マニフェストEN: 英語名のみ', manifests.en.short_name === 'Moderate');
  check('maskableアイコンは専用画像', manifests.ja.icons.some(i => i.purpose === 'maskable' && i.src === 'maskable-512.png'));

  // ── 17. 「今日のアドバイス」: AI表記の削除・断定表現の抑制・コンテンツ量 ──
  const adviceTitle = await page.textContent('.advice-title');
  check('アドバイス見出しから「AI」表記を削除', adviceTitle.trim() === '今日のアドバイス');
  const adviceNote = await page.textContent('.advice-note');
  check('免責文が「診断や治療ではない」旨を明記', adviceNote.includes('診断') && adviceNote.includes('治療'));
  // 「別のアドバイスに切り替え」を12回押しても、豆知識が極端に早く一巡しないことを確認
  // （豆知識プールは26個に拡充済み。直近12個を除外する仕組みなので、12回中は基本的に重複しないはず）
  const seenTrivia = new Set();
  for (let i = 0; i < 12; i++) {
    await page.click('#adviceRefresh');
    await page.waitForTimeout(120);
    const body = await page.textContent('#adviceBody');
    const line = body.split('\n').find(l => l.startsWith('💡'));
    if (line) seenTrivia.add(line);
  }
  check('豆知識: 12回切替で10種類以上出る(量の底上げ確認)', seenTrivia.size >= 10, `size=${seenTrivia.size}`);

  // ── 18. 節酒モデル: 上限判定・週の休肝日・dailyLimit変更時の再判定 ──
  const pageMod = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  pageMod.on('pageerror', e => errors.push('MOD: ' + e.message));
  await pageMod.goto(URL);
  await pageMod.waitForTimeout(400);
  const modStart = new Date(Date.now() - 20 * 86400000).toISOString().slice(0, 10);
  await pageMod.fill('#obStartDate', modStart);
  await pageMod.click('#obNext1');
  await pageMod.fill('#obDrinks', '3');
  await pageMod.fill('#obPrice', '500');
  await pageMod.click('#obNext2');
  await pageMod.fill('#obLimit', '2');
  await pageMod.fill('#obGoal', '30');
  await pageMod.click('#obFinish');
  await pageMod.waitForTimeout(700);
  check('節酒: オンボーディングのdailyLimit入力が反映される',
    (await pageMod.evaluate(() => JSON.parse(localStorage.getItem('sesshu_v1')).dailyLimit)) === 2);

  await pageMod.click('#recordTodayBtn');
  await pageMod.waitForTimeout(200);
  await pageMod.click('#drinkQuick .num-chip[data-drinks="1"]');
  check('節酒: 杯数チップのタップで値が入る',
    (await pageMod.inputValue('#logDrinks')) === '1');
  check('節酒: 上限超えの杯数チップに警告色クラスが付く',
    await pageMod.$eval('#drinkQuick .num-chip[data-drinks="3"]', el => el.classList.contains('over')));
  await pageMod.click('.mood[data-mood="4"]');
  await pageMod.click('#saveLogBtn');
  await pageMod.waitForTimeout(400);
  check('節酒: 上限内(1杯/2杯まで)の記録では継続日数が途切れない',
    Number(await pageMod.textContent('#chipStreak b')) > 0);

  await pageMod.click('.nav-item[data-tab="stats"]');
  await pageMod.waitForTimeout(300);
  await pageMod.click('#calendar button.cal-cell.today');
  await pageMod.waitForTimeout(200);
  const modDdText = await pageMod.textContent('#dayDetail');
  check('節酒: 日別詳細に記録した杯数が表示される', modDdText.includes('1杯'));
  check('節酒: 上限内の日は「目標を守れた日」の表記', modDdText.includes('目標を守れた日'));

  await pageMod.click('.nav-item[data-tab="home"]');
  await pageMod.waitForTimeout(200);
  await pageMod.click('#relapseBtn');
  await pageMod.waitForTimeout(250);
  check('節酒: スリップシートの杯数初期値がdailyLimit+1(=3)',
    (await pageMod.inputValue('#relapseDrinks')) === '3');
  await pageMod.click('#relapseDaySeg .seg-btn[data-day="1"]'); // 昨日
  await pageMod.fill('#relapseDrinks', '5');
  await pageMod.click('#saveRelapseBtn');
  await pageMod.waitForTimeout(600);
  check('節酒: 上限超え(5杯)を記録すると継続日数がリセットされる',
    (await pageMod.textContent('#chipStreak b')) === '0');

  await pageMod.click('#settingsBtn');
  await pageMod.waitForTimeout(300);
  await pageMod.fill('#dailyLimit', '6');
  await pageMod.click('#saveSettings');
  await pageMod.waitForTimeout(400);
  check('節酒: dailyLimitを緩めると過去の上限超え日が再分類され継続日数が回復する',
    Number(await pageMod.textContent('#chipStreak b')) >= 2);

  check('節酒: 週の休肝日チップが表示されている(weeklyAlcoholFreeGoal>0)',
    !(await pageMod.$eval('#chipWeekly', el => el.hidden)));
  check('節酒: 週の休肝日チップに数値が入っている',
    /\d+/.test(await pageMod.textContent('#chipWeekly')));

  await pageMod.close();

  check('コンソールエラーなし', errors.length === 0);
  if (errors.length) console.log('errors:', errors);
  console.log(failures.length ? `\n✗ ${failures.length} 件失敗` : '\n✓ 全テスト合格');
  await browser.close();
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
