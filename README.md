# SWS.GOV published content

Notion is the editorial CMS for SWS.GOV News and Press Office. This repository stores validated published article snapshots, immutable image release assets and the synchronisation code. No private website implementation, drafts or credentials belong here.

Media lives in the `article-media-v1` release. Never replace or remove hash-named assets while published pages reference them.

The sync workflow uses the repository GITHUB_TOKEN and the NOTION_API_TOKEN Actions secret. The integration is scoped to SWS.GOV Publisher only. Two complete syncs passed, and the hourly schedule (`17 * * * *`) is active. Manual Run workflow publishes sooner. The production website now reads this snapshot from Notion after all 81 preserved article URLs and core surfaces passed. Never store drafts, archived bodies or tokens here.

Recovery uses published.json commit history. The website also keeps a bundled validated snapshot for cold-start outages.
