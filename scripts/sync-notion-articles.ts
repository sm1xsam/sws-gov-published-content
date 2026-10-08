import { synchroniseNotionArticles } from '../lib/notion/sync';
synchroniseNotionArticles().then(snapshot => console.log(JSON.stringify({ updatedAt: snapshot.updatedAt, published: snapshot.articles.length }))).catch(error => { console.error(error); process.exitCode = 1; });
