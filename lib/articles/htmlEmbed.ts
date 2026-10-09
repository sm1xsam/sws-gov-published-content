const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

export function renderArticleHtmlEmbed(html: string, caption = '') {
  const title = escapeHtml(caption || 'Interactive article content');
  return `<figure class="post-embed post-embed--html"><iframe srcdoc="${escapeHtml(html)}" title="${title}" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy" style="height:480px"></iframe>${caption ? `<figcaption class="post-figure__caption">${escapeHtml(caption)}</figcaption>` : ''}</figure>`;
}
