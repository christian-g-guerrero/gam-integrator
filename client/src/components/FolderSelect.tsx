import { useMemo } from 'react';
import { Select, type SelectProps } from '@mantine/core';
import { DriveFile, endpoints } from '../api';
import { useApi } from '../lib/useApi';
import { ErrorAlert } from '../ui';

type FolderSelectProps = Omit<SelectProps, 'data'> & {
  /** Whose Drive to list. Fetched on mount — give the component `key={owner}` if the owner can change. */
  owner: string;
  /** Ids to leave out (the items being moved can't be their own destination). */
  exclude?: string[];
  /** Label for the Drive root option (value `'root'`). */
  rootLabel?: string;
};

/** Destination-folder picker over one user's Drive. A failed load replaces it with an inline error. */
export function FolderSelect({
  owner,
  exclude,
  rootLabel = 'My Drive (root)',
  placeholder = 'Choose a folder…',
  ...props
}: FolderSelectProps) {
  const { data: files, error } = useApi<DriveFile[]>(endpoints.userFiles(owner));
  const excludeKey = exclude?.join('\n') ?? '';
  const options = useMemo(() => {
    const skip = new Set(excludeKey.split('\n'));
    const folders = (files ?? []).filter((f) => f.isFolder && !skip.has(f.id));
    return [{ value: 'root', label: rootLabel }, ...folders.map((f) => ({ value: f.id, label: f.name }))];
  }, [files, excludeKey, rootLabel]);
  if (error) return <ErrorAlert title={`Could not load ${owner}'s folders`}>{error}</ErrorAlert>;
  return (
    <Select
      searchable
      data={options}
      disabled={!files}
      placeholder={files ? placeholder : 'Loading folders…'}
      {...props}
    />
  );
}
