/**
 * 不動産CRM Webアプリ バックエンド（GAS Web App）
 * - スプレッドシートをDBとして読み書きするAPIを提供
 * - 物件登録時にDriveフォルダを自動作成する
 * - CacheServiceで一覧データを短時間キャッシュし、読み込みを高速化する
 *
 * デプロイ後のWeb App URLをフロントエンド側 API_BASE に設定して使用する。
 */

var SPREADSHEET_ID = '1u5w-qXrUE6pTOuG-RRq6-Nt_7Y9t-ziVpCKKK7zMw_4';
// 新規物件フォルダを直接作成する親フォルダ（Drive上の「04_査定・調査中」）。
var PROPERTY_FOLDER_PARENT_ID = '1HwjGBwf74tKJGfjZZe71CWAK9Rpl1KNP';
// 各物件フォルダ内に作成する標準構成。children に同じ形式の要素を追加すると階層化できる。
var PROPERTY_FOLDER_STRUCTURE = [
  {
    name: '00_関係者メモ',
    children: [
      { name: '01_売主様' },
      { name: '02_買主様' },
      { name: '03_行政･士業関係' },
    ],
  },
  {
    name: '01_査定・調査資料',
    children: [
      { name: '00_物件概要' },
      { name: '01_都市計画･建築･道路など' },
      { name: '02_ハザード情報' },
      { name: '03_登記･固定資産情報' },
      { name: '04_ｲﾝﾌﾗ関連' },
      { name: '05_資料写真' },
    ],
  },
  { name: '02_売主資料' },
  {
    name: '03_掲載情報',
    children: [
      { name: 'インフラ' },
      { name: 'ハザード情報' },
      { name: '掲載写真' },
      { name: '掲載動画' },
      { name: '資料写真' },
      { name: '登記関連' },
      { name: '法令による制限等' },
    ],
  },
  { name: '04_契約書類' },
  { name: '05_決済引き渡し書類' },
  { name: '80_AI参照用' },
  { name: '90_引渡後保管書類' },
];
// 以下は一回限りの旧移行処理（setupStatusFolders）でのみ使用する。
var DRIVE_ROOT_FOLDER_NAME = '不動産CRM';
var CACHE_TTL_SEC = 25;

// Googleログイン（Identity Services）用のWebアプリ向けOAuthクライアントID。
// フロントエンド側 config.js の GOOGLE_CLIENT_ID と必ず同じ値にすること。
// TODO: workspace@atae.co.jp の Google Cloud Console で作成したOAuthクライアントIDに置き換える
var GOOGLE_OAUTH_CLIENT_ID = '63165404893-1ss3l82lvbuigor0v0i2c0sc45dkg6gl.apps.googleusercontent.com';

// 書類テンプレート（Googleドキュメント）のID。「不動産CRM/01_テンプレート」フォルダに格納されている。
// テンプレートを差し替える場合は、同フォルダ内のドキュメントをコピーしてIDをここに反映する。
var TEMPLATE_DOC_IDS = {
  '物件概要書': '1yysTjpxI_fumevGdAqhfki1Ica3581q23ZW2jTpd5sU',
  '媒介契約書': '1E7aot9zEURL8a-HuOJFkkDnhfVfGGJP7pOs1CNkwIUU',
  '重要事項説明書': '198bZL7yPdeTVEYXVG8Hzsl94VwnQSYt8U6b2t3nQD9o',
  '売買契約書': '1huSgo5S1WWUhVQoDdAoDJmPwwbT1mxGxRXiWdi75RXs',
};
// 物件のみで発行できる書類 / 物件×買主(取引)が必要な書類
var PROPERTY_ONLY_DOC_TYPES = ['物件概要書', '媒介契約書'];
var TRANSACTION_DOC_TYPES = ['重要事項説明書', '売買契約書'];

/**
 * 権限承認専用の手動実行関数。スクリプトエディタの関数選択プルダウンから
 * これを選んで「実行」すると、Drive/Sheets/Docs への認可ダイアログが出る。
 * エラーは出ない想定（出ても認可自体は進む）。
 */
function manualAuthorizeAll() {
  SpreadsheetApp.openById(SPREADSHEET_ID).getName();
  getPropertyFolderParent_().getName();
  var doc = DocumentApp.create('認可テスト_削除可');
  var docId = doc.getId();
  DriveApp.getFileById(docId).setTrashed(true);
  // Google ID Token検証（authorize_）で使うUrlFetchAppの外部アクセス権限も認可する
  UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=dummy', { muteHttpExceptions: true });
}

/**
 * スプレッドシートの初期セットアップ関数。
 * 初回のみスクリプトエディタから手動実行する。
 * 必要なシートとヘッダー行を作成する。
 */
