import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Tabs } from '@mantine/core';
import { IconChartPie, IconInbox, IconMail, IconWorldSearch } from '@tabler/icons-react';
import { StorageReportResult, withRefresh } from '../../api';
import { CACHE_KEYS } from '../../lib/pageCache';
import { useApi } from '../../lib/useApi';
import { ICON, Page, RefreshButton } from '../../ui';
import { BrowseMailbox } from './BrowseMailbox';
import { DomainSearch } from './DomainSearch';
import { MessageModal } from './MessageModal';
import { StorageReport } from './StorageReport';

/** Email audit page: storage overview (the default), per-mailbox browsing, and domain-wide search. */
export function EmailAudit() {
  const [detail, setDetail] = useState<{ user: string; id: string } | null>(null);
  const [searchParams] = useSearchParams();
  // Lets other pages (Drive, Storage report) deep-link straight into one mailbox.
  const initialEmail = searchParams.get('user');
  // Storage leads (a Drive-audit-style overview of every mailbox); a deep-link to
  // one mailbox opens Browse instead.
  const [activeTab, setActiveTab] = useState<string | null>(initialEmail ? 'browse' : 'storage');

  // Storage-report load is owned here (not in StorageReport) so its Refresh
  // control can sit on the page title line like Drive audit, and so returning to
  // the tab shows the cached report instead of refetching. Fetches the first
  // time the Storage tab is shown (enabled), then leaves it cached.
  const {
    data: storage,
    error: storageError,
    loading: storageLoading,
    reload: loadStorage,
  } = useApi<StorageReportResult>((refresh) => withRefresh('/api/mail/storage/report', refresh), {
    cacheKey: CACHE_KEYS.mailStorage,
    enabled: activeTab === 'storage',
  });

  // A "View mailbox" link elsewhere can fire while already on this page (e.g.
  // from the Storage tab) — the route doesn't change, so jump tabs explicitly.
  useEffect(() => {
    if (initialEmail) setActiveTab('browse');
  }, [initialEmail]);

  return (
    <Page
      title="Email audit"
      actions={
        activeTab === 'storage' ? (
          <RefreshButton loading={storageLoading} onClick={() => loadStorage(true)}>
            Refresh report
          </RefreshButton>
        ) : undefined
      }
    >
      <Alert color="blue" icon={<IconMail size={ICON.md} aria-hidden />} py="xs">
        Read-only mailbox access via domain-wide delegation. These reads appear in Google's admin audit logs.
      </Alert>
      <Tabs value={activeTab} onChange={setActiveTab} keepMounted={false} className="gam-page-tabs">
        <Tabs.List>
          <Tabs.Tab value="storage" leftSection={<IconChartPie size={ICON.md} aria-hidden />}>
            Storage
          </Tabs.Tab>
          <Tabs.Tab value="browse" leftSection={<IconInbox size={ICON.md} aria-hidden />}>
            Browse mailbox
          </Tabs.Tab>
          <Tabs.Tab value="domain" leftSection={<IconWorldSearch size={ICON.md} aria-hidden />}>
            Domain search
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="storage" pt="md">
          <StorageReport data={storage} error={storageError} />
        </Tabs.Panel>
        <Tabs.Panel value="browse" pt="md">
          <BrowseMailbox initialEmail={initialEmail} onOpen={(user, id) => setDetail({ user, id })} />
        </Tabs.Panel>
        <Tabs.Panel value="domain" pt="md">
          <DomainSearch onOpen={(user, id) => setDetail({ user, id })} />
        </Tabs.Panel>
      </Tabs>
      <MessageModal target={detail} onClose={() => setDetail(null)} />
    </Page>
  );
}
