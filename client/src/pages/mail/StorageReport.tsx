import { Stack } from '@mantine/core';
import { routes, StorageReportResult } from '../../api';
import { fmtDate } from '../../lib/format';
import { StorageTable } from '../../components/StorageTable';
import { ErrorAlert, Hint, LoadingState } from '../../ui';

interface StorageReportProps {
  data: StorageReportResult | null;
  error: string | null;
}

/**
 * Per-user storage, Gmail-first: the same table as the Dashboard, but a row opens the
 * mailbox instead of the Drive. Data and the Refresh control are owned by EmailAudit so
 * refresh can live on the page header.
 */
export function StorageReport({ data, error }: StorageReportProps) {
  return (
    <Stack gap="sm">
      {error && <ErrorAlert title="Could not load storage report">{error}</ErrorAlert>}
      {!data ? (
        !error && <LoadingState label="Loading storage report…" />
      ) : (
        <>
          <Hint>
            Report date: <b>{data.rows[0]?.reportDate ?? '—'}</b> (Google's usage reports lag ~2 days) · fetched{' '}
            {fmtDate(data.updatedAt)}
          </Hint>
          <StorageTable
            rows={data.rows}
            linkTo={routes.mailbox}
            storageKey="mail-storage"
            defaultSort="gmail"
            emptyMessage="No mailboxes in the storage report."
          />
          <Hint>
            Click a user to open their mailbox. Gmail usage over 5 GB is highlighted — use “Export mailbox” + attachment
            cleanup for the heavy ones.
          </Hint>
        </>
      )}
    </Stack>
  );
}
