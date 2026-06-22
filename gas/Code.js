/**
 * 不動産CRM Webアプリ バックエンド（GAS Web App）
 * - スプレッドシートをDBとして読み書きするAPIを提供
 * - 物件登録時にDriveフォルダを自動作成する
 * - CacheServiceで一覧データを短時間キャッシュし、読み込みを高速化する
 *
 * デプロイ後のWeb App URLをフロントエンド側 API_BASE に設定して使用する。
 */

var SPREADSHEET_ID = '1ziEXI1l_5JkiPOuV5vbU4e8-RuH5-XCcV61x8loO-DY';
var DRIVE_ROOT_FOLDER_NAME = '不動産CRM';
var CACHE_TTL_SEC = 25;

// Googleログイン（Identity Services）用のWebアプリ向けOAuthクライアントID。
// フロントエンド側 config.js の GOOGLE_CLIENT_ID と必ず同じ値にすること。
var GOOGLE_OAUTH_CLIENT_ID = '367609792965-21jmcs72jt889tsanc6p651859h7n6p2.apps.googleusercontent.com';

// 書類テンプレート（Googleドキュメント）のID。「不動産CRM/01_テンプレート」フォルダに格納されている。
// テンプレートを差し替える場合は、同フォルダ内のドキュメントをコピーしてIDをここに反映する。
var TEMPLATE_DOC_IDS = {
  '物件概要書': '1PK9hXne3kIsrOlu_pzJhwuP46Z5Gkp2jpsKXPM98Iik',
  '媒介契約書': '1zBYhECZYL_6h_mRCmI6bnNiRdUw0xQaYMvOnOx71GNo',
  '重要事項説明書': '1KgSrrLgCjadlcwRODrkX35SbjrwpomSBlL_XXMFHOi4',
  '売買契約書': '1J4P8Q4KjWqjFzSd3Tr5H50OdDLqrshc2wcDCyjmNmS8',
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
 * 物件・顧客の登録／更新／削除など、取引ステータス変更以外の操作を「対応履歴ログ」に記録する。
 * これによりダッシュボードの「直近イベント」に、ステータス更新だけでなく全ての更新作業が表示される。
 */
function logActivity_(type, target, detail) {
  var sheet = getSS_().getSheetByName('対応履歴ログ');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (headers.indexOf('種別') === -1) {
    sheet.getRange(1, headers.length + 1).setValue('種別');
  }
  sheet.appendRow([target || '', formatDate_(new Date()), detail || '', type]);
}

function listActivity_() {
  return cached_('activity', function () { return sheetToObjects_('対応履歴ログ'); });
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
  };
}

/**
 * 「直近イベント」をイベントログ（取引ステータス変更）と対応履歴ログ（物件・顧客の
 * 登録/更新/削除）の両方から統合して返す。物件マスタの現在ステータス算出には
 * イベントログのみを使うため、この統合は表示専用（ダッシュボード用）。
 */
function recentEvents_() {
  var events = listEvents_().map(function (e) {
    return { 物件名: e['物件名'], 買主氏名: e['買主氏名'], イベント種別: e['イベント種別'], 日付: e['日付'], メモ: e['メモ'] };
  });
  var activities = listActivity_().map(function (a) {
    return {
      物件名: '',
      買主氏名: '',
      イベント種別: a['種別'] || '更新',
      日付: a['日付'],
      メモ: (a['対象氏名'] ? a['対象氏名'] + ' - ' : '') + (a['メモ'] || ''),
    };
  });
  return events.concat(activities).sort(function (a, b) {
    return new Date(b['日付']) - new Date(a['日付']);
  }).slice(0, 10);
}

function getDashboard_() {
  var properties = listProperties_();
  var inProgress = properties.filter(function (p) {
    return p['現在ステータス（自動）'] && p['現在ステータス（自動）'] !== '完了';
  });
  return { inProgressProperties: inProgress, recentEvents: recentEvents_() };
}

function createContact_(payload) {
  if (!payload || !payload['氏名']) throw new Error('氏名は必須です');
  var sheet = getSS_().getSheetByName('連絡先マスタ');
  sheet.appendRow([
    payload['氏名'],
    payload['種別'] || '',
    payload['メールアドレス'] || '',
    payload['電話番号'] || '',
  ]);
  logActivity_('顧客登録', payload['氏名'], '種別: ' + (payload['種別'] || '未設定'));
  clearCache_();
  return { created: true, 氏名: payload['氏名'] };
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
    payload['売主契約日'] || '',
    payload['担当者氏名'] || '',
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
  sheet.getRange(lastRow, 13).setFormula(
    '=IFERROR(QUERY(\'イベントログ\'!$A$2:$F$300,"select C where A=\'"&A' + lastRow + '&"\' order by D desc limit 1"),"問い合わせ前")'
  );

  logActivity_('物件登録', propertyName, '新規登録しました');
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

  var keyValues = sheet.getRange(2, keyCol, sheet.getLastRow() - 1, 1).getValues();
  var rowIndexByKey = {};
  keyValues.forEach(function (row, i) {
    rowIndexByKey[row[0]] = i + 2; // 1-indexed シート行
  });

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
    logActivity_('物件情報更新', u.key, fieldNames ? (fieldNames + ' を更新') : '更新');
  });
  clearCache_();
  return result;
}

function updateContactsBatch_(payload) {
  if (!payload || !payload.updates) throw new Error('updates は必須です');
  var result = updateRowsByKey_('連絡先マスタ', '氏名', payload.updates);
  payload.updates.forEach(function (u) {
    var fieldNames = Object.keys(u.fields || {}).join('、');
    logActivity_('顧客情報更新', u.key, fieldNames ? (fieldNames + ' を更新') : '更新');
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
    '担当者氏名': property['担当者氏名'] || '加瀬',
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
  var keyValues = sheet.getRange(2, keyCol, sheet.getLastRow() - 1, 1).getValues();
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

  logActivity_('物件削除', propertyName, 'Driveフォルダも削除');
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
  var keyValues = sheet.getRange(2, keyCol, sheet.getLastRow() - 1, 1).getValues();
  var rowNum = null;
  for (var i = 0; i < keyValues.length; i++) {
    if (keyValues[i][0] === name) { rowNum = i + 2; break; }
  }
  if (!rowNum) throw new Error('顧客が見つかりません: ' + name);
  sheet.deleteRow(rowNum);

  logActivity_('顧客削除', name, '');
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

  logActivity_('取引削除', propertyName + ' × ' + buyerName, deletedCount + '件のイベントを削除');
  clearCache_();
  return { deleted: true, deletedCount: deletedCount };
}
