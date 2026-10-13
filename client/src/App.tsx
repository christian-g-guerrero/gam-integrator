import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { NavLink as RouterNavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  ActionIcon,
  AppShell,
  Badge,
  Burger,
  Button,
  Divider,
  Group,
  NavLink,
  Overlay,
  Title,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconArrowsExchange,
  IconFolders,
  IconLayoutDashboard,
  IconListCheck,
  IconMailSearch,
  IconMoon,
  IconSettings,
  IconSun,
  IconTerminal2,
  IconUsers,
} from '@tabler/icons-react';
import { api, SetupStatus } from './api';
import { DISABLED_OPACITY, ErrorAlert, ICON, LoadingState } from './ui';
import './App.css';

// Pages load on first visit (one chunk each), so the terminal (xterm) and the mail views stay out of the
// initial bundle.
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Users = lazy(() => import('./pages/Users').then((m) => ({ default: m.Users })));
const Drive = lazy(() => import('./pages/Drive').then((m) => ({ default: m.Drive })));
const Transfer = lazy(() => import('./pages/Transfer').then((m) => ({ default: m.Transfer })));
const Jobs = lazy(() => import('./pages/Jobs').then((m) => ({ default: m.Jobs })));
const JobDetail = lazy(() => import('./pages/JobDetail').then((m) => ({ default: m.JobDetail })));
const Console = lazy(() => import('./pages/Console').then((m) => ({ default: m.Console })));
const EmailAudit = lazy(() => import('./pages/mail/EmailAudit').then((m) => ({ default: m.EmailAudit })));

