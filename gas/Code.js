/**
 * 加瀬様向け 不動産CRM Webアプリ バックエンド（GAS Web App）
 * - スプレッドシートをDBとして読み書きするAPIを提供
 * - 物件登録時にDriveフォルダを自動作成する
 *
 * デプロイ後のWeb App URLをフロントエンド側 API_BASE に設定して使用する。
 */

var SPREADSHEET_ID = '1ziEXI1l_5JkiPOuV5vbU4e8-RuH5-XCcV61x8loO-DY';
var DRIVE_ROOT_FOLDER_NAME = '不動産CRM';
// 簡易アクセス制御用トークン（本番運用前に必ず変更し、ソース管理外で扱うこと）
var API_TOKEN = 'kase-crm-mvp-2026';

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
      return jsonOutput_({ ok: false, error: 'unauthorized' }, 401);
    }

    var action = params.action || body.action;
    var result;
    switch (action) {
      case 'listProperties':
        result = listProperties_();
        break;
      case 'listContacts':
        result = listContacts_();
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
      case 'addEvent':
        result = addEvent_(body.payload);
        break;
      default:
        return jsonOutput_({ ok: false, error: 'unknown action: ' + action }, 400);
    }
    return jsonOutput_({ ok: true, data: result }, 200);
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err) }, 500);
  }
}

function jsonOutput_(obj, _status) {
  // GAS の ContentService は HTTP ステータスコードを自由に設定できないため、
  // ok:false の場合もボディ内のフラグでクライアント側が判定する。
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSS_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
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
    rows.push(obj);
  }
  return rows;
}

function formatDate_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'Asia/Tokyo', 'yyyy-MM-dd');
}

function listProperties_() {
  return sheetToObjects_('物件マスタ');
}

function listContacts_() {
  return sheetToObjects_('連絡先マスタ');
}

function listEvents_() {
  return sheetToObjects_('イベントログ');
}

function getDashboard_() {
  var properties = listProperties_();
  var events = listEvents_();

  var inProgress = properties.filter(function (p) {
    return p['現在ステータス（自動）'] && p['現在ステータス（自動）'] !== '完了';
  });

  var sorted = events.slice().sort(function (a, b) {
    return new Date(b['日付']) - new Date(a['日付']);
  });
  var recentEvents = sorted.slice(0, 10);

  return { inProgressProperties: inProgress, recentEvents: recentEvents };
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
  return { created: true, 氏名: payload['氏名'] };
}

function createProperty_(payload) {
  if (!payload || !payload['物件名']) throw new Error('物件名は必須です');
  var propertyName = payload['物件名'];

  var folderInfo = createPropertyFolders_(propertyName);

  var sheet = getSS_().getSheetByName('物件マスタ');
  var today = formatDate_(new Date());
  sheet.appendRow([
    propertyName,
    payload['都道府県'] || '',
    payload['市区町村'] || '',
    payload['番地'] || '',
    payload['売主氏名'] || '',
    '', // 売主メール（参照・数式が自動入力されないため空欄。VLOOKUPを再設定する場合は別途）
    '', // 売主電話（参照）
    payload['売主契約日'] || '',
    payload['担当者氏名'] || '',
    today,
    folderInfo.url,
    '（未作成）',
    '', // 現在ステータス（自動）は数式セルのため appendRow 後に別途設定
  ]);

  var lastRow = sheet.getLastRow();
  // 売主メール・売主電話・現在ステータスの数式を該当行に設定
  sheet.getRange(lastRow, 6).setFormula(
    '=IFERROR(VLOOKUP(E' + lastRow + ',連絡先マスタ!$A:$D,3,FALSE),"")'
  );
  sheet.getRange(lastRow, 7).setFormula(
    '=IFERROR(VLOOKUP(E' + lastRow + ',連絡先マスタ!$A:$D,4,FALSE),"")'
  );
  sheet.getRange(lastRow, 13).setFormula(
    '=IFERROR(QUERY(\'イベントログ\'!$A$2:$F$300,"select C where A=\'"&A' + lastRow + '&"\' order by D desc limit 1"),"問い合わせ前")'
  );

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
    '', // 買主の最新イベント（自動）は数式セルのため別途設定
  ]);
  var lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 6).setFormula(
    '=IF(AND(B' + lastRow + '<>"",D' + lastRow + '=MAXIFS($D$2:$D$300,$A$2:$A$300,A' + lastRow + ',$B$2:$B$300,B' + lastRow + ')),"●","")'
  );
  return { created: true };
}

/**
 * Drive上に「不動産CRM/02_物件/{物件名}/」配下の標準フォルダ構成を作成する。
 * ルートフォルダ・02_物件フォルダが無ければ作成する。
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
