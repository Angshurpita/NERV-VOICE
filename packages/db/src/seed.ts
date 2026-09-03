import bcrypt from 'bcryptjs';
import { TABLES, type Database } from './index.js';
import { cryptoRandomId } from './store.js';

export async function ensureSeedData(db: Database): Promise<void> {
  const now = new Date();
  const daysAgo = (d: number, hours = 0) => {
    const dt = new Date(now.getTime() - (d * 86400000) - (hours * 3600000));
    return dt.toISOString();
  };

  // ── Seed users ──────────────────────────────────────────────────────────────
  const defaultHash = await bcrypt.hash('Echosphere123', 10);
  
  const staff = [
    { email: 'admin@nerv.dev', fullName: 'Ops Admin', role: 'admin' as const, avatarColor: 'indigo' },
    { email: 'priya.nair@nerv.dev', fullName: 'Priya Nair', role: 'supervisor' as const, avatarColor: 'emerald' },
    { email: 'rohit.verma@nerv.dev', fullName: 'Rohit Verma', role: 'agent' as const, avatarColor: 'amber' },
    { email: 'ananya.sen@nerv.dev', fullName: 'Ananya Sen', role: 'agent' as const, avatarColor: 'rose' },
    { email: 'admin@echosphere.dev', fullName: 'Ops Admin', role: 'admin' as const, avatarColor: 'indigo' },
  ];

  const userMap = new Map<string, string>();
  for (const s of staff) {
    let existing = await db.users.findByEmail(s.email);
    if (!existing) {
      existing = await db.store.insert(TABLES.users, {
        id: cryptoRandomId(),
        email: s.email,
        passwordHash: defaultHash,
        fullName: s.fullName,
        phone: '+919876543210',
        role: s.role,
        avatarColor: s.avatarColor,
        locale: 'en' as const,
        theme: 'light' as const,
        density: 'comfortable' as const,
        notifyEscalations: true,
        notifyDigest: false,
        isActive: true,
        createdAt: daysAgo(30),
        lastLoginAt: daysAgo(0, 1),
      });
    } else {
      await db.store.update(TABLES.users, existing.id, {
        passwordHash: defaultHash,
        isActive: true,
      });
    }
    if (existing) {
      userMap.set(s.email, existing.id);
    }
  }

  console.log('[seed] Successfully ensured initial staff users with active credentials.');
}
