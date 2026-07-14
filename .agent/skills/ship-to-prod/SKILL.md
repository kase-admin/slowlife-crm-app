---
name: ship-to-prod
description: developブランチの内容を本番(main)に反映する。ユーザーがプレビューでの動作確認後に「本番に反映して」「デプロイして」のように明示的に指示したときだけ使う。
---

# ship-to-prod

`develop` で動作確認が取れた変更を `main`（本番）にマージし、本番のGitHub Pages・必要であればGAS Web Appに反映する。**ユーザーからの明示的な本番反映の指示がない限り、このSkillを自発的に実行しない。**

## 前提確認

1. ユーザーが実際に「本番に反映して」に相当する指示を出したか確認する（プレビューを見ただけで反映指示が無ければ実行しない）。
2. `git log main..develop --oneline` で、これからmainに入る変更点を一覧し、ユーザーに何が反映されるか一言でまとめておく。

## 手順

1. **作業ツリーがクリーンであることを確認する**（`git status`）。未コミットの変更があれば先に確認する。
2. **mainを最新化してdevelopをマージする。**
   ```bash
   git checkout main
   git pull origin main
   git merge develop --no-edit
   ```
   コンフリクトが出た場合は安易に片方を破棄せず、内容を確認しながら解決する。
3. **mainをpushする。**
   ```bash
   git push origin main
   ```
   これにより GitHub Actions（`deploy-pages.yml`）が発火し、本番の `docs/` が再デプロイされる。
4. **`gas/Code.js` に変更が含まれる場合、バックエンドの反映が必要か確認する。** 含まれる場合はユーザーに実行してよいか確認した上で:
   ```bash
   npx clasp push --force
   npx clasp deploy --deploymentId AKfycbxEmEo2oAy096mY1wvFUUCsEIQvX4rtHpik3qDtFeiCxjCA7tFH2FEEx5An6tghIKuz --description "<変更内容>"
   ```
   `--deploymentId` は必ず [`.agent/project.yml`](../../project.yml) の `gas.production_deployment_id` を使うこと（省略すると別URLの新規デプロイになり、フロントエンドが古いバックエンドを向いたままになる）。
   新しいGoogleサービスを初めて呼ぶ変更の場合、`npx clasp open-script` でスクリプトエディタを開き `manualAuthorizeAll` を実行する手動操作をユーザーに依頼する（AIツールからは実行できない）。
5. **developをmainに追従させる（fast-forward想定なので通常は不要だが、mainではなくdevelop側に直接手を入れた形跡があれば）** `git checkout develop && git merge main --no-edit && git push origin develop` でdevelopをmainと同期しておく。
6. **ユーザーに本番URLを報告する:** `https://kase-admin.github.io/slowlife-crm-app/` 。GASを再デプロイした場合はその旨も伝える。

## やらないこと

- ユーザーの指示なしにmainへマージ・pushしない。
- コンフリクトを `git checkout --theirs`/`--ours` などで無条件に解決しない。内容を見て判断する。
- `--force` push はしない（mainへの通常pushで十分なはず。履歴が乖離している場合は原因をユーザーに確認する）。
