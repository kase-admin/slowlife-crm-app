# AGENTS.md

このリポジトリで作業するすべてのAIコーディングツール（Claude Code / Codex 等）向けの、**唯一の正**とする運用ガイドです。`CLAUDE.md` はこのファイルへのポインタのみを持ちます。ツール固有の細かい挙動差はありますが、プロジェクトのルール・手順は必ずここに書き、重複させないこと。

## 概要

有限会社スローライフ向けの不動産仲介CRM。Googleスプレッドシートをデータベースとして使い、フロントエンドはGitHub Pages（静的サイト）、バックエンドはGoogle Apps Script（GAS）のWeb Appという構成。詳しいアーキテクチャ・データモデルは [README.md](README.md) を参照（ただし機能追加が早いため、README記載と実装が食い違っている場合は実装側を正とすること。特に認証方式・シート構成は変化が大きいので `gas/Code.js` を直接確認するのが確実）。

本番公開URL: https://kase-admin.github.io/slowlife-crm-app/
プレビュー公開URL（developブランチの最新状態）: https://kase-admin.github.io/slowlife-crm-app/preview/

## ファイル構成

```
gas/Code.js       バックエンドの全ロジック（このファイルだけ）
gas/appsscript.json
docs/index.html   画面構造（サイドバー・各セクション・ログインオーバーレイ）
docs/style.css
docs/app.js       画面ロジック（state管理・一覧描画・モーダル・並び替え）
docs/api.js       GAS Web Appへの fetch ラッパー（idTokenを毎回付与）
docs/auth.js      Googleログイン（Identity Services）
docs/config.js    API_BASE と GOOGLE_CLIENT_ID
.agents/          Codex公式のリポジトリSkill探索先とAIエージェント共通設定
.agents/project.yml  リポジトリ・ブランチ・デプロイ先URLなどの構造化メタ情報
.github/workflows/deploy-pages.yml  main→本番 / develop→プレビュー を同時にPagesへデプロイするworkflow
```

## ブランチ運用（重要）

- **`main` = 本番。直接pushやmergeで機能開発をしない。** 常にユーザーの明示的な「本番に反映して」という指示があったときだけ、`develop` を `main` にマージする。
- **`develop` = 開発用ブランチ。新規機能・修正はここを直接編集してcommit & pushする。** PRを都度作る運用ではなく、`develop` に直接積んでいく。
- 新規機能開発を頼まれたら [`.agents/skills/feature-dev/SKILL.md`](.agents/skills/feature-dev/SKILL.md) の手順に従う。要点:
  1. `develop` ブランチにいることを確認し、最新を取得する。
  2. 依頼された変更を実装する。
  3. `develop` にcommit & pushする（`main` には触れない）。
  4. push後、GitHub Actionsがプレビュー用サイトを再デプロイする（`docs/**` の変更をpushしたときのみ発火。数十秒〜数分かかる）。プレビューURL `https://kase-admin.github.io/slowlife-crm-app/preview/` をユーザーに返し、動作確認を依頼する。
  5. ユーザーから「本番に反映して」という指示が来たら、[`.agents/skills/ship-to-prod/SKILL.md`](.agents/skills/ship-to-prod/SKILL.md) の手順で `develop` を `main` にマージ・pushする。それより前に `main` へは触れない。
- `gas/Code.js` を変更した場合でも、バックエンドの自動デプロイは行わない（ステージング用のGASデプロイは用意していないため）。`develop` 上でコードは編集してよいが、`clasp push`/`clasp deploy` は本番デプロイIDに対して行う操作であり、ユーザーに実行タイミングを確認してから行う（詳細は下記「バックエンドの反映」）。

## プレビュー・本番デプロイの仕組み