function setupSheets() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  var sheetDefs = [
    { name: 'ダッシュボード', headers: [] },
    { name: '連絡先マスタ', headers: ['氏名', '種別', 'メールアドレス', '電話番号'] },
    { name: '物件マスタ', headers: ['物件名', '都道府県', '市区町村', '番地', '売主氏名', '売主メール', '売主電話', '登録日', 'Driveフォルダリンク', 'NotebookLM_URL', '現在ステータス', '価格', '面積', '間取り', '特記事項', '出典URL', '取込日'] },
    { name: 'イベントログ', headers: ['物件名', '買主氏名', 'イベント種別', '日付', 'メモ', '最新フラグ'] },
    { name: '履歴ログ', headers: ['日時', '種別', '内容'] },
    { name: '設定・マスタ', headers: ['種別', '値'] },
    { name: 'Authシート', headers: ['メールアドレス', '権限', '有効'] },
  ];

  sheetDefs.forEach(function(def) {
    var sheet = ss.getSheetByName(def.name);
    if (!sheet) {
      sheet = ss.insertSheet(def.name);
    }
    if (def.headers.length > 0 && sheet.getLastRow() === 0) {
      sheet.appendRow(def.headers);
      sheet.getRange(1, 1, 1, def.headers.length).setFontWeight('bold');
    }
  });

  // デフォルトの「シート1」を削除
  var defaultSheet = ss.getSheetByName('シート1');
  if (defaultSheet) ss.deleteSheet(defaultSheet);

  // Authシートに管理者アカウントを追加
  var authSheet = ss.getSheetByName('Authシート');
  if (authSheet.getLastRow() <= 1) {
    authSheet.appendRow(['workspace@atae.co.jp', 'admin', 'TRUE']);
  }

  Logger.log('シートのセットアップが完了しました。');
}

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  try {
    var params = e.parameter || {};
    var body = {};
    if (e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); } catch (err) { body = {}; }
    }

    var idToken = body.idToken || params.idToken;
    var auth = authorize_(idToken);
    if (!auth.ok) {
      return jsonOutput_({ ok: false, error: auth.error, authError: true });
    }

    var action = params.action || body.action;
    var result;
    switch (action) {
      case 'whoAmI':
        result = { email: auth.email, name: auth.name };
        break;
      case 'bootstrap':
        result = getBootstrap_();
        break;
      case 'listProperties':
        result = listProperties_();
        break;
      case 'listContacts':
        result = listContacts_();
        break;
      case 'listTransactions':
        result = listTransactions_();
        break;
      case 'listEvents':
        result = listEvents_();
        break;
      case 'dashboard':
        result = getDashboard_();
        break;
      case 'createContact':
        result = createContact_(body.payload);
        break;
      case 'createProperty':
        result = createProperty_(body.payload);
        break;
      case 'createTransaction':
      case 'addEvent':
        result = addEvent_(body.payload);
        break;
      case 'updateProperties':
        result = updatePropertiesBatch_(body.payload);
        break;
      case 'updateContacts':
        result = updateContactsBatch_(body.payload);
        break;
      case 'updateTransactions':
        result = updateTransactionsBatch_(body.payload);
        break;
      case 'clearCache':
        result = clearCache_();
        break;
      case 'generateDocument':
        result = generateDocument_(body.payload);
        break;
      case 'deleteProperty':
        result = deleteProperty_(body.payload);
        break;
      case 'deleteContact':
        result = deleteContact_(body.payload);
        break;
      case 'deleteTransaction':
        result = deleteTransaction_(body.payload);
        break;
      default:
        return jsonOutput_({ ok: false, error: 'unknown action: ' + action });
    }
    return jsonOutput_({ ok: true, data: result });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err) });
  }
}

/**
 * フロントエンドから送られてきたGoogle ID Token（Identity Servicesでのログインで取得）を
 * Googleのtokeninfoエンドポイントで検証し、Authシートの許可リストと照合する。
 * GitHub Pages自体は誰でも閲覧できる静的サイトのため、実際のアクセス制御は
 * このAPI呼び出しごとの検証で行う。
 */
function authorize_(idToken) {
  if (!idToken) return { ok: false, error: 'ログインが必要です' };

  var cache = getCache_();
  var cacheKey = 'auth_' + idToken.slice(-30);
  var cached = cache.get(cacheKey);
  if (cached) {
    try { return JSON.parse(cached); } catch (e) { /* fallthrough */ }
  }

  var resp;
  try {
    resp = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
  } catch (err) {
    return { ok: false, error: 'トークンの検証に失敗しました' };
  }
  if (resp.getResponseCode() !== 200) {
    return { ok: false, error: 'ログインの有効期限が切れています。再度ログインしてください' };
  }

  var info = JSON.parse(resp.getContentText());
  if (info.aud !== GOOGLE_OAUTH_CLIENT_ID) {
    return { ok: false, error: 'トークンの発行元が一致しません' };
  }
  var email = info.email;
  if (!email || info.email_verified !== 'true') {
    return { ok: false, error: 'メールアドレスが確認できません' };
  }
  if (!isEmailAuthorized_(email)) {
    return { ok: false, error: 'このGoogleアカウント（' + email + '）には利用権限がありません' };
  }

  var result = { ok: true, email: email, name: info.name || email };
  // 同じトークンでの再検証コストを下げるため、トークン残り有効期間内でキャッシュする
  cache.put(cacheKey, JSON.stringify(result), 300);
  return result;
}

/** Authシートの「メールアドレス」列にあり、「有効」列が有効になっている場合のみ許可する */
function isEmailAuthorized_(email) {
  var sheet = getSS_().getSheetByName('Authシート');
  if (!sheet) return false;
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var emailCol = headers.indexOf('メールアドレス');
  var activeCol = headers.indexOf('有効');
  if (emailCol === -1) return false;

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (String(row[emailCol]).toLowerCase() === String(email).toLowerCase()) {
      if (activeCol === -1) return true;
      var activeVal = row[activeCol];
      return activeVal === '有効' || activeVal === true || activeVal === 'TRUE';
    }
  }
  return false;
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSS_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getCache_() {
  return CacheService.getScriptCache();
}

function clearCache_() {
  getCache_().removeAll(['properties', 'contacts', 'events', 'transactions', 'activity']);
  return { cleared: true };
}

