import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMediaQuery } from '@mantine/hooks';
import { Alert, Anchor, Badge, Button, Code, Group, List, Stack, Stepper, Text, TextInput, Title } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconExternalLink, IconPlayerPlay, IconX } from '@tabler/icons-react';
import { post, SetupStatus } from '../api';
import { Term } from '../components/Term';
import { AccentCard, Hint, ICON, notifyError, RefreshButton } from '../ui';

const STEPS = ['detect', 'install', 'project', 'oauth', 'delegation', 'verify'] as const;
const ADMIN_EMAIL_LABEL = 'Super-admin email';
const SETUP_COMPLETE = 'Setup complete';
type StepId = (typeof STEPS)[number];

interface VerifyResult {
  ok: boolean;
  results: { check: string; ok: boolean; output: string }[];
}

export function SetupWizard({ status, onStatusChange }: { status: SetupStatus | null; onStatusChange: () => void }) {
  const [active, setActive] = useState<number>(() => initialStep(status));
  const [session, setSession] = useState<{ id: string; step: StepId } | null>(null);
  const [sessionExit, setSessionExit] = useState<number | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [adminEmail, setAdminEmail] = useState(status?.state.adminEmail ?? '');
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  const gam = status?.gam;
  // Six labelled steps only fit on one row of the (focused-width) page from the lg breakpoint up — below
  // that a horizontal stepper wraps 4 + 2 with a stretched connector, so it becomes a vertical checklist,
  // which also has room for each step's one-line description.
  const wide = useMediaQuery('(min-width: 75em)', true, { getInitialValueInEffect: false });
  const desc = (d: string) => (wide ? undefined : d);

  async function startSession(step: StepId, serverStep: string) {
    try {
      if (step === 'delegation' || step === 'project') {
        // create project also wants the admin email persisted for later steps
        if (adminEmail) await post('/api/setup/state', { adminEmail });
      }
      const { sessionId } = await post<{ sessionId: string }>('/api/setup/session', { step: serverStep });
      setUrls([]);
      setSessionExit(null);
      setSession({ id: sessionId, step });
    } catch (e) {
      notifyError('Could not start step', e);
    }
  }

  function handleOutput(chunk: string) {
    // eslint-disable-next-line no-control-regex -- \x1b ends a URL at the next ANSI escape in PTY output
    const found = chunk.match(/https?:\/\/[^\s'"\x1b)>\]]+/g);
    if (!found) return;
    setUrls((prev) => {
      const next = [...prev];
      for (const u of found) {
        const clean = u.replace(/[.,]+$/, '');
        if (!next.includes(clean) && !clean.includes('github.com/GAM-team')) next.push(clean);
      }
      return next.slice(-6);
    });
  }

  async function runVerify() {
    setVerifying(true);
    try {
      if (adminEmail) await post('/api/setup/state', { adminEmail });
      const result = await post<VerifyResult>('/api/setup/verify', {});
      setVerify(result);
      // Past the last step = Mantine marks every step (including Verify) complete.
      setActive(result.ok ? STEPS.length : STEPS.indexOf('verify'));
      onStatusChange();
    } catch (e) {
      notifyError('Could not verify setup', e);
    } finally {
      setVerifying(false);
    }
  }

  // The step's Run button is the primary action until it succeeds; then "continue" takes over as the one filled button.
  const runVariant = (step: StepId) => (session?.step === step && sessionExit === 0 ? 'light' : 'filled');

  const terminal = session && (
    <Stack gap="xs" mt="sm">
      <Term
        sessionId={session.id}
        onOutput={handleOutput}
        onExit={(code) => {
          setSessionExit(code);
          onStatusChange();
        }}
      />
      {urls.length > 0 && (
        <AccentCard padding="sm">
          <Text size="sm" fw={600} mb="xs">
            Links detected in the output — GAM wants you to open these in your browser:
          </Text>
          <Stack gap="xs">
            {urls.map((u) => (
              <Anchor key={u} href={u} target="_blank" rel="noreferrer" size="sm">
                <Group gap="xs" wrap="nowrap">
                  <IconExternalLink size={ICON.xs} aria-hidden style={{ flexShrink: 0 }} />
                  <span style={{ wordBreak: 'break-all' }}>{u}</span>
                </Group>
              </Anchor>
            ))}
          </Stack>
        </AccentCard>
      )}
      <Hint>
        The terminal above is live — click it and type to answer GAM's prompts.
        {sessionExit !== null && ` Process finished (exit code ${sessionExit}).`}
      </Hint>
    </Stack>
  );

  const stepDone = sessionExit === 0;

  const verifyPanel = (
    <Stack gap="xs">
      <TextInput
        label={ADMIN_EMAIL_LABEL}
        description="Used for the service-account check."
        placeholder="admin@yourdomain.com"
        value={adminEmail}
        onChange={(e) => setAdminEmail(e.currentTarget.value)}
        maw={360}
      />
      <Group>
        <Button
          onClick={() => void runVerify()}
          loading={verifying}
          leftSection={<IconCheck size={ICON.md} aria-hidden />}
        >
          Run verification
        </Button>
      </Group>
      {verify && (
        <Stack gap="xs">
          {verify.results.map((r) => (
            <Alert
              key={r.check}
              color={r.ok ? 'green' : 'red'}
              icon={r.ok ? <IconCheck size={ICON.md} aria-hidden /> : <IconX size={ICON.md} aria-hidden />}
              title={
                <Group gap="xs">
                  {r.check}{' '}
                  <Badge color={r.ok ? 'green' : 'red'} variant="light">
                    {r.ok ? 'OK' : 'Failed'}
                  </Badge>
                </Group>
              }
            >
              <Code block mah={180} style={{ overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                {r.output || '(no output)'}
              </Code>
            </Alert>
          ))}
          {verify.ok && (
            <Alert color="green" icon={<IconCheck size={ICON.md} aria-hidden />} title={SETUP_COMPLETE}>
              GAM is fully configured. Head to{' '}
              <Anchor component={Link} to="/users" inherit>
                Drive audit
              </Anchor>{' '}
              to start managing Drive.
            </Alert>
          )}
        </Stack>
      )}
    </Stack>
  );

  return (
    <Stack gap="sm">
      <Text c="dimmed" size="sm">
        This walks you through installing GAM7, creating a Google Cloud project for it, and authorizing it against your
        Workspace domain. You'll need a <b>super-admin account</b> for your Google Workspace. Progress is saved — you
        can close this page and come back.
      </Text>
      <Stepper
        active={active}
        onStepClick={setActive}
        size="sm"
        allowNextStepsSelect
        orientation={wide ? 'horizontal' : 'vertical'}
        // Mantine spaces vertical steps an `xl` apart — too airy for a six-item checklist.
        styles={
          wide
            ? undefined
            : {
                step: {
                  minHeight: 'calc(var(--stepper-icon-size) + var(--mantine-spacing-xs) + var(--separator-spacing))',
                },
              }
        }
      >
        <Stepper.Step label="Detect" description={desc('Find GAM')}>
          <StepCard
            title="Check for an existing GAM installation"
            body={
              <Stack gap="xs">
                {gam?.installed ? (
                  <Alert color="green" icon={<IconCheck size={ICON.md} aria-hidden />}>
                    Found GAM at <Code>{gam.gamPath}</Code> — {gam.version}
                    {gam.configured && ' — and it is already fully configured. You can skip to Verify.'}
                  </Alert>
                ) : (
                  <Alert color="orange" icon={<IconAlertTriangle size={ICON.md} aria-hidden />}>
                    GAM was not found on this machine. Continue to the next step to install it.
                  </Alert>
                )}
                <Group>
                  <RefreshButton size="sm" onClick={onStatusChange} />
                  <Button onClick={() => setActive(gam?.configured ? 5 : gam?.installed ? 2 : 1)}>Continue</Button>
                </Group>
              </Stack>
            }
          />
        </Stepper.Step>

        <Stepper.Step label="Install" description={desc('GAM7 binary')}>
          <StepCard
            title="Install GAM7"
            body={
              <Stack gap="xs">
                <Text size="sm">
                  This runs the official GAM7 install script from the GAM-team project (
                  <Code>{status?.installCmd}</Code>). It downloads GAM into <Code>~/bin/gam7</Code>. Watch the terminal
                  — it may ask a couple of questions (answer <Code>y</Code>/<Code>n</Code> as you prefer; you do{' '}
                  <b>not</b> need to let it create a project yet — the next steps handle that).
                </Text>
                <Group>
                  <Button
                    leftSection={<IconPlayerPlay size={ICON.md} aria-hidden />}
                    variant={runVariant('install')}
                    onClick={() => void startSession('install', 'install')}
                    disabled={session?.step === 'install' && sessionExit === null}
                  >
                    Run installer
                  </Button>
                  {session?.step === 'install' && stepDone && (
                    <Button onClick={() => setActive(2)}>Installer finished — continue</Button>
                  )}
                </Group>
                {session?.step === 'install' && terminal}
              </Stack>
            }
          />
        </Stepper.Step>

        <Stepper.Step label="Cloud project" description={desc('gam create project')}>
          <StepCard
            title="Create a Google Cloud project for GAM"
            body={
              <Stack gap="xs">
                <Text size="sm">
                  GAM needs its own Google Cloud project with the right APIs enabled. <Code>gam create project</Code>{' '}
                  automates most of it. Expect the following prompts in the terminal:
                </Text>
                <List size="sm" spacing="xs">
                  <List.Item>
                    Your <b>super-admin email</b> — enter it below first so the app remembers it.
                  </List.Item>
                  <List.Item>A browser window/link to sign in to Google and grant access.</List.Item>
                  <List.Item>
                    Near the end it asks you to open the Cloud Console credentials page, create an{' '}
                    <b>OAuth client ID</b> of type <b>Desktop app</b>, and paste the Client ID and Secret back into the
                    terminal. Any links GAM prints are listed below the terminal so you can open them.
                  </List.Item>
                </List>
                <TextInput
                  label={ADMIN_EMAIL_LABEL}
                  placeholder="admin@yourdomain.com"
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.currentTarget.value)}
                  maw={360}
                />
                <Group>
                  <Button
                    leftSection={<IconPlayerPlay size={ICON.md} aria-hidden />}
                    variant={runVariant('project')}
                    onClick={() => void startSession('project', 'create-project')}
                    disabled={!adminEmail || (session?.step === 'project' && sessionExit === null)}
                  >
                    Run gam create project
                  </Button>
                  {session?.step === 'project' && stepDone && (
                    <Button onClick={() => setActive(3)}>Project created — continue</Button>
                  )}
                </Group>
                {session?.step === 'project' && terminal}
              </Stack>
            }
          />
        </Stepper.Step>

        <Stepper.Step label="Authorize" description={desc('gam oauth create')}>
          <StepCard
            title="Authorize GAM as your admin (OAuth)"
            body={
              <Stack gap="xs">
                <Text size="sm">
                  <Code>gam oauth create</Code> grants GAM permission to act as your admin account. The terminal will
                  list API scopes — pressing <Code>Enter</Code> to accept the defaults is fine — then give you a Google
                  sign-in link. Sign in with the same super-admin account.
                </Text>
                <Group>
                  <Button
                    leftSection={<IconPlayerPlay size={ICON.md} aria-hidden />}
                    variant={runVariant('oauth')}
                    onClick={() => void startSession('oauth', 'oauth')}
                    disabled={session?.step === 'oauth' && sessionExit === null}
                  >
                    Run gam oauth create
                  </Button>
                  {session?.step === 'oauth' && stepDone && (
                    <Button onClick={() => setActive(4)}>Authorized — continue</Button>
                  )}
                </Group>
                {session?.step === 'oauth' && terminal}
              </Stack>
            }
          />
        </Stepper.Step>

        <Stepper.Step label="Delegation" description={desc('Service account')}>
          <StepCard
            title="Enable domain-wide delegation"
            body={
              <Stack gap="xs">
                <Text size="sm">
                  To read and manage <b>other users'</b> Drive files (the whole point of this app), GAM's service
                  account needs domain-wide delegation. <Code>gam user &lt;admin&gt; update serviceaccount</Code> prints
                  an authorization link into the Admin Console — open it, paste the scopes it shows, and authorize.
                </Text>
                <Group>
                  <Button
                    leftSection={<IconPlayerPlay size={ICON.md} aria-hidden />}
                    variant={runVariant('delegation')}
                    onClick={() => void startSession('delegation', 'serviceaccount')}
                    disabled={session?.step === 'delegation' && sessionExit === null}
                  >
                    Run serviceaccount setup
                  </Button>
                  {session?.step === 'delegation' && stepDone && (
                    <Button onClick={() => setActive(5)}>Continue to verify</Button>
                  )}
                </Group>
                {session?.step === 'delegation' && terminal}
              </Stack>
            }
          />
        </Stepper.Step>

        <Stepper.Step label="Verify" description={desc('Final checks')}>
          <StepCard title="Verify everything works" body={verifyPanel} />
        </Stepper.Step>

        <Stepper.Completed>
          <StepCard
            title={SETUP_COMPLETE}
            body={
              <Stack gap="xs">
                {!verify && <Hint>GAM is configured and passed verification. Run it again any time to re-check.</Hint>}
                {verifyPanel}
              </Stack>
            }
          />
        </Stepper.Completed>
      </Stepper>
    </Stack>
  );
}

/** One step's content. Sits inside Settings' "GAM setup" <Section> (h3), so the step title is an h4. */
function StepCard({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <Stack gap="sm" mt="md">
      <Title order={4} size="h5">
        {title}
      </Title>
      {body}
    </Stack>
  );
}

function initialStep(status: SetupStatus | null): number {
  if (!status) return 0;
  if (status.gam.configured && status.state.setupDone) return STEPS.length; // verified: all steps checked
  if (status.gam.configured) return 5;
  if (status.gam.oauthReady) return 4;
  if (status.gam.installed) return 2;
  return 0;
}
