'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

const mobileLinks = [
  { href: '/dashboard', label: 'Home' },
  { href: '/dashboard/creatives', label: 'Creatives' },
  { href: '/dashboard/ads', label: 'Ad Spend' },
  { href: '/dashboard/daily', label: 'Daily Clearing' },
  { href: '/dashboard/products', label: 'Products' },
];

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="lg:hidden fixed top-0 left-0 right-0 z-50">
      {/* Top bar */}
      <div className="bg-slate-900 border-b border-slate-800 px-4 h-14 flex items-center justify-between">
        <h1 className="text-sm font-bold text-white">YM Global</h1>
        <button
          onClick={() => setOpen(!open)}
          className="p-2 text-slate-400 hover:text-white"
          aria-label="Toggle menu"
        >
          {open ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 space-y-1">
          {mobileLinks.map(link => {
            const active = pathname === link.href || (link.href !== '/dashboard' && pathname.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={`block px-3 py-2.5 rounded-lg text-sm font-medium ${
                  active ? 'bg-blue-600/10 text-blue-400' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