/**
 * 物件・顧客・取引の登録／更新／削除を「履歴ログ」に記録する。
 * 内容（content）は「○○が物件一覧に追加されました」のような完成した説明文として
 * 呼び出し側で組み立てる。これによりダッシュボードの「直近の履歴」に
 * すべての更新作業が一貫した形式で表示される。
 */
function logActivity_(type, content) {
  var sheet = getSS_().getSheetByName('履歴ログ');
  var timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  sheet.appendRow([timestamp, type, content || '']);
}

function listActivity_() {
  return cached_('activity', function () { return sheetToObjects_('履歴ログ'); });
}

function cached_(key, fn) {
  var cache = getCache_();
  var hit = cache.get(key);
  if (hit) {
    try { return JSON.parse(hit); } catch (e) { /* fallthrough */ }
  }
  var data = fn();
  try {
    cache.put(key, JSON.stringify(data), CACHE_TTL_SEC);
  } catch (e) {
    // キャッシュサイズ上限(100KB)を超える場合は黙ってスキップ
  }
  return data;
}

function sheetToObjects_(sheetName) {
  var sheet = getSS_().getSheetByName(sheetName);
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (row.join('') === '') continue;
    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var v = row[j];
      if (Object.prototype.toString.call(v) === '[object Date]') v = formatDate_(v);
      obj[headers[j]] = v;
    }
    obj.__row = i + 1; // 1-indexed シート行番号（更新時に使用）
    rows.push(obj);
  }
  return rows;
}

function formatDate_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd');
}

function listProperties_() {
  return cached_('properties', function () { return sheetToObjects_('物件マスタ'); });
}

function listContacts_() {
  return cached_('contacts', function () { return sheetToObjects_('連絡先マスタ'); });
}

function listEvents_() {
  return cached_('events', function () { return sheetToObjects_('イベントログ'); });
}

/**
 * イベントログを「物件名×買主氏名」でグルーピングし、取引単位の一覧に変換する。
 * 物件と買主は1対1ではないため、取引（商談）を独立した概念として扱う。
 */
function listTransactions_() {
  return cached_('transactions', function () {
    var events = sheetToObjects_('イベントログ');
    var groups = {};
    events.forEach(function (e) {
      if (!e['買主氏名']) return; // 買主未確定の物件全体イベントは取引には含めない
      var key = e['物件名'] + '___' + e['買主氏名'];
      if (!groups[key]) {
        groups[key] = { 物件名: e['物件名'], 買主氏名: e['買主氏名'], events: [] };
      }
      groups[key].events.push(e);
    });
    return Object.keys(groups).map(function (key) {
      var g = groups[key];
      var sorted = g.events.slice().sort(function (a, b) { return new Date(b['日付']) - new Date(a['日付']); });
      var latest = sorted[0];
      return {
        物件名: g.物件名,
        買主氏名: g.買主氏名,
        現在ステータス: latest['イベント種別'],
        最終更新日: latest['日付'],
        メモ: latest['メモ'] || '',
        __row: latest.__row, // 直近の更新が反映された行番号（並び替えの「新しい順」に使用）
      };
    });
  });
}

function getBootstrap_() {
  return {
    properties: listProperties_(),
    contacts: listContacts_(),
    transactions: listTransactions_(),
    recentEvents: recentEvents_(),
    stats: getDashboardStats_(),
  };
}

/**
 * 「履歴ログ」から直近の更新履歴を返す（日時降順）。物件・顧客・取引の
 * 登録/更新/削除のすべてがこの1シートに一貫した形式（日時・種別・内容）で記録されている。
 */
function recentEvents_() {
  return listActivity_().slice().sort(function (a, b) {
    return new Date(b['日時']) - new Date(a['日時']);
  }).slice(0, 15);
}

/**
 * 「ダッシュボード」シートに設定済みの集計関数（取扱物件数・進行中の取引件数・顧客数）の
 * 計算結果を読み取って返す。集計そのものはスプレッドシートの関数で行い、GAS側では
 * 再計算しない（スプレッドシートを単一の真実とするため）。
 */
function getDashboardStats_() {
  var sheet = getSS_().getSheetByName('ダッシュボード');
  var lastRow = sheet.getLastRow();
  if (lastRow === 0) return { propertyCount: 0, activeTransactionCount: 0, contactCount: 0 };
  var values = sheet.getRange(1, 1, lastRow, 2).getValues();
  var map = {};
  values.forEach(function (row) { map[row[0]] = row[1]; });
  return {
    propertyCount: map['取扱物件数'] || 0,
    activeTransactionCount: map['進行中の取引件数'] || 0,
    contactCount: map['顧客数'] || 0,
  };
}

function getDashboard_() {
  return { stats: getDashboardStats_(), recentEvents: recentEvents_() };
}

function createContact_(payload) {
  if (!payload || !payload['氏名']) throw new Error('氏名は必須です');
  var sheet = getSS_().getSheetByName('連絡先マスタ');
  sheet.appendRow([
    payload['氏名'],
    payload['種別'] || '',
    payload['メールアドレス'] || '',
    normalizePhone_(payload['電話番号']),
  ]);
  logActivity_('顧客登録', payload['氏名'] + '様が顧客一覧に追加されました（' + (payload['種別'] || '種別未設定') + '）');
  clearCache_();
  return { created: true, 氏名: payload['氏名'] };
}

/** 電話番号は数字とハイフンのみに限定する（単位の概念が無いため自動付与は行わない） */
function normalizePhone_(value) {
  if (!value) return '';
  return String(value).replace(/[^0-9\-]/g, '');
}

