import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type DefaultTheme, type HeadConfig } from 'vitepress';

const repo = 'https://github.com/chrischase011/avi-js';
const npm = 'https://www.npmjs.com/package/@avijs/core';
// GitHub Pages serves the site under /avi-js/; set DOCS_BASE=/ for a custom domain.
const base = process.env['DOCS_BASE'] ?? '/avi-js/';
// The public address, for canonical links, link previews and the sitemap.
const site = process.env['DOCS_URL'] ?? 'https://chrischase011.github.io/avi-js/';

const { version } = JSON.parse(
  readFileSync(new URL('../../../packages/core/package.json', import.meta.url), 'utf8'),
) as { version: string };

/** One sidebar entry per chapter, titled from its first heading. */
function chapters(): DefaultTheme.SidebarItem[] {
  const dir = fileURLToPath(new URL('../tutorial/', import.meta.url));
  return readdirSync(dir)
    .filter((file) => /^\d\d-.+\.md$/.test(file))
    .sort()
    .map((file) => {
      const heading = /^# (.+)$/m.exec(readFileSync(`${dir}/${file}`, 'utf8'))?.[1] ?? file;
      return { text: heading, link: `/tutorial/${file.replace(/\.md$/, '')}` };
    });
}

/** A page's first prose paragraph, as plain text for its meta description. */
function summary(markdown: string): string | undefined {
  const paragraph = markdown
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^```[\s\S]*?^```/gm, '')
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block.length >= 70 && !/^(#|>|```|\||-|\*|\d+\.|<|:::)/.test(block));
  if (!paragraph) return undefined;
  const text = paragraph
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/\s+/g, ' ');
  return text.length <= 160 ? text : `${text.slice(0, 157).replace(/\s+\S*$/, '')}…`;
}

export default defineConfig({
  title: 'Avi.js',
  description:
    'Structure without the overhead. A TypeScript framework for Node.js with modules, controllers and dependency injection, without reflect-metadata.',
  base,
  cleanUrls: true,
  // The tutorial mentions http://localhost:3000; every other link must resolve.
  ignoreDeadLinks: 'localhostLinks',
  head: [
    ['link', { rel: 'icon', href: `${base}favicon.ico`, sizes: '48x48' }],
    ['link', { rel: 'icon', href: `${base}favicon.svg`, type: 'image/svg+xml' }],
    ['link', { rel: 'apple-touch-icon', href: `${base}apple-touch-icon.png` }],
    ['meta', { name: 'theme-color', content: '#0F766E' }],
    ['meta', { property: 'og:site_name', content: 'Avi.js' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
  ],
  sitemap: { hostname: site },
  transformPageData(pageData, { siteConfig }) {
    if (pageData.frontmatter['description']) return;
    const markdown = readFileSync(`${siteConfig.srcDir}/${pageData.relativePath}`, 'utf8');
    const description = summary(markdown);
    if (description) pageData.description = description;
  },
  transformHead({ pageData, title, description }) {
    if (pageData.isNotFound) return;
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
    const url = new URL(path, site).href;
    const image = new URL('social.png', site).href;
    const head: HeadConfig[] = [
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:type', content: path === '' ? 'website' : 'article' }],
      ['meta', { property: 'og:url', content: url }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:image', content: image }],
      ['meta', { property: 'og:image:width', content: '1200' }],
      ['meta', { property: 'og:image:height', content: '630' }],
      ['meta', { property: 'og:image:alt', content: 'Avi.js: structure without the overhead.' }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
      ['meta', { name: 'twitter:image', content: image }],
    ];
    if (path === '') {
      head.push([
        'script',
        { type: 'application/ld+json' },
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'SoftwareSourceCode',
          name: 'Avi.js',
          description,
          url: site,
          codeRepository: repo,
          programmingLanguage: 'TypeScript',
          runtimePlatform: 'Node.js',
          license: 'https://opensource.org/licenses/MIT',
          version,
        }),
      ]);
    }
    return head;
  },
  themeConfig: {
    logo: { light: '/mark.svg', dark: '/mark-dark.svg', alt: '' },
    nav: [
      { text: 'Guide', link: '/tutorial/00-getting-started', activeMatch: '/tutorial/' },
      { text: 'Examples', link: '/examples' },
      {
        text: `v${version}`,
        items: [
          { text: 'Changelog', link: `${repo}/blob/main/CHANGELOG.md` },
          { text: 'Contributing', link: `${repo}/blob/main/CONTRIBUTING.md` },
        ],
      },
    ],
    sidebar: {
      '/tutorial/': [
        { text: 'Tutorial', items: [{ text: 'Overview', link: '/tutorial/' }, ...chapters()] },
      ],
    },
    socialLinks: [
      { icon: 'github', link: repo },
      { icon: 'npm', link: npm },
    ],
    search: { provider: 'local' },
    editLink: {
      // Pages are copied from the repository, so edits go to the original file. VitePress runs
      // this in the browser, so it cannot use anything defined outside it.
      pattern: ({ filePath }) => {
        const source =
          filePath === 'tutorial/index.md'
            ? 'docs/tutorial/README.md'
            : filePath.startsWith('tutorial/')
              ? `docs/${filePath}`
              : filePath === 'examples.md'
                ? 'examples/README.md'
                : `web/src/${filePath}`;
        return `https://github.com/chrischase011/avi-js/edit/main/${source}`;
      },
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 Christopher Robin Chase',
    },
  },
});
