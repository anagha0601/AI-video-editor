import { Logo } from "@/components/site/Logo";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-grid flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-sm rounded-2xl border bg-card/80 p-6 shadow-2xl backdrop-blur">{children}</div>
    </div>
  );
}