function ensurePropertyExtraColumns_() {
  var sheet = getSS_().getSheetByName('物件マスタ');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var extra = ['価格', '面積', '間取り', '特記事項', '出典URL', '取込日'];
  var missing = extra.filter(function (h) { return headers.indexOf(h) === -1; });
  if (missing.length > 0) {
    sheet.getRange(1, headers.length + 1, 1, missing.length).setValues([missing]);
  }
}

function createProperty_(payload) {
  if (!payload || !payload['物件名']) throw new Error('物件名は必須です');
  var propertyName = payload['物件名'];

  ensurePropertyExtraColumns_();

  var skipFolder = payload['_skipFolderCreation'] === true;
  var folderInfo = skipFolder ? { url: payload['Driveフォルダリンク'] || '' } : createPropertyFolders_(propertyName);

  // 列構成（A〜Q、計17列）: 物件名,都道府県,市区町村,番地,売主氏名,売主メール(参照),
  // 売主電話(参照),登録日,Driveフォルダリンク,NotebookLM_URL,現在ステータス(自動),
  // 価格,面積,間取り,特記事項,出典URL,取込日
  var sheet = getSS_().getSheetByName('物件マスタ');
  var today = formatDate_(new Date());
  sheet.appendRow([
    propertyName,
    payload['都道府県'] || '',
    payload['市区町村'] || '',
    payload['番地'] || '',
    payload['売主氏名'] || '',
    '',
    '',
    today,
    folderInfo.url,
    '（未作成）',
    '',
    payload['価格'] || '',
    payload['面積'] || '',
    payload['間取り'] || '',
    payload['特記事項'] || '',
    payload['出典URL'] || '',
    payload['出典URL'] ? today : '',
  ]);

  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 6).setFormula(
    '=IFERROR(VLOOKUP(E' + lastRow + ',連絡先マスタ!$A:$D,3,FALSE),"")'
  );
  sheet.getRange(lastRow, 7).setFormula(
    '=IFERROR(VLOOKUP(E' + lastRow + ',連絡先マスタ!$A:$D,4,FALSE),"")'
  );
  sheet.getRange(lastRow, 11).setFormula(
    '=IFERROR(QUERY(\'イベントログ\'!$A$2:$F$300,"select C where A=\'"&A' + lastRow + '&"\' order by D desc limit 1"),"問い合わせ前")'
  );

  logActivity_('物件登録', propertyName + 'が物件一覧に追加されました');
  clearCache_();
  return { created: true, 物件名: propertyName, folderUrl: folderInfo.url };
}

function addEvent_(payload) {
  if (!payload || !payload['物件名'] || !payload['イベント種別'] || !payload['日付']) {
    throw new Error('物件名・イベント種別・日付は必須です');
  }
  var sheet = getSS_().getSheetByName('イベントログ');
  sheet.appendRow([
    payload['物件名'],
    payload['買主氏名'] || '',
    payload['イベント種別'],
    payload['日付'],
    payload['メモ'] || '',
    '',
  ]);
  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 6).setFormula(
    '=IF(AND(B' + lastRow + '<>"",D' + lastRow + '=MAXIFS($D$2:$D$300,$A$2:$A$300,A' + lastRow + ',$B$2:$B$300,B' + lastRow + ')),"●","")'
  );

  var buyerLabel = payload['買主氏名'] ? payload['買主氏名'] + '様 × ' : '';
  logActivity_('取引登録', buyerLabel + payload['物件名'] + ' の取引が登録されました（' + payload['イベント種別'] + '）');
  clearCache_();
  return { created: true };
}

/** ヘッダー名 -> 列番号(1-indexed) のマップを返す */
function headerIndexMap_(sheet) {
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var map = {};
  headers.forEach(function (h, i) { map[h] = i + 1; });
  return map;
}

/**
 * keyHeader（例: '物件名'）の値で行を特定し、fields（{ヘッダー名: 値}）を一括反映する。
 * updates: [{ key: '物件名の値', fields: { 都道府県: '...', ... } }, ...]
 */
function updateRowsByKey_(sheetName, keyHeader, updates) {
  var sheet = getSS_().getSheetByName(sheetName);
  var map = headerIndexMap_(sheet);
  var keyCol = map[keyHeader];
  if (!keyCol) throw new Error(keyHeader + ' 列が見つかりません');

  var rowIndexByKey = {};
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    sheet.getRange(2, keyCol, lastRow - 1, 1).getValues().forEach(function (row, i) {
      rowIndexByKey[row[0]] = i + 2;
    });
  }

  var updatedCount = 0;
  updates.forEach(function (u) {
    var rowNum = rowIndexByKey[u.key];
    if (!rowNum) return; // 該当なしは無視（クライアント側のキー不整合対策）
    Object.keys(u.fields || {}).forEach(function (header) {
      var col = map[header];
      if (!col) return; // 数式列・存在しない列名は無視（安全側）
      sheet.getRange(rowNum, col).setValue(u.fields[header]);
    });
    updatedCount++;
  });

  return { updatedCount: updatedCount };
}

function updatePropertiesBatch_(payload) {
  if (!payload || !payload.updates) throw new Error('updates は必須です');
  var result = updateRowsByKey_('物件マスタ', '物件名', payload.updates);
  payload.updates.forEach(function (u) {
    var fieldNames = Object.keys(u.fields || {}).join('、');
    logActivity_('物件情報更新', u.key + 'の情報が更新されました' + (fieldNames ? '（' + fieldNames + '）' : ''));
  });
  clearCache_();
  return result;
}

