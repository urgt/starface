export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-screen w-screen overflow-hidden bg-black">{children}</div>;
}
