export default function KioskLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-[100dvh] w-[100dvw] overflow-hidden bg-black">{children}</div>
  );
}