function updateContactsBatch_(payload) {
  if (!payload || !payload.updates) throw new Error('updates は必須です');
  payload.updates.forEach(function (u) {
    if (u.fields && '電話番号' in u.fields) {
      u.fields['電話番号'] = normalizePhone_(u.fields['電話番号']);
    }
  });
  var result = updateRowsByKey_('連絡先マスタ', '氏名', payload.updates);
  payload.updates.forEach(function (u) {
    var fieldNames = Object.keys(u.fields || {}).join('、');
    logActivity_('顧客情報更新', u.key + '様の情報が更新されました' + (fieldNames ? '（' + fieldNames + '）' : ''));
  });
  clearCache_();
  return result;
}

/**
 * 取引のステータス変更は「新しいイベント行を追記する」ことで実現する
 * （履歴を保持したまま現在ステータスを更新するため、上書きではなく追記）。
 * updates: [{ 物件名, 買主氏名, ステータス, メモ }, ...]
 */
function updateTransactionsBatch_(payload) {
  if (!payload || !payload.updates) throw new Error('updates は必須です');
  var sheet = getSS_().getSheetByName('イベントログ');
  var today = formatDate_(new Date());
  payload.updates.forEach(function (u) {
    sheet.appendRow([u['物件名'], u['買主氏名'], u['ステータス'], today, u['メモ'] || '', '']);
    var lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 6).setFormula(
      '=IF(AND(B' + lastRow + '<>"",D' + lastRow + '=MAXIFS($D$2:$D$300,$A$2:$A$300,A' + lastRow + ',$B$2:$B$300,B' + lastRow + ')),"●","")'
    );
    logActivity_('取引ステータス更新', u['買主氏名'] + '様 × ' + u['物件名'] + ' の取引ステータスが「' + u['ステータス'] + '」に更新されました');
  });
  clearCache_();
  return { updatedCount: payload.updates.length };
}

/**
 * Drive上の指定親フォルダ直下に「{物件名}/」と標準サブフォルダ構成を作成する。
 */
function createPropertyFolders_(propertyName) {
  var propertyFolder = getOrCreateFolder_(getPropertyFolderParent_(), propertyName);
  ensureFolderStructure_(propertyFolder, PROPERTY_FOLDER_STRUCTURE);

  return { id: propertyFolder.getId(), url: propertyFolder.getUrl() };
}

function ensureFolderStructure_(parent, structure) {
  (structure || []).forEach(function (node) {
    var folder = getOrCreateFolder_(parent, node.name);
    if (node.children && node.children.length > 0) {
      ensureFolderStructure_(folder, node.children);
    }
  });
}

function getPropertyFolderParent_() {
  try {
    return DriveApp.getFolderById(PROPERTY_FOLDER_PARENT_ID);
  } catch (err) {
    throw new Error('物件フォルダの作成先にアクセスできません: ' + PROPERTY_FOLDER_PARENT_ID);
  }
}

function getOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

/**
 * 物件名（必須）・買主氏名（取引系の書類のみ必須）・docType から、
 * テンプレートをコピーし、プレースホルダを実データで置換した書類をDriveに発行する。
 *
 * 発行先: 物件フォルダ内「04_契約書類」
 * 命名規則: [物件名]_[ドキュメント種別]_[YYYYMMDD]_v1
 */
function generateDocument_(payload) {
  if (!payload || !payload['物件名'] || !payload['docType']) {
    throw new Error('物件名・docType は必須です');
  }
  var docType = payload['docType'];
  var templateId = TEMPLATE_DOC_IDS[docType];
  if (!templateId) throw new Error('未対応の書類種別です: ' + docType);

  var isTransactionDoc = TRANSACTION_DOC_TYPES.indexOf(docType) !== -1;
  if (isTransactionDoc && !payload['買主氏名']) {
    throw new Error(docType + ' の発行には買主氏名が必要です');
  }

  var property = findRowByKey_('物件マスタ', '物件名', payload['物件名']);
  if (!property) throw new Error('物件が見つかりません: ' + payload['物件名']);

  var docsFolder = getPropertyDocsFolder_(payload['物件名']);
  var today = formatDate_(new Date());
  var fileName = payload['物件名'] + '_' + docType + '_' + today.replace(/-/g, '') + '_v1';

  var copy = DriveApp.getFileById(templateId).makeCopy(fileName, docsFolder);

  var placeholders = {
    '物件名': property['物件名'] || '',
    '都道府県': property['都道府県'] || '',
    '市区町村': property['市区町村'] || '',
    '番地': property['番地'] || '',
    '価格': property['価格'] || '',
    '面積': property['面積'] || '',
    '間取り': property['間取り'] || '',
    '特記事項': property['特記事項'] || '',
    '売主氏名': property['売主氏名'] || '',
    '担当者氏名': '加瀬',
    '発行日': today,
    '買主氏名': payload['買主氏名'] || '',
  };

  var doc = DocumentApp.openById(copy.getId());
  var body = doc.getBody();
  Object.keys(placeholders).forEach(function (key) {
    // body.replaceText は第一引数を正規表現として解釈するため、{{ }} 等のメタ文字をエスケープする
    var pattern = escapeRegex_('{{' + key + '}}');
    var safeValue = String(placeholders[key]).replace(/\$/g, '$$$$');
    body.replaceText(pattern, safeValue);
  });
  doc.saveAndClose();

  return { created: true, docType: docType, fileName: fileName, url: copy.getUrl() };
}

