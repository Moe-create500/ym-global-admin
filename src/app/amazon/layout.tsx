import AmazonSidebar from '@/components/AmazonSidebar';

export default function AmazonLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-950">
      <AmazonSidebar />
      <main className="lg:pl-56">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
