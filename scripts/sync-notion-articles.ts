import { synchroniseNotionArticles } from '../lib/notion/sync';
synchroniseNotionArticles({ force: process.argv.includes('--force') }).then(snapshot => console.log(JSON.stringify({ updatedAt: snapshot.updatedAt, published: snapshot.articles.length }))).catch(error => { console.error(error); process.exitCode = 1; });
