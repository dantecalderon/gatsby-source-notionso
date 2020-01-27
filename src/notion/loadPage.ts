import { Reporter } from 'gatsby';
import {
  NotionPageBlock,
  NotionLoader,
  NotionPageDescription,
  NotionPageImage,
  NotionPageLinkedPage,
  NotionPageText,
} from '../types/notion';

import parseMetaBlock from './parser/parseMetaBlock';
import notionPageTextToString from './parser/notionPageTextToString';

function getPropertyAsString(
  block: NotionPageBlock,
  propName: string,
  defaultValue: '',
): string {
  const property = block.properties.find(p => p.propName === propName);
  if (!property) {
    return defaultValue;
  }
  return notionPageTextToString(property.value);
}

function getAttributeAsString(
  block: NotionPageBlock,
  attName: string,
  defaultValue: '',
): string {
  const att = block.attributes.find(p => p.att === attName);
  if (!att || !att.value) {
    return defaultValue;
  }
  return att.value;
}

function getPropertyText(
  block: NotionPageBlock,
  propName: string,
): NotionPageText[] | null {
  const property = block.properties.find(p => p.propName === propName);
  if (!property) {
    return null;
  }
  return property.value;
}

// loads a gatsby page
export default async function loadPage(
  pageId: string,
  rootPageId: string,
  indexPage: number,
  notionLoader: NotionLoader,
  reporter: Reporter,
): Promise<NotionPageDescription> {
  // we load the given page
  await notionLoader.loadPage(pageId);

  // and parse its description block
  const page = notionLoader.getBlockById(pageId);
  if (!page) {
    reporter.error(`could not retreieve page with id: ${pageId}`);
    throw Error('error retrieving page');
  }

  if (page.type !== 'page') {
    throw new Error('invalid page');
  }

  const imageDescriptions: NotionPageImage[] = [];
  const linkedPages: NotionPageLinkedPage[] = [];
  let hasMeta = false;
  const meta: Record<string, string> = {};
  let hasExcerpt = false;
  let excerpt = '';

  // parse all the blocks retrived from notion
  for (const blockId of page.blockIds) {
    const block = notionLoader.getBlockById(blockId);
    if (!block) {
      reporter.error(`could not retreieve para with id: ${blockId}`);
      throw Error('error retrieving paragraph');
    }
    switch (block.type) {
      case 'page':
        linkedPages.push({
          pageId: block.blockId,
          title: getPropertyAsString(block, 'title', ''),
        });
        break;
      case 'text':
        // the first non empty text becomes the excerpt
        if (!hasExcerpt) {
          const text = getPropertyAsString(block, 'title', '').trim();
          if (text.length > 0) {
            hasExcerpt = true;
            excerpt = text;
          }
        }
        break;
      case 'quote':
        if (!hasMeta) {
          hasMeta = true;
          const text = getPropertyText(block, 'title');
          // try to parse the block as a meta information definition block
          if (text) {
            if (parseMetaBlock(text, meta)) {
              // if we were able to parse the block, we change its type
              // (so that it is not rendered as a quote)
              block.type = '_meta';
            }
          }
        }
        break;
      case 'image':
        imageDescriptions.push({
          pageId,
          notionUrl: getPropertyAsString(block, 'source', ''),
          signedUrl: '',
          contentId: block.blockId,
        });
        break;
      case 'ignore':
        // guess what... we ignore that one
        break;
      default:
        // we keep the record by defaut
        break;
    }
  }

  // default meta value for the page
  // can be overriden from the page, using a quote block
  let slug = `${indexPage}`;
  let createdAt = new Date().toISOString();
  let isDraft = false;
  const tags: string[] = [];

  if (hasMeta) {
    if (meta['slug']) {
      slug = meta['slug'];
    }
    // TODO: parse date so that it becomes an actual
    // date in GraphQL
    if (meta['date']) {
      createdAt = new Date(meta['date'] + ' Z').toJSON();
    }
    if (meta['draft']) {
      const value = meta['draft'].toLowerCase();
      if (value === 'false' || value === '0') {
        isDraft = false;
      } else {
        isDraft = true;
      }
    }
    // tags can contain a comma separated list of value
    if (meta['tags']) {
      const value = meta['tags'].trim();
      value
        .split(',')
        .map(t => t.trim())
        .forEach(t => tags.push(t));
    }
  }

  const item: NotionPageDescription = {
    pageId,
    title: getPropertyAsString(page, 'title', ''),
    indexPage,
    slug,
    createdAt,
    tags,
    isDraft,
    excerpt,
    pageIcon: getAttributeAsString(page, 'pageIcon', ''),
    blocks: [],
    images: imageDescriptions,
    linkedPages,
  };
  notionLoader.getBlocks(item.blocks, rootPageId);
  return item;
}
