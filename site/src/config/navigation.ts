export interface NavItem {
  title: string
  href: string
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

export const navigation: NavGroup[] = [
  {
    title: 'Getting Started',
    items: [
      { title: 'Introduction', href: '/docs' },
      { title: 'Quickstart', href: '/docs/quickstart' },
      { title: 'Installation', href: '/docs/installation' },
      { title: 'Configuration', href: '/docs/configuration' },
    ],
  },
  {
    title: 'Guides',
    items: [
      { title: 'Sending Errors', href: '/docs/sending-errors' },
      { title: 'Error Grouping', href: '/docs/error-grouping' },
      { title: 'Tags', href: '/docs/tags' },
      { title: 'Filtering & Search', href: '/docs/filtering' },
      { title: 'Teams', href: '/docs/teams' },
      { title: 'Deployment', href: '/docs/deployment' },
    ],
  },
  {
    title: 'Ingestion Reference',
    items: [
      { title: 'Authentication', href: '/docs/api/authentication' },
      { title: 'Errors Endpoint', href: '/docs/api/errors' },
    ],
  },
]