function escapeRegex_(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 指定シートで keyHeader 列の値が key と一致する最初の行をオブジェクトとして返す */
function findRowByKey_(sheetName, keyHeader, key) {
  var rows = sheetToObjects_(sheetName);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][keyHeader] === key) return rows[i];
  }
  return null;
}

/** 物件名から指定親フォルダ直下の「{物件名}/04_契約書類」を取得する */
function getPropertyDocsFolder_(propertyName) {
  var propertyFolder = getOrCreateFolder_(getPropertyFolderParent_(), propertyName);
  ensureFolderStructure_(propertyFolder, PROPERTY_FOLDER_STRUCTURE);
  return getOrCreateFolder_(propertyFolder, '04_契約書類');
}

/**
 * 物件マスタから該当行を削除し、指定親フォルダ直下の物件フォルダ（{物件名}/）も
 * ゴミ箱に移動する。フォルダを丸ごとtrashedにするため、配下の01〜04サブフォルダ・書類も含めて削除される。
 * イベントログ等の履歴行は削除しない（物件名のテキストだけが残り、履歴として参照可能）。
 */
function deleteProperty_(payload) {
  if (!payload || !payload['物件名']) throw new Error('物件名は必須です');
  var propertyName = payload['物件名'];

  var sheet = getSS_().getSheetByName('物件マスタ');
  var map = headerIndexMap_(sheet);
  var keyCol = map['物件名'];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('物件が見つかりません: ' + propertyName);
  var keyValues = sheet.getRange(2, keyCol, lastRow - 1, 1).getValues();
  var rowNum = null;
  for (var i = 0; i < keyValues.length; i++) {
    if (keyValues[i][0] === propertyName) { rowNum = i + 2; break; }
  }
  if (!rowNum) throw new Error('物件が見つかりません: ' + propertyName);

  sheet.deleteRow(rowNum);

  var it = getPropertyFolderParent_().getFoldersByName(propertyName);
  var folderDeleted = false;
  if (it.hasNext()) {
    it.next().setTrashed(true);
    folderDeleted = true;
  }

  logActivity_('物件削除', propertyName + 'が削除されました（Driveフォルダも削除）');
  clearCache_();
  return { deleted: true, 物件名: propertyName, folderDeleted: folderDeleted };
}

/** 連絡先マスタから該当行を削除する（Drive操作は無し） */
function deleteContact_(payload) {
  if (!payload || !payload['氏名']) throw new Error('氏名は必須です');
  var name = payload['氏名'];
  var sheet = getSS_().getSheetByName('連絡先マスタ');
  var map = headerIndexMap_(sheet);
  var keyCol = map['氏名'];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('顧客が見つかりません: ' + name);
  var keyValues = sheet.getRange(2, keyCol, lastRow - 1, 1).getValues();
  var rowNum = null;
  for (var i = 0; i < keyValues.length; i++) {
    if (keyValues[i][0] === name) { rowNum = i + 2; break; }
  }
  if (!rowNum) throw new Error('顧客が見つかりません: ' + name);
  sheet.deleteRow(rowNum);

  logActivity_('顧客削除', name + '様が顧客一覧から削除されました');
  clearCache_();
  return { deleted: true, 氏名: name };
}

/**
 * 取引（物件名×買主氏名）に紐づくイベントログの全行を削除する。
 * 履歴も含めて取引そのものを消す操作のため、利用前に必ず確認を取ること。
 */
function deleteTransaction_(payload) {
  if (!payload || !payload['物件名'] || !payload['買主氏名']) {
    throw new Error('物件名・買主氏名は必須です');
  }
  var propertyName = payload['物件名'];
  var buyerName = payload['買主氏名'];

  var sheet = getSS_().getSheetByName('イベントログ');
  var values = sheet.getDataRange().getValues();
  var deletedCount = 0;
  // 末尾から走査して削除することで、行番号のズレを避ける
  for (var i = values.length - 1; i >= 1; i--) {
    if (values[i][0] === propertyName && values[i][1] === buyerName) {
      sheet.deleteRow(i + 1);
      deletedCount++;
    }
  }

  logActivity_('取引削除', buyerName + '様 × ' + propertyName + ' の取引が削除されました（' + deletedCount + '件のイベントを削除）');
  clearCache_();
  return { deleted: true, deletedCount: deletedCount };
}

/**
 * 既存の6件の物件フォルダを CRM に取り込む一回限りの移行関数。
 * スクリプトエディタから手動で1度だけ実行する。
 * 実行前に manualAuthorizeAll で権限を付与しておくこと。
 *
 * 処理内容:
 * 1. 各シートのヘッダー行を正しい列構成に修正（setupSheets実行済みの場合も対応）
 * 2. 6名の売主を連絡先マスタに登録
 * 3. 6件の物件を物件マスタに登録（指定親フォルダ/{物件名}/ を自動作成）
 * 4. 既存フォルダ内の書類を 02_売主資料/ に移動
 */
