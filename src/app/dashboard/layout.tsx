import Link from 'next/link';
import { requireAdmin } from '@/lib/auth';
import { logout } from '../login/actions';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <>
      <header className="topbar">
        <Link href="/dashboard" className="brand">
          <img src="/logo.png" alt="" />
          AHG53 WhatsApp
        </Link>
        <nav className="nav">
          <Link href="/dashboard">Overview</Link>
          <Link href="/dashboard/conversations">Conversations</Link>
          <Link href="/dashboard/leads">Leads</Link>
          <Link href="/dashboard/campaigns">Campaigns</Link>
          <Link href="/dashboard/templates">Templates</Link>
          <Link href="/dashboard/settings">Settings</Link>
        </nav>
        <form action={logout}>
          <button>Log out</button>
        </form>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
