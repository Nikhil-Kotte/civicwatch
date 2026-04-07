export const SEVERITY_WEIGHT: Record<string, number> = {
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

export const DUPLICATE_RADIUS_KM = 0.25;
export const DUPLICATE_BBOX_DELTA = 0.0025;
export const RESOLUTION_CONFIDENCE_THRESHOLD = 0.6;

export function daysOpen(createdAt?: string | null): number {
  if (!createdAt) return 0;
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.floor((Date.now() - created) / (24 * 60 * 60 * 1000)));
}

export function urgencyScore(report: Record<string, any>): number {
  const severity = SEVERITY_WEIGHT[report.severity] ?? 1;
  const open = daysOpen(report.created_at);
  const base = severity * 10 + Math.min(open, 14) * 2 + (report.upvotes ?? 0);
  return report.status === 'resolved' ? Math.round(base * 0.2) : Math.round(base);
}

export function escalationLevel(status: string, createdAt?: string | null): string {
  if (status === 'resolved') return 'resolved';
  const open = daysOpen(createdAt);
  if (open >= 7) return 'urgent';
  if (open >= 3) return 'firm';
  return 'polite';
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
