/**
 * 不動産CRM Webアプリ バックエンド（GAS Web App）
 * - スプレッドシートをDBとして読み書きするAPIを提供
 * - 物件登録時にDriveフォルダを自動作成する
 * - CacheServiceで一覧データを短時間キャッシュし、読み込みを高速化する
 *
 * デプロイ後のWeb App URLをフロントエンド側 API_BASE に設定して使用する。
 */

var SPREADSHEET_ID = '1u5w-qXrUE6pTOuG-RRq6-Nt_7Y9t-ziVpCKKK7zMw_4';
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
  DriveApp.getRootFolder().getName();
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
    { name: '連絡先マスタ', headers: ['ID', '氏名', 'フリガナ', '電話', 'メール', '住所', '備考', '登録日'] },
    { name: '物件マスタ', headers: ['ID', '物件名', '所在地', '価格', '土地面積', '建物面積', '間取り', '築年数', '売主氏名', '売主メール', '売主電話', '現在ステータス', '備考', '登録日'] },
    { name: 'イベントログ', headers: ['ID', '物件名', '買主氏名', 'ステータス', '日付', '備考'] },
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
 * Drive上に「不動産CRM/02_物件/{物件名}/」配下の標準フォルダ構成を作成する。
 */
function createPropertyFolders_(propertyName) {
  var root = getOrCreateFolder_(DriveApp.getRootFolder(), DRIVE_ROOT_FOLDER_NAME);
  var propertiesRoot = getOrCreateFolder_(root, '02_物件');
  var propertyFolder = getOrCreateFolder_(propertiesRoot, propertyName);

  ['01_売主提出書類', '02_買主提出書類', '03_仲介業者作成書類', '04_AI参照用'].forEach(function (name) {
    getOrCreateFolder_(propertyFolder, name);
  });

  return { id: propertyFolder.getId(), url: propertyFolder.getUrl() };
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
 * 発行先: 物件フォルダ内「03_仲介業者作成書類」
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

/** 物件名から「不動産CRM/02_物件/{物件名}/03_仲介業者作成書類」フォルダを取得する */
function getPropertyDocsFolder_(propertyName) {
  var root = getOrCreateFolder_(DriveApp.getRootFolder(), DRIVE_ROOT_FOLDER_NAME);
  var propertiesRoot = getOrCreateFolder_(root, '02_物件');
  var propertyFolder = getOrCreateFolder_(propertiesRoot, propertyName);
  return getOrCreateFolder_(propertyFolder, '03_仲介業者作成書類');
}

/**
 * 物件マスタから該当行を削除し、Drive上の物件フォルダ（不動産CRM/02_物件/{物件名}/）も
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

  var root = getOrCreateFolder_(DriveApp.getRootFolder(), DRIVE_ROOT_FOLDER_NAME);
  var propertiesRoot = getOrCreateFolder_(root, '02_物件');
  var it = propertiesRoot.getFoldersByName(propertyName);
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
