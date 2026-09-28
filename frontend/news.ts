// News-card anatomy ported from game-data-linker renderNewsFeed (MIT; see LICENSE).
import { eventClasses, ratingClasses } from './classes';
import type { NewsItem } from './feed';
import { getPluginI18nString } from './i18n';
import { activityDate, openArticle } from './steam';

export function renderNewsFeed(doc: Document, items: NewsItem[]): HTMLElement {
  const root = doc.createElement('div');
  const n = eventClasses();
  const rating = ratingClasses();
  
  const element = (tag: string, className: string, text?: string) => {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  
  if (!items.length) {
    root.textContent = getPluginI18nString('noNews');
    root.style.cssText = 'color:#8f98a0;font-size:13px;padding:20px 0';
    return root;
  }
  
  const groups = new Map<string, HTMLElement>();
  let nextDateId = 0;

  items.forEach(item => {
    const date = item.date === null ? null : new Date(item.date * 1000);

    // Include the year in the grouping key, even though Steam's visible label omits it.
    const key = date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : 'undated';
    let group = groups.get(key);

    if (!group) {
      group = element('div', `${n.AppActivityDay} AppActivityDay`);
      group.setAttribute('role', 'region');

      if (date) {
        const headingId = `external-news-date-${nextDateId++}`;
        group.setAttribute('aria-labelledby', headingId);
        const heading = element('h4', `${n.Reset} Reset ${n.AppActivityDate} AppActivityDate`,
          activityDate(date));
        heading.id = headingId;
        heading.append(element('div', `${n.Rule} Rule`));
        group.append(heading);
      }

      groups.set(key, group); root.append(group);
    }

    // Match the live Steam PartnerEventMediumImage tree: date panel wrappers,
    // event shell, outer card and nested focusable Panel. Feed entries are
    // medium image news cards even when they are the newest story.
    let dayContents = group.querySelector(':scope > [data-external-news-day]');

    if (!dayContents) {
      dayContents = element('div', '');
      dayContents.setAttribute('data-external-news-day', '');
      group.append(dayContents);
    }

    // Steam's announcement wrapper is per story, not per day. Themes depend
    // on these Panel siblings for first/last rounding and row separators.
    const announcementPanel = element('div', 'Panel');
    const eventPanel = element('div', `${n.Event} Event Panel`);
    const eventContentsPanel = element('div', 'Panel');
    const card = element('div', `${n.PartnerEventMediumImage} PartnerEventMediumImage ${n.PartnerEvent} PartnerEvent ${n.Event} Event`);
    const panel = element('div', `${n.PartnerEventMediumImage_Container} PartnerEventMediumImage_Container Panel`);

    eventPanel.append(eventContentsPanel);
    
    // Native announcements reserve a rating row below the card even at opacity:0.
    // Keep its CSS-driven height (and theme overrides), without fake RSS controls.
    const footer = element('div', `${rating.RatingBar} RatingBar`);
    footer.setAttribute('aria-hidden', 'true');
    footer.append(element('div', `${rating.LikeIcon} LikeIcon`));
    
    eventPanel.append(footer);
    announcementPanel.append(eventPanel);
    dayContents.append(announcementPanel);

    panel.tabIndex = 0;
    panel.setAttribute('role', 'button');
    panel.setAttribute('aria-label', item.title);
    panel.addEventListener('click', () => openArticle(doc, item.url));
    panel.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); openArticle(doc, item.url);
      }
    });

    const contents = element('div', `${n.PartnerEventMediumImage_Contents} PartnerEventMediumImage_Contents`);
    let picture: HTMLElement | undefined;

    if (item.image) {
      picture = element('div', `${n.MediumImageContainer} MediumImageContainer`);

      const image = doc.createElement('img');
      image.className = `${n.PartnerEventMediumImage_Image} PartnerEventMediumImage_Image`;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.src = item.image;
      image.addEventListener('error', () => picture?.remove(), { once: true });

      picture.append(image);
    }

    const column = element('div', `${n.PartnerEventMediumImage_TextColumn} PartnerEventMediumImage_TextColumn`);
    const type = element('div', `${n.PartnerEventType} PartnerEventType`);
    type.append(element('div', '', item.feedlabel || getPluginI18nString('news')));
    const title = element('div', `${n.PartnerEventMediumImage_Title} PartnerEventMediumImage_Title`, item.title);
    const summary = element('div', `${n.PartnerEventMediumImage_Summary} PartnerEventMediumImage_Summary`, item.contents.replace(/\[\/?\w+[^\]]*\]/g, ''));
    summary.style.cssText = 'overflow:hidden;-webkit-line-clamp:2;display:-webkit-box;-webkit-box-orient:vertical;text-overflow:ellipsis';
    column.append(type, title, summary);

    if (picture)
      contents.append(picture);
    
    contents.append(column);
    panel.append(contents);
    card.append(panel);
    eventContentsPanel.append(card);
  });

  return root;
}

/** Fit whole summary lines after mounting, using the space left by the title. */
export function observeNewsSummaries(root: HTMLElement): () => void {
  const win = root.ownerDocument.defaultView;

  if (!win?.ResizeObserver)
    return () => {};

  const summaries = Array.from(root.querySelectorAll<HTMLElement>('.PartnerEventMediumImage_Summary'));
  const original = new Map(summaries.map(summary => [summary, summary.style.getPropertyValue('-webkit-line-clamp')]));

  const fit = (summary: HTMLElement) => {
    // Reapply the normal style first so a wider window can show more lines again.
    summary.style.setProperty('-webkit-line-clamp', original.get(summary)!);

    const style = win.getComputedStyle(summary);
    const limit = parseInt(style.getPropertyValue('-webkit-line-clamp'));

    if (!Number.isFinite(limit) || !summary.clientHeight)
      return;

    const bottom = summary.getBoundingClientRect().bottom - parseFloat(style.paddingBottom);
    const range = root.ownerDocument.createRange();

    range.selectNodeContents(summary);

    const lines = new Set(Array
      .from(range.getClientRects())
      .filter(rect => rect.bottom <= bottom + 0.5)
      .map(rect => rect.top)
    );

    if (lines.size > 0 && lines.size < limit) {
      // Some themes force three lines even when a wrapping title leaves room
      // for only two. Limit that case so Chromium draws an ellipsis, not half a line.
      summary.style.setProperty('-webkit-line-clamp', String(lines.size), 'important');
    }
  };

  summaries.forEach(fit);

  const observer = new win.ResizeObserver(entries => entries
    .forEach(entry => fit(entry.target as HTMLElement))
  );

  summaries.forEach(summary => observer.observe(summary));

  return () => observer.disconnect();
}
