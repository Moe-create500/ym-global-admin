import Sidebar from '@/components/Sidebar';
import GlobalStoreBar from '@/components/GlobalStore';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <Sidebar />
      <main className="lg:pl-56">
        <div className="max-w-[88rem] mx-auto px-5 sm:px-8 py-7 rise-in">
          <div className="flex justify-end mb-3">
            <GlobalStoreBar />
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
