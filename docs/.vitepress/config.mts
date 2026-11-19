import { defineConfig, type HeadConfig } from 'vitepress';

// Ziro Designer documentation site.
// Layout follows the EasyEDA docs model: a persistent, nested left sidebar
// tree that stays visible on every page, main content, and a right-hand
// "On this page" outline. Brand (colours + fonts) mirrors www.ziroeda.com.
export default defineConfig({
  title: 'Ziro Designer',
  titleTemplate: ':title · Ziro Designer Docs',
  description:
    'Documentation for Ziro Designer, the browser-native, open-source PCB engineering suite from ZIRO EDA.',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,
  // Contributor guide, kept in the repo but not rendered as a site page.
  srcExclude: ['CLAUDE.md'],
  appearance: 'dark', // brand is dark-first; toggle still available

  // Standalone docs site at docs.ziroeda.com (Cloudflare Pages project ziroeda-docs), served
  // from that project's root.

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#08080a' }],
    // Anonymous usage counts, the same as every ZiroEDA site: www.ziroeda.com/stats.js says what
    // is sent. The key comes from the build environment, as the designer's does; a build without
    // it (a fork, a local preview) adds nothing.
    ...(process.env.VITE_POSTHOG_KEY
      ? [
          [
            'script',
            {
              src: 'https://www.ziroeda.com/stats.js',
              'data-key': process.env.VITE_POSTHOG_KEY,
              'data-site': 'docs',
              defer: '',
            },
          ] as HeadConfig,
        ]
      : []),
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Ziro Designer',

    nav: [
      { text: 'Documentation', link: '/' },
      { text: 'Changelog', link: '/changelog' },
      { text: 'ziroeda.com', link: 'https://www.ziroeda.com' },
      { text: 'Launch App', link: 'https://designer.ziroeda.com' },
    ],

    // Content is authored from scratch. Add sections here as pages are created,
    // nesting them under one top group so they render as a tight, uniform list
    // of collapsible items. Example:
    //   sidebar: [{ text: "Documentation", items: [
    //     { text: "Introduction", collapsed: false, items: [
    //       { text: "Overview", link: "/introduction/" },
    //     ]},
    //   ]}],
    sidebar: [],

    outline: { level: [2, 3], label: 'On this page' },

    socialLinks: [{ icon: 'github', link: 'https://github.com/ZiroEDA/ziro-designer' }],

    search: { provider: 'local' },

    editLink: {
      pattern: 'https://github.com/ZiroEDA/ziro-designer/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },

    lastUpdated: {
      text: 'Last updated',
      formatOptions: { dateStyle: 'medium' },
    },

    footer: {
      message: 'Released under the GPL-3.0-or-later License.',
      copyright: '© ZIRO EDA · Ziro Designer',
    },

    docFooter: {
      prev: 'Previous',
      next: 'Next',
    },
  },
});
