# 不動産CRM（有限会社スローライフ様向け）

Google スプレッドシートをDBとして使う不動産仲介業務向けCRM。フロントエンドはGitHub Pagesで配信される静的サイト、バックエンドはGoogle Apps Script（GAS）のWeb Appです。Claude Code等のAIコーディングツールで継続的に仕様変更していく前提で構成しています。

公開URL: https://taisukeando.github.io/slowlife-crm-app/

---

## 1. 全体構成（アーキテクチャ）

```
[ブラウザ]
   │  fetch (JSON)
   ▼
[GitHub Pages] docs/ ─── 静的フロントエンド（HTML/CSS/JS、ビルド不要）
   │
   │  HTTPS POST/GET （?action=... 形式）
   ▼
[GAS Web App] gas/Code.js ─── バックエンドAPI（doGet/doPost）
   │
   ├─ Google スプレッドシート（DB本体）
   │    物件マスタ / 連絡先マスタ / イベントログ
   │
   └─ Google Drive（不動産CRM/ フォルダ）
        ├─ 01_テンプレート/  ← 書類のひな型（Googleドキュメント）
        └─ 02_物件/{物件名}/
              ├─ 01_売主提出書類/
              ├─ 02_買主提出書類/
              ├─ 03_仲介業者作成書類/  ← 発行した書類はここに保存される
              └─ 04_AI参照用/         ← NotebookLM用（個人情報を含む書類は入れない）
```

- **GitHub Pagesは静的ホスティングのみ**（サーバー処理・シークレット保管不可）。そのためビジネスロジックはすべてGAS側に置いている（パターンB構成）。
- **スプレッドシートが唯一の正データ**。GASはこれを読み書きするAPIを提供するだけで、フロントエンドはローカルに状態を持たない（毎回 `bootstrap` で全件取得）。

---

## 2. フォルダ・ファイル構成

```
slowlife-crm-app/
├── gas/
│   ├── Code.js          ← バックエンドのロジック全部（このファイルだけ）
│   └── appsscript.json  ← GASのマニフェスト（Web App公開設定など）
├── docs/                ← GitHub Pagesで公開される実体
│   ├── index.html       ← 画面構造（サイドバー・各セクションのDOM）
│   ├── style.css        ← 配色・レイアウト
│   ├── app.js           ← 画面ロジック（state管理・API呼び出し・編集差分管理）
│   ├── api.js           ← GAS Web Appへの薄いfetchラッパー
│   └── config.js        ← API_BASE（GASのWeb App URL）とAPI_TOKEN
├── .clasp.json           ← clasp（GAS用CLI）の紐付け設定
└── package.json / package-lock.json  ← clasp自体の依存（ローカルインストール）
```

---

## 3. データモデル（スプレッドシート）

スプレッドシートID: `1ziEXI1l_5JkiPOuV5vbU4e8-RuH5-XCcV61x8loO-DY`（`gas/Code.js` の `SPREADSHEET_ID`）

| シート | 役割 | 主キーに相当する列 |
|---|---|---|
| `物件マスタ` | 物件1件＝1行。売主情報も直接持つ（リレーションシートは使わない方針） | 物件名 |
| `連絡先マスタ` | 売主・買主・担当者の人物情報を一元管理 | 氏名 |
| `イベントログ` | 「いつ・どの物件×買主で・何が起きたか」を1イベント1行で記録する追記専用ログ | （物件名, 買主氏名, 日付）の組 |

**「取引」は独立したシートではない。** 物件と買主は1対1ではないため、`イベントログ`を「物件名×買主氏名」でグルーピングして動的に導出している（`gas/Code.js` の `listTransactions_()`）。フロントエンドの「取引一覧」でステータスを変更すると、内部的には新しいイベント行が1件追記される（履歴は失われない）。

物件の「現在ステータス」も同様に、イベントログの最新行から `QUERY` 相当のロジックで導出される（手入力箇所ではない）。

---

## 4. Claude Codeでの編集方法

### 4-1. フロントエンドを変更する場合（`docs/` 配下）

`docs/index.html` / `app.js` / `style.css` を直接編集して、commit & push するだけ。GitHub Pagesが自動で再ビルド・再配信する（数十秒〜数分かかる場合がある）。

```bash
git add -A
git commit -m "変更内容"
git push origin main
```

ローカルで確認したい場合は、リポジトリ直下で簡易サーバーを立てて `docs/` を配信する（例: `npx http-server docs -p 8765`）。

### 4-2. バックエンドを変更する場合（`gas/Code.js`）

`gas/Code.js` は普通のJavaScriptファイルとして編集できる。変更を反映するには、ファイル保存だけでは不十分で、**clasp経由でGAS側にpush＆再デプロイする必要がある**。

