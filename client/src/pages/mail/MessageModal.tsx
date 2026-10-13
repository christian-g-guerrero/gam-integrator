import { useEffect, useState } from 'react';
import { Badge, Card, Group, Modal, ScrollArea, Stack, Text } from '@mantine/core';
import { api, endpoints, MailDetail } from '../../api';
import { fmtDate } from '../../lib/format';
import { ErrorAlert, LoadingState } from '../../ui';
import { labelName } from './labels';

/** Full message view (headers + plain-text body). */
export function MessageModal({
  target,
  onClose,
}: {
  target: { user: string; id: string } | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<MailDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setError(null);
    if (!target) return;
    // Stale-response guard: opening another message before this one loads must not show the old one.
    let stale = false;
    api<MailDetail>(endpoints.mailMessage(target.user, target.id)).then(
      (d) => {
        if (!stale) setDetail(d);
      },
      (e: Error) => {
        if (!stale) setError(e.message);
      },
    );
    return () => {
      stale = true;
    };
  }, [target]);

  if (!target) return null;
  const title = detail ? detail.subject || '(no subject)' : error ? 'Message' : 'Loading message…';
  return (
    <Modal opened onClose={onClose} size="xl" title={title}>
      {error ? (
        <ErrorAlert title="Could not load message">{error}</ErrorAlert>
      ) : !detail ? (
        <LoadingState label="Loading message…" />
      ) : (
        <Stack gap="xs">
          <Group gap="xs">
            <Badge variant="light" tt="none" size="sm">
              {detail.user}
            </Badge>
            {detail.labels
              .filter((l) => !l.startsWith('CATEGORY_'))
              .map((l) => (
                <Badge key={l} variant="outline" color="gray" size="sm">
                  {labelName(l)}
                </Badge>
              ))}
          </Group>
          <Text size="sm">
            <b>From:</b> {detail.from}
          </Text>
          <Text size="sm">
            <b>To:</b> {detail.to}
          </Text>
          {detail.cc && (
            <Text size="sm">
              <b>Cc:</b> {detail.cc}
            </Text>
          )}
          <Text size="sm">
            <b>Date:</b> {fmtDate(detail.date)}
          </Text>
          <ScrollArea.Autosize mah={420}>
            <Card padding="sm">
              <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {detail.body || '(empty body)'}
              </Text>
            </Card>
          </ScrollArea.Autosize>
        </Stack>
      )}
    </Modal>
  );
}
