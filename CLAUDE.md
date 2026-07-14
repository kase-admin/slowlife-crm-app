# CLAUDE.md

このリポジトリの運用ルール・アーキテクチャ・デプロイ手順は **[AGENTS.md](AGENTS.md) に集約されています。** Claude Code / Codex 共通の単一の正なので、作業前に必ず読むこと。このファイルはClaude Code固有の補足のみを持つポインタです。

## Claude Code固有の補足

- 新規機能開発や修正を頼まれたら、まず `/feature-dev` Skill（実体は [`.agent/skills/feature-dev/SKILL.md`](.agent/skills/feature-dev/SKILL.md)、`.claude/skills/feature-dev` からシンボリックリンク）を使い、`develop` ブランチを直接編集する。`main` には触れない。
- ユーザーから本番反映の指示が来たら `/ship-to-prod` Skill（実体は [`.agent/skills/ship-to-prod/SKILL.md`](.agent/skills/ship-to-prod/SKILL.md)）を使い、`develop` を `main` にマージ・pushする。
- Skillの中身自体を変更・改善する場合は `.agent/skills/` 配下の実体ファイルを編集する（`.claude/skills/` はシンボリックリンクなのでそちらを直接編集しない）。
