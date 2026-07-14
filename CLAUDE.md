# CLAUDE.md

このリポジトリの運用ルール・アーキテクチャ・デプロイ手順は **[AGENTS.md](AGENTS.md) に集約されています。** Claude Code / Codex 共通の単一の正なので、作業前に必ず読むこと。このファイルはClaude Code固有の補足のみを持つポインタです。

## Claude Code固有の補足

- `.claude/skills/` 配下には、正本である `.agents/skills/` を読む薄いラッパーだけを置く。Windowsで展開されないシンボリックリンクには依存しない。
- 新規機能開発や修正を頼まれたら、まず `/feature-dev` Skill（実体は [`.agents/skills/feature-dev/SKILL.md`](.agents/skills/feature-dev/SKILL.md)）を使い、`develop` ブランチを直接編集する。`main` には触れない。
- ユーザーから本番反映の指示が来たら `/ship-to-prod` Skill（実体は [`.agents/skills/ship-to-prod/SKILL.md`](.agents/skills/ship-to-prod/SKILL.md)）を使い、`develop` を `main` にマージ・pushする。
- Skillの中身自体を変更・改善する場合は `.agents/skills/` 配下の正本を編集し、ラッパーには手順を重複させない。