```bash
# 1. リポジトリ直下で依存関係をインストール済みであること（package.json）
npx clasp push --force

# 2. 既存のWeb AppデプロイIDを指定して再デプロイ（新規デプロイすると別URLになるため、
#    既存デプロイIDを必ず指定すること）
npx clasp deploy \
  --deploymentId AKfycbxtM_Vve-rWW1d3bylW3kL9hrgpyW9CSUPS4_j0h1MxZI6wT8fIDGJlo9Va1voZLO1NoA \
  --description "変更内容のメモ"
```

現在公開中のWeb App URL（`docs/config.js` の `API_BASE` と一致させること）:
```
https://script.google.com/macros/s/AKfycbxtM_Vve-rWW1d3bylW3kL9hrgpyW9CSUPS4_j0h1MxZI6wT8fIDGJlo9Va1voZLO1NoA/exec
```

### 4-3. 初回セットアップ（別のマシン・別アカウントで作業する場合）

```bash
npm install            # clasp をローカルにインストール
npx clasp login        # ブラウザでGoogleアカウント認可
```

- 事前に https://script.google.com/home/usersettings で「Google Apps Script API」をONにしておく必要がある。
- `gas/Code.js` が `SpreadsheetApp` / `DriveApp` / `DocumentApp` 等の新しいGoogleサービスを初めて使うようになった場合、**コード変更だけでは権限不足エラーになる**。その場合は一度スクリプトエディタ（`npx clasp open-script` で開く）から、`manualAuthorizeAll` 関数を選んで手動実行し、認可ダイアログで許可する必要がある（`gas/Code.js` 内にこの関数を用意済み）。

### 4-4. 新しいAPIアクションを追加する型

`gas/Code.js` の `handleRequest_()` 内の `switch (action)` に分岐を追加し、対応する関数を実装する。フロントエンドからは `callApi("アクション名", payload)`（`docs/api.js`）で呼び出す。既存の `createProperty_` / `updatePropertiesBatch_` などを参考にすると実装パターンが分かりやすい。

---

## 5. 書類自動発行機能

`物件一覧`・`取引一覧`の各行に「書類発行」ボタンがあり、テンプレートにその場のデータを差し込んでDriveに保存する。

| 書類 | 必要な情報 | 発行できる場所 |
|---|---|---|
| 物件概要書 | 物件情報のみ | 物件一覧の行 |
| 媒介契約書 | 物件情報＋売主情報 | 物件一覧の行 |
| 重要事項説明書 | 物件情報＋買主情報 | 取引一覧の行 |
| 売買契約書 | 物件情報＋買主情報 | 取引一覧の行 |

- テンプレート本体は Drive の `不動産CRM/01_テンプレート/` に Google ドキュメントとして格納されている。`{{物件名}}` のようなプレースホルダーをテンプレート内に書いておくと、発行時に実データへ置換される。
- テンプレートのGoogleドキュメントIDは `gas/Code.js` の `TEMPLATE_DOC_IDS` にハードコードされている。テンプレートの文面を直接編集する場合はDrive上のドキュメントを直接編集すればよく、コード変更は不要。**書類の種類を増やす場合**は、新しいテンプレートDocを `01_テンプレート` に追加し、`TEMPLATE_DOC_IDS` とフロントエンドの `PROPERTY_DOC_TYPES` / `TRANSACTION_DOC_TYPES`（`docs/app.js`）に追記する。
- 発行された書類は物件フォルダの `03_仲介業者作成書類/` に `[物件名]_[書類種別]_[YYYYMMDD]_v1` という命名で保存される。

> ⚠ 現在のテンプレート文面はMVPとしての実務的な構成案であり、法的に完全なものではありません。実際の契約・説明に使用する前に、宅地建物取引士・行政書士等の専門家によるレビューを必ず行ってください。

---

## 6. 既知の制約・今後の課題

- **APIトークンが `docs/config.js` に平文で入っている。** 公開リポジトリのため誰でも読める。実データ（顧客個人情報）を本格運用する前に、Google Sign-In等の認可方式に切り替えることを推奨。
- **NotebookLMとの連携は手動。** ノートブックの作成・ソース登録を外部から自動実行する公式APIが（個人/Workspace通常プランの）NotebookLMには無いため、`04_AI参照用` フォルダを手動でノートブックのソースに指定する運用を想定している。
- **GASのコールドスタート（1〜3秒程度）は構造上の制約。** これ以上の高速化には、GAS Web Appを経由せずブラウザから直接Google APIを呼ぶ構成（別パターン）への移行が必要。
- 担当者は現状「加瀬」固定の想定で、複数担当者の管理機能は未実装。