- フロントエンド（`docs/`）のデプロイはGitHub Actions（[`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)）が担う。**GitHub Pagesの Settings > Pages > Build and deployment > Source は "GitHub Actions" にしておく必要がある**（レガシーな「ブランチから配信」設定のままだとこのworkflowが機能しない。管理者権限が必要な設定変更のため、リポジトリ管理者が手動で一度だけ行う）。
- このworkflowは `main` と `develop` の両方の `docs/` を毎回チェックアウトし、`main` の内容をサイトのルートに、`develop` の内容を `/preview/` 以下に配置してから1つのアーティファクトとしてデプロイする。そのため **どちらのブランチにpushしても両方の内容が失われずに再デプロイされる。**
- トリガーは `docs/**` の変更をpushしたとき（`main`・`develop` どちらでも）。手動実行（`workflow_dispatch`）も可能。

## バックエンドの反映（`gas/Code.js`）

保存・commitだけでは反映されない。必ず以下を実行する（**必ず本番用の既存デプロイIDを指定すること**。省略すると新しいデプロイ＝別URLが作られ、フロントエンドが古いバックエンドを向いたままになる）。

```bash
npx clasp push --force
npx clasp deploy --deploymentId AKfycbxEmEo2oAy096mY1wvFUUCsEIQvX4rtHpik3qDtFeiCxjCA7tFH2FEEx5An6tghIKuz --description "変更内容のメモ"
```

これは本番バックエンドに即座に影響するため、`develop` での開発中は実行せず、ユーザーが本番反映を指示したタイミング（[`.agents/skills/ship-to-prod/SKILL.md`](.agents/skills/ship-to-prod/SKILL.md) 実行時）でユーザーに確認の上、実行する。

`gas/Code.js` が新しいGoogleサービス（例: `UrlFetchApp`, `DocumentApp` を初めて使うようになった等）を呼ぶようになった場合、pushしただけでは権限不足エラーになる。スクリプトエディタ（`npx clasp open-script`）を開き、関数選択プルダウンから `manualAuthorizeAll` を実行して認可ダイアログを一度通す必要がある（ユーザーに手動operationを依頼すること。AIツールからは実行できない）。

## データと認証

- スプレッドシートID・テンプレートDocID・OAuthクライアントID・物件フォルダ作成先IDは、すべて `gas/Code.js` の先頭に定数で書かれている。新規物件フォルダは `PROPERTY_FOLDER_PARENT_ID` で指定したDriveフォルダの直下に作成する。
- **アクセス制御はGoogleログイン方式。** 静的トークンは廃止済み。フロントエンドはGoogle Identity Servicesでログインし、取得したIDトークンを毎回のAPI呼び出しに付与する（`docs/api.js` の `CURRENT_ID_TOKEN`）。GAS側は `authorize_()` でGoogleの`tokeninfo`エンドポイントに照会し、スプレッドシートの **`Authシート`**（メールアドレス・権限・有効の3列）にあるアカウントだけを許可する。新しい利用者を追加する場合はこのシートに1行追加するだけでよく、コード変更は不要。
- スプレッドシートのシート構成（2026年6月時点）: `ダッシュボード`（集計用、関数で自動計算）/ `連絡先マスタ` / `物件マスタ` / `イベントログ`（取引ステータスの実データ） / `履歴ログ`（物件・顧客・取引の登録/更新/削除をすべて記録、`日時・種別・内容`の3列） / `設定・マスタ`（Webアプリは読まない。スプレッドシートを直接編集する人向けのプルダウン用） / `Authシート`。
- 「取引」は独立したシートではなく、`イベントログ` を「物件名×買主氏名」でグルーピングして動的に算出している（`listTransactions_()`）。物件の「現在ステータス」も `イベントログ` の最新行から導出される（手入力ではない）。

## 列位置に依存するコードへの注意

`物件マスタ` への `appendRow` と、それに続く `sheet.getRange(lastRow, 列番号)` での数式設定（売主メール・売主電話・現在ステータス）は、**ヘッダー名ではなく列の位置（何列目か）に依存している。** `物件マスタ` の列を追加・削除・並び替えする場合は、`createProperty_()` 内の `appendRow` の配列順と、直後の `getRange(lastRow, 6/7/11)` の列番号を必ず一緒に更新すること（更新を忘れると数式が別の列に入ってデータが壊れる）。

一方、`updateRowsByKey_()` や `findRowByKey_()` などの更新・検索系はヘッダー名で列を探すため、列の位置変更に影響されない。

## 書類自動発行

テンプレート（Googleドキュメント）は Drive の `不動産CRM/01_テンプレート/` にあり、IDは `gas/Code.js` の `TEMPLATE_DOC_IDS` にハードコードされている。テンプレートの文面はDrive上のドキュメントを直接編集すればよく、コード変更は不要。プレースホルダーは `{{物件名}}` のような記法。`body.replaceText()` は第一引数を正規表現として解釈するため、新しいプレースホルダーを追加する際も `escapeRegex_()` を経由させること（過去に `{{ }}` をエスケープし忘れて置換が効かない不具合があった）。

## 既知の制約

- GASのコールドスタート（1〜3秒程度）は構造上の制約。
- NotebookLMとの連携（`04_AI参照用` フォルダ）は手動運用。外部から自動でノートブックを作成・更新する公式APIが現時点の個人/Workspace通常プランには無いため。
- 担当者は「加瀬」固定（複数担当者の管理は未実装）。
- `develop` 用のGASステージングデプロイは用意していない。バックエンドの新しいAPIを使うフロントエンド変更をプレビューで確認する場合、既存の本番GASデプロイが対応していないと動かない点に注意（このケースでは先にユーザーと相談する）。

## Skill一覧

| Skill | 実体 | 用途 |
|---|---|---|
| feature-dev | [`.agents/skills/feature-dev/SKILL.md`](.agents/skills/feature-dev/SKILL.md) | `develop` ブランチを直接編集して新規機能・修正を行い、プレビューURLを返す |
| ship-to-prod | [`.agents/skills/ship-to-prod/SKILL.md`](.agents/skills/ship-to-prod/SKILL.md) | ユーザーの本番反映指示を受けて `develop` を `main` にマージ・push する |

Skillの正本は常に `.agents/skills/` 配下に置く。Codexが公式に探索するパスなので、Windowsで機能しないシンボリックリンクには依存しない。
- Codex: `$feature-dev` / `$ship-to-prod` で明示指定する。CLIでは `/skills` から選択することもできる。単独の `/` は組み込みコマンド一覧であり、Skill一覧ではない。
- Codexデスクトップアプリ: サイドバーの「Skills」でも確認できる。追加・変更が表示されない場合はCodexを再起動する。
- Claude Code: `.claude/skills/` 配下の薄いラッパーから `.agents/skills/` の正本を読む。

新しいSkillを追加する場合は `.agents/skills/<skill-name>/SKILL.md` と、UI表示用の `agents/openai.yaml` を作る。Claude Codeでも利用する場合は `.claude/skills/<skill-name>/SKILL.md` に正本を読むラッパーを追加する。
