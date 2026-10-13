import { useMemo } from 'react';
import { Select, type SelectProps } from '@mantine/core';
import { WorkspaceUser } from '../api';
import { useUsers } from '../lib/useUsers';
import { ErrorAlert } from '../ui';

type UserSelectProps = Omit<SelectProps, 'data'> & {
  /** Override one option's label (e.g. to flag the current owner); default "Name <email>". */
  optionLabel?: (u: WorkspaceUser) => string;
};

const defaultLabel = (u: WorkspaceUser) => `${u.name} <${u.email}>`;

/** Searchable workspace-user picker. Loads the shared users list; a failed load replaces it with an inline error. */
export function UserSelect({ optionLabel = defaultLabel, placeholder = 'Pick a user…', ...props }: UserSelectProps) {
  const { data: users, error } = useUsers();
  const options = useMemo(
    () => (users ?? []).map((u) => ({ value: u.email, label: optionLabel(u) })),
    [users, optionLabel],
  );
  if (error) return <ErrorAlert title="Could not load users">{error}</ErrorAlert>;
  return (
    <Select
      searchable
      data={options}
      disabled={!users}
      placeholder={users ? placeholder : 'Loading users…'}
      {...props}
    />
  );
}