export default function App() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();
  const { setColorScheme } = useMantineColorScheme();
  const computedScheme = useComputedColorScheme('light');
  // Narrow-screen navbar drawer. From `md` up the navbar is always shown (collapsed.desktop
  // stays false); below it — phones and portrait tablets, where a 240px sidebar would leave
  // ~480px for tables — it collapses to an overlay the burger toggles.
  const [mobileNavOpened, { toggle: toggleMobileNav, close: closeMobileNav }] = useDisclosure(false);

  // Tapping a nav item navigates *and* dismisses the mobile drawer — otherwise it would
  // stay open over the page the user just chose. No-op on desktop (drawer isn't shown).
  useEffect(() => {
    closeMobileNav();
  }, [location.pathname, closeMobileNav]);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api<SetupStatus>('/api/setup/status'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  // A status probe runs several GAM subprocesses (version/oauth/domain), so
  // don't fire it on every page switch — only on load, while unhealthy, or
  // around the Setup page (the one place GAM state changes under us).
  const ready = status?.gam.configured ?? false;
  const onSetup = location.pathname.startsWith('/settings');
  useEffect(() => {
    if (!status || error || !ready || onSetup) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, location.pathname]);

  // Bounded retry while the probe is unhealthy — a one-off failure (e.g. the
  // backend not up yet) shouldn't leave nav items disabled forever with no
  // recovery path other than manually navigating. Stops as soon as `error`
  // clears; never polls while healthy (see the comment above).
  useEffect(() => {
    if (!error) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [error, refresh]);

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 240, breakpoint: 'md', collapsed: { mobile: !mobileNavOpened } }}
      padding={{ base: 'md', sm: 'lg' }}
    >
      <AppShell.Header px="md">
        <Group h="100%" justify="space-between" wrap="nowrap" gap="sm">
          <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
            <Burger
              opened={mobileNavOpened}
              onClick={toggleMobileNav}
              hiddenFrom="md"
              size="sm"
              aria-label="Toggle navigation"
            />
            <IconFolders
              size={ICON.brand}
              color="var(--mantine-primary-color-filled)"
              style={{ flexShrink: 0 }}
              aria-hidden
            />
            {/* Truncates instead of pushing the header controls off-screen when space is tight. */}
            <Title
              order={3}
              style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              GAM Integrator
            </Title>
          </Group>
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            {/* MOCK and "connected" are informational — hidden below sm to keep the header
                uncluttered on phones. "Setup required" is actionable, so it always shows. */}
            {status?.gam.mock && (
              <Badge color="gray" variant="light" visibleFrom="sm">
                Mock mode
              </Badge>
            )}
            {status &&
              (ready ? (
                <Badge color="green" variant="light" visibleFrom="sm">
                  GAM connected{status.gam.version ? ` · ${status.gam.version.split(' ').slice(0, 2).join(' ')}` : ''}
                </Badge>
              ) : (
                <Badge color="orange" variant="light">
                  Setup required
                </Badge>
              ))}
            <Tooltip label={computedScheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
              <ActionIcon
                variant="default"
                size="lg"
                aria-label="Toggle color scheme"
                onClick={() => setColorScheme(computedScheme === 'dark' ? 'light' : 'dark')}
              >
                {computedScheme === 'dark' ? (
                  <IconSun size={ICON.md} aria-hidden />
                ) : (
                  <IconMoon size={ICON.md} aria-hidden />
                )}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      {/* Mobile drawer scrim: AppShell has no built-in navbar overlay, so this dims the page
          below the header and closes the drawer on a tap outside it. Sits one z-step under the
          navbar (AppShell puts it at zIndex + 1); never rendered at md and up. */}
      {mobileNavOpened && (
        <Overlay
          fixed
          hiddenFrom="md"
          top={56}
          zIndex={100}
          backgroundOpacity={0.35}
          onClick={closeMobileNav}
          aria-hidden
        />
      )}

      <AppShell.Navbar p="xs" className="gam-navbar">
        {/* Settings leads while unconfigured (its GAM wizard is the only usable
            item); once the domain is connected it's rarely needed again, so it
            drops below a divider instead of permanently occupying the top slot. */}
        {!ready && <NavItem to="/settings" label="Settings" icon={<IconSettings size={ICON.nav} aria-hidden />} />}
        <NavItem
          to="/dashboard"
          label="Dashboard"
          icon={<IconLayoutDashboard size={ICON.nav} aria-hidden />}
          disabled={!ready}
          disabledReason="Finish setup first"
        />
        <NavItem
          to="/users"
          label="Drive audit"
          icon={<IconUsers size={ICON.nav} aria-hidden />}
          disabled={!ready}
          disabledReason="Finish setup first"
        />
        {/* Transfer ownership is a Drive-audit action, so it's nested (indented) under it.
            It stays its own nav item rather than a Mantine child link because a NavLink with
            children can't navigate — clicking it only toggles the collapse. */}
        <NavItem
          to="/transfer"
          label="Transfer ownership"
          icon={<IconArrowsExchange size={ICON.nav} aria-hidden />}
          disabled={!ready}
          disabledReason="Finish setup first"
          nested
        />
        <NavItem
          to="/mail"
          label="Email audit"
          icon={<IconMailSearch size={ICON.nav} aria-hidden />}
          disabled={!ready}
          disabledReason="Finish setup first"
        />
        <NavItem
          to="/jobs"
          label="Jobs"
          icon={<IconListCheck size={ICON.nav} aria-hidden />}
          disabled={!ready}
          disabledReason="Finish setup first"
        />
        {/* Console stays available during setup — needed for fix-up commands like `gam upload sakey` */}
        <NavItem
          to="/console"
          label="Command console"
          icon={<IconTerminal2 size={ICON.nav} aria-hidden />}
          disabled={!status?.gam.installed}
          disabledReason="Install GAM first"
        />
        {ready && (
          <>
            <Divider my="xs" />
            <NavItem to="/settings" label="Settings" icon={<IconSettings size={ICON.nav} aria-hidden />} />
          </>
        )}
      </AppShell.Navbar>

      <AppShell.Main>
        {error && (
          <ErrorAlert title="Could not reach the local server">
            {error} — is the backend running? Relaunch the app (<code>start.command</code>) or run{' '}
            <code>npm run dev</code>.
            <Group mt="xs">
              <Button size="xs" variant="light" onClick={() => void refresh()}>
                Retry
              </Button>
            </Group>
          </ErrorAlert>
        )}
        {!status && !error ? (
          <LoadingState label="Checking GAM status…" />
        ) : (
          <Suspense fallback={<LoadingState label="Loading page…" />}>
            <Routes>
              <Route path="/" element={<Navigate to={ready ? '/dashboard' : '/settings'} replace />} />
              <Route path="/settings" element={<Settings status={status} onStatusChange={refresh} />} />
              {/* Old path kept as a redirect so bookmarks / muscle memory still land. */}
              <Route path="/setup" element={<Navigate to="/settings" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/users" element={<Users />} />
              <Route path="/users/:email" element={<Drive />} />
              <Route path="/transfer" element={<Transfer />} />
              <Route path="/jobs" element={<Jobs />} />
              <Route path="/jobs/:id" element={<JobDetail />} />
              <Route path="/console" element={<Console />} />
              <Route path="/mail" element={<EmailAudit />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        )}
      </AppShell.Main>
    </AppShell>
  );
}

function NavItem({
  to,
  label,
  icon,
  disabled,
  disabledReason,
  nested,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  /** Shown in a tooltip when disabled, so a greyed-out item explains itself. */
  disabledReason?: string;
  /** Indents the item so it reads as a sub-item of the row above it. */
  nested?: boolean;
}) {
  const link = (
    <NavLink
      component={RouterNavLink}
      to={to}
      label={label}
      leftSection={icon}
      disabled={disabled}
      pl={nested ? 'xl' : undefined}
      style={disabled ? { pointerEvents: 'none', opacity: DISABLED_OPACITY } : undefined}
    />
  );
  if (!disabled || !disabledReason) return link;
  return (
    <Tooltip label={disabledReason} position="right">
      {/* The NavLink above is pointer-events:none, so this wrapper is what actually receives the hover. */}
      <div style={{ pointerEvents: 'auto' }}>{link}</div>
    </Tooltip>
  );
}