function importExistingData() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // ヘッダーが旧スキーマの場合は修正する
  function fixHeaders(sheetName, correctHeaders) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet || correctHeaders.length === 0) return;
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(correctHeaders);
      sheet.getRange(1, 1, 1, correctHeaders.length).setFontWeight('bold');
      return;
    }
    var currentFirst = sheet.getRange(1, 1).getValue();
    if (currentFirst !== correctHeaders[0]) {
      sheet.getRange(1, 1, 1, sheet.getLastColumn()).clearContent();
      sheet.getRange(1, 1, 1, correctHeaders.length).setValues([correctHeaders]);
      sheet.getRange(1, 1, 1, correctHeaders.length).setFontWeight('bold');
      Logger.log(sheetName + ' のヘッダーを修正しました');
    }
  }

  fixHeaders('物件マスタ',   ['物件名', '都道府県', '市区町村', '番地', '売主氏名', '売主メール', '売主電話', '登録日', 'Driveフォルダリンク', 'NotebookLM_URL', '現在ステータス', '価格', '面積', '間取り', '特記事項', '出典URL', '取込日']);
  fixHeaders('連絡先マスタ', ['氏名', '種別', 'メールアドレス', '電話番号']);
  fixHeaders('イベントログ', ['物件名', '買主氏名', 'イベント種別', '日付', 'メモ', '最新フラグ']);

  var properties = [
    {
      物件名: '大田市温泉津町_小川商店',
      都道府県: '島根県', 市区町村: '大田市温泉津町温泉津', 番地: 'ロ22番2',
      売主氏名: '有限会社小川商店',
      面積: '土地138.83㎡ 建物176.01㎡', 特記事項: '木造瓦葺2階建 昭和55年築',
      sourceFolderId: '1WvllTOSYeCiyuzLPJKQDUu5pgmjJskhz',
      contact: { 氏名: '有限会社小川商店', 種別: '売主（法人）' },
    },
    {
      物件名: '出雲市大社町中荒木_飯塚',
      都道府県: '島根県', 市区町村: '出雲市大社町中荒木', 番地: '2617-38',
      売主氏名: '飯塚誠司',
      面積: '土地640.68㎡', 特記事項: '宅地（借地・地代あり）',
      sourceFolderId: '1LOZfvx23HVTPy7cPDv1zk1OZ0vIAdsqf',
      contact: { 氏名: '飯塚誠司', 種別: '売主' },
    },
    {
      物件名: '大田市川合町川合_古川',
      都道府県: '島根県', 市区町村: '大田市川合町川合', 番地: '1571番地',
      売主氏名: '古川恵子',
      面積: '土地195.74㎡ 建物117.17㎡', 特記事項: '木造瓦葺2階建 昭和51年築',
      sourceFolderId: '1I7AdjFpYTDuxLEZSp1i3-S75Q3bx9R_m',
      contact: { 氏名: '古川恵子', 種別: '売主' },
    },
    {
      物件名: '松江市鹿島町武代_山本',
      都道府県: '島根県', 市区町村: '松江市鹿島町武代', 番地: '208-3',
      売主氏名: '山本英雄',
      面積: '土地1770.60㎡ 建物1206.67㎡', 特記事項: '鉄骨造 事務所64㎡＋工場1142.67㎡',
      sourceFolderId: '1a8CQZEF6tN0cD5Gau3Oj9Qc9Cz1xz0Ja',
      contact: { 氏名: '山本英雄', 種別: '売主' },
    },
    {
      物件名: '出雲市大社町杵築南_吉田',
      都道府県: '島根県', 市区町村: '出雲市大社町杵築南', 番地: '1531番地',
      売主氏名: '吉田光',
      面積: '土地390.70㎡ 建物165.10㎡', 特記事項: '木造平家 昭和44年築（旧名義：吉田武弘）',
      sourceFolderId: '1VFfXHGjnmXH1oZlIG4LTrgeQKcugOR_n',
      contact: { 氏名: '吉田光', 種別: '売主' },
    },
    {
      物件名: '松江市宍道町佐々布_佐藤',
      都道府県: '島根県', 市区町村: '松江市宍道町佐々布', 番地: '553-1',
      売主氏名: '佐藤由美子',
      面積: '土地452.34㎡ 建物236.75㎡', 特記事項: '鉄骨造亜鉛メッキ鋼板葺2階建 昭和48年築',
      sourceFolderId: '1CR6pxKiaqX_vOOPViU8TFeoLnEDrZwmo',
      contact: { 氏名: '佐藤由美子', 種別: '売主' },
    },
  ];

  properties.forEach(function(item) {
    // 連絡先マスタに売主を登録
    try {
      createContact_(item.contact);
      Logger.log('連絡先登録: ' + item.contact['氏名']);
    } catch (e) {
      Logger.log('連絡先登録エラー ' + item.contact['氏名'] + ': ' + e.message);
    }

    // 物件マスタに登録（指定親フォルダ/{物件名}/ を自動作成）
    try {
      createProperty_({
        物件名: item.物件名,
        都道府県: item.都道府県,
        市区町村: item.市区町村,
        番地: item.番地,
        売主氏名: item.売主氏名,
        面積: item.面積,
        特記事項: item.特記事項,
      });
      Logger.log('物件登録: ' + item.物件名);

      // 既存フォルダの書類を 02_売主資料/ に移動
      var sourceFolder = DriveApp.getFolderById(item.sourceFolderId);
      var propertyFolder = getOrCreateFolder_(getPropertyFolderParent_(), item.物件名);
      var destFolder = getOrCreateFolder_(propertyFolder, '02_売主資料');

      var files = sourceFolder.getFiles();
      while (files.hasNext()) { files.next().moveTo(destFolder); }
      var subFolders = sourceFolder.getFolders();
      while (subFolders.hasNext()) { subFolders.next().moveTo(destFolder); }
      Logger.log('書類移動完了: ' + item.物件名);
    } catch (e) {
      Logger.log('エラー ' + item.物件名 + ': ' + e.message);
    }
  });

  Logger.log('importExistingData 完了');
}

