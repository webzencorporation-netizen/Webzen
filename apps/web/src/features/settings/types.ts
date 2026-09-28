export interface BusinessDay {
  weekday: number;
  open: string;
  close: string;
  breaks: { start: string; end: string }[];
}

export interface CompanyProfile {
  id: string;
  name: string;
  status: string;
  templateKey: string;
  templateName: string;
  segment: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  description: string | null;
  address: { street?: string; number?: string; complement?: string; district?: string; city?: string; state?: string; zip?: string; mapsUrl?: string } | null;
  timezone: string;
  businessHours: BusinessDay[];
  holidays: { id: string; date: string; name: string; closed: boolean; open: string | null; close: string | null }[];
  messageRetentionDays: number | null;
}
