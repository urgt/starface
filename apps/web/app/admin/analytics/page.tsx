import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";

export const dynamic = "force-dynamic";

export default function AdminAnalyticsPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Analytics (all brands)</h1>
      <AnalyticsDashboard brandId={null} />
    </div>
  );
}