/**
 * 【一回限り】01.スローライフ/01_物件情報/ から13件の物件を一括でCRMに登録する。
 * - 物件マスタへの追加
 * - 指定親フォルダ/{物件名}/ の標準フォルダ構成を作成
 * - イベントログに初期ステータスを記録
 * 既に登録済みの物件名はスキップする。
 */
function bulkImportFromSlowlife() {
  var properties = [
    // 01_引き渡し準備中
    { 物件名: '1870_松江市古曽志町_松近様',            ステータス: '引き渡し準備中' },
    { 物件名: '1903_出雲市多伎町_川上様',              ステータス: '引き渡し準備中' },
    { 物件名: '1945_松江市手角町_佐々木様',            ステータス: '引き渡し準備中' },
    { 物件名: '松江市上乃木八丁目_今井様(リバティハウス)', ステータス: '引き渡し準備中' },
    // 02_販売中
    { 物件名: '1814_出雲市大社町_金築様',              ステータス: '販売中' },
    { 物件名: '1864店舗_松江市島根町_高井様',          ステータス: '販売中' },
    { 物件名: '1872_安来市安来町_服部様',              ステータス: '販売中' },
    { 物件名: '1883松江市奥谷町_井川様',               ステータス: '販売中' },
    { 物件名: '1890居宅_松江市島根町_高井様',          ステータス: '販売中' },
    { 物件名: '1916_松江市宍道町_小豆澤様',            ステータス: '販売中' },
    { 物件名: '1923_松江市東出雲町_日置様',            ステータス: '販売中' },
    // 03_掲載準備中
    { 物件名: '出雲市岡田町_土江様',                   ステータス: '掲載準備中' },
    { 物件名: '出雲市多伎町小田_石飛様',               ステータス: '掲載準備中' },
  ];

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var propSheet  = ss.getSheetByName('物件マスタ');
  var eventSheet = ss.getSheetByName('イベントログ');
  var today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');

  var existingNames = propSheet.getDataRange().getValues().slice(1).map(function(r) { return r[0]; });

  properties.forEach(function(p) {
    if (existingNames.indexOf(p.物件名) !== -1) {
      Logger.log('スキップ（登録済み）: ' + p.物件名);
      return;
    }
    try {
      createProperty_({ 物件名: p.物件名, 特記事項: 'スローライフフォルダからの移行' });
      eventSheet.appendRow([p.物件名, '', p.ステータス, today, 'スローライフフォルダからの移行', true]);
      Logger.log('登録完了: ' + p.物件名 + ' [' + p.ステータス + ']');
    } catch (e) {
      Logger.log('エラー ' + p.物件名 + ': ' + e.message);
    }
  });

  Logger.log('bulkImportFromSlowlife 完了');
}

/**
 * 【一回限り】不動産CRM/02_物件/ の直下に7種類のステータスフォルダを作成し、
 * テストとして「出雲市多伎町小田_石飛様」フォルダを
 * 01.スローライフ/01_物件情報/03_掲載準備中/ から
 * 不動産CRM/02_物件/03_掲載準備中/ へコピーする。
 */
function setupStatusFolders() {
  var STATUS_FOLDERS = [
    '01_引き渡し準備中',
    '02_販売中',
    '03_掲載準備中',
    '04_査定中',
    '05_販売・掲載中止',
    '06_仕入見込',
    '90_大社町グループホーム計画'
  ];

  var TEST_PROPERTY = '出雲市多伎町小田_石飛様';
  var TEST_STATUS   = '03_掲載準備中';

  // ① CRM側: 不動産CRM/02_物件/ 配下にステータスフォルダを作成
  var root = DriveApp.getRootFolder();
  var crmRoot = getOrCreateFolder_(root, DRIVE_ROOT_FOLDER_NAME);
  var propertiesRoot = getOrCreateFolder_(crmRoot, '02_物件');

  STATUS_FOLDERS.forEach(function (name) {
    getOrCreateFolder_(propertiesRoot, name);
    Logger.log('フォルダ確認/作成: ' + name);
  });

  // ② スローライフ側のソースフォルダを探す
  var slowlife = getFolderByPath_(root, ['01.スローライフ', '01_物件情報', TEST_STATUS]);
  if (!slowlife) throw new Error('コピー元が見つかりません: 01.スローライフ/01_物件情報/' + TEST_STATUS);

  var it = slowlife.getFoldersByName(TEST_PROPERTY);
  if (!it.hasNext()) throw new Error('テスト物件フォルダが見つかりません: ' + TEST_PROPERTY);
  var sourceFolder = it.next();

  // ③ CRM側の03_掲載準備中 へコピー
  var destStatusFolder = getOrCreateFolder_(propertiesRoot, TEST_STATUS);
  copyFolderRecursive_(sourceFolder, destStatusFolder, TEST_PROPERTY);

  Logger.log('完了: ステータスフォルダ作成 + ' + TEST_PROPERTY + ' のコピー完了');
}

function getFolderByPath_(root, pathArray) {
  var current = root;
  for (var i = 0; i < pathArray.length; i++) {
    var folders = current.getFoldersByName(pathArray[i]);
    if (!folders.hasNext()) return null;
    current = folders.next();
  }
  return current;
}

function copyFolderRecursive_(srcFolder, destParent, folderName) {
  var destFolder = getOrCreateFolder_(destParent, folderName || srcFolder.getName());
  var files = srcFolder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    f.makeCopy(f.getName(), destFolder);
  }
  var subFolders = srcFolder.getFolders();
  while (subFolders.hasNext()) {
    var sub = subFolders.next();
    copyFolderRecursive_(sub, destFolder, sub.getName());
  }
}
