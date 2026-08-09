import Sidebar from '@/components/Sidebar';
import GlobalStoreBar from '@/components/GlobalStore';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar />
      <main className="lg:pl-56">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex justify-end mb-3">
            <GlobalStoreBar />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
