# SWS.GOV published content

Notion is the editorial CMS for SWS.GOV News and Press Office. This repository stores validated published article snapshots, immutable image release assets and the synchronisation code. No private website implementation, drafts or credentials belong here.

Media lives in the `article-media-v1` release. Never replace or remove hash-named assets while published pages reference them.

The sync workflow uses the repository GITHUB_TOKEN and the NOTION_API_TOKEN Actions secret. Add only an integration scoped to SWS.GOV Publisher. Run the workflow manually and verify the initial published.json before enabling the hourly schedule (`17 * * * *`). The website must remain on its current provider until migration and route parity checks pass.

Recovery uses published.json commit history. The website also keeps a bundled validated snapshot for cold-start outages.
