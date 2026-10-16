import type { Lang } from './business.ts';

export type Contact = {
  id: string;
  wa_id: string;
  name: string | null;
  business_name: string | null;
  country: string | null;
  city: string | null;
  lang: Lang;
  tags: string[];
  status: 'new' | 'lead' | 'customer' | 'lost';
  lead_score: 'hot' | 'warm' | 'cold' | null;
  bot_paused: boolean;
  paused_at: string | null;
  paused_reason: string | null;
  marketing_opt_in: boolean;
  opt_in_at: string | null;
  opt_in_source: string | null;
  opted_out: boolean;
  opted_out_at: string | null;
  flow: 'quote' | 'support' | 'delete_confirm' | null;
  flow_step: string | null;
  flow_data: Record<string, string>;
  after_hours_notified_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Lead = {
  id: string;
  contact_id: string;
  name: string | null;
  business_name: string | null;
  location: string | null;
  country: string | null;
  service: string | null;
  budget: string | null;
  deadline: string | null;
  score: 'hot' | 'warm' | 'cold' | null;
  score_points: number | null;
  status: 'in_progress' | 'complete' | 'won' | 'lost' | 'abandoned';
  campaign_id: string | null;
  nudged_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

/** A customer message, normalised from the Kapso webhook payload. */
export type InboundMessage = {
  waId: string;
  profileName: string;
  wamid: string;
  type: string;
  text: string;        // typed text, or the title of the tapped button/row
  replyId: string;     // id of the tapped interactive button/row, or template button payload
};
