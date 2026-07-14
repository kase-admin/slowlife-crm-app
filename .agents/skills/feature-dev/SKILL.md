---
name: feature-dev
description: この不動産CRMで新規機能・修正をdevelopブランチに実装し、commit・pushしてプレビューURLを返す。「追加して」「直して」「改善して」「実装して」などの開発依頼で使う。mainへの本番反映依頼には使わない。
---

# feature-dev

このリポジトリでの新規機能開発・修正は、フィーチャーブランチを都度切る運用ではなく、**`develop` ブランチを直接編集していく**運用にしている。`main` は本番であり、明示的な本番反映指示があるまで触らない（詳細は [`AGENTS.md`](../../../AGENTS.md) のブランチ運用を参照。マージ手順は [`ship-to-prod`](../ship-to-prod/SKILL.md) 側）。

## 手順

1. **ブランチを確認する。** `git status` で作業ツリーがクリーンか確認し、`git branch --show-current` が `develop` でなければ `git checkout develop` する（未コミットの変更があれば先にユーザーに確認する。安易に破棄しない）。`git pull origin develop` で最新化する。
2. **依頼内容を実装する。** 対象は主に `docs/`（フロントエンド）と `gas/Code.js`（バックエンド）。既存のコード規約・データモデルは `AGENTS.md` を参照。特に:
   - `物件マスタ` の列位置に依存した数式設定（AGENTS.md「列位置に依存するコードへの注意」）を壊さないこと。
   - 新しいプレースホルダーを書類テンプレートに追加する場合は `escapeRegex_()` を経由させること。
3. **`gas/Code.js` を変更した場合、`clasp push` / `clasp deploy` はここでは実行しない。** ステージング用のGASデプロイが無いため、コードの変更は `develop` にcommitするに留め、本番デプロイは [`ship-to-prod`](../ship-to-prod/SKILL.md) 実行時にユーザーへ確認してから行う。ただし、変更が新しいGoogleサービスを使う場合は `manualAuthorizeAll` の手動認可が本番デプロイ時に必要になる旨をこの時点でユーザーに伝えておく。
4. **`develop` にcommit & pushする。** `main` へは絶対にpushしない。
   ```bash
   git add -A
   git commit -m "<変更内容>"
   git push origin develop
   ```
5. **`docs/**` を変更していれば、pushをトリガーにGitHub Actions（`deploy-pages.yml`）がプレビューサイトを再デプロイする。** 数十秒〜数分待つ必要がある（`gh run list --workflow=deploy-pages.yml --branch=develop` で進捗確認できる）。
6. **ユーザーに次を報告する:**
   - 何を実装したか（変更点の要約）
   - プレビューURL: `https://kase-admin.github.io/slowlife-crm-app/preview/`
   - 動作確認を依頼し、問題なければ「本番に反映して」と伝えれば `ship-to-prod` Skillでmainに反映される旨を伝える。
   - `gas/Code.js` を変更した場合は、プレビューは本番のGASバックエンドに接続されたままである（ステージングGASは無い）ため、新しいAPI呼び出しを伴う変更は本番デプロイ前には動作確認できない点を明示する。

## やらないこと

- `develop` の変更を勝手に `main` にマージ・pushしない。
- ユーザーの確認なしに `clasp deploy`（本番GASデプロイ）を実行しない。
- GitHub Pagesの設定（Settings > Pages）を変更しない（管理者権限が必要な操作のため）。
