/**
 * 加瀬様向け 不動産CRM Webアプリ バックエンド（GAS Web App）
 * - スプレッドシートをDBとして読み書きするAPIを提供
 * - 物件登録時にDriveフォルダを自動作成する
 * - CacheServiceで一覧データを短時間キャッシュし、読み込みを高速化する
 *
 * デプロイ後のWeb App URLをフロントエンド側 API_BASE に設定して使用する。
 */

var SPREADSHEET_ID = '1ziEXI1l_5JkiPOuV5vbU4e8-RuH5-XCcV61x8loO-DY';
var DRIVE_ROOT_FOLDER_NAME = '不動産CRM';
// 簡易アクセス制御用トークン（本番運用前に必ず変更し、ソース管理外で扱うこと）
var API_TOKEN = 'kase-crm-mvp-2026';
var CACHE_TTL_SEC = 25;

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
    var token = params.token || body.token;
    if (token !== API_TOKEN) {
      return jsonOutput_({ ok: false, error: 'unauthorized' });
    }

    var action = params.action || body.action;
    var result;
    switch (action) {
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
      default:
        return jsonOutput_({ ok: false, error: 'unknown action: ' + action });
    }
    return jsonOutput_({ ok: true, data: result });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err) });
  }
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
  getCache_().removeAll(['properties', 'contacts', 'events', 'transactions']);
  return { cleared: true };
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

function recentEvents_() {
  var events = listEvents_();
  return events.slice().sort(function (a, b) {
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
  clearCache_();
  return result;
}

function updateContactsBatch_(payload) {
  if (!payload || !payload.updates) throw new Error('updates は必須です');
  var result = updateRowsByKey_('連絡先マスタ', '氏名', payload.updates);
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
