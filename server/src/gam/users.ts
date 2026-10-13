import { runGamCsv } from './runner.js';

export interface DomainUser {
  email: string;
  name: string;
  suspended: boolean;
  orgUnitPath: string;
}

export async function listDomainUsers(): Promise<DomainUser[]> {
  const rows = await runGamCsv(['print', 'users', 'fields', 'primaryemail,name,suspended,orgunitpath']);
  return rows
    .map((r) => ({
      email: r.primaryEmail ?? r.primaryemail ?? '',
      name: r['name.fullName'] ?? r['name.givenName'] ?? '',
      suspended: /true/i.test(r.suspended ?? ''),
      orgUnitPath: r.orgUnitPath ?? r.orgunitpath ?? '',
    }))
    .filter((u) => u.email);
}
