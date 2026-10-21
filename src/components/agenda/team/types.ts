export type TeamItem = {
  kind: "event" | "meeting";
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string | null;
  participantIds: string[];
  contactId: string | null;
  contactName: string | null;
  canceled: boolean;
  restricted: boolean;
  createdBy: string | null;
};

export type TeamEventDetail = {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  location: string | null;
  reminderMinutes: number | null;
  canceledAt: string | null;
  createdAt: string;
  createdBy: string | null;
  createdByName: string | null;
  participants: { userId: string; name: string }[];
  contact: { id: string; name: string; phone: string | null; username: string | null } | null;
  canEdit: boolean;
};

export const REMINDERS: { value: string; label: string }[] = [
  { value: "", label: "Sem lembrete" },
  { value: "0", label: "Na hora" },
  { value: "10", label: "10 minutos antes" },
  { value: "30", label: "30 minutos antes" },
  { value: "60", label: "1 hora antes" },
  { value: "120", label: "2 horas antes" },
  { value: "1440", label: "1 dia antes" },
];

export const reminderLabel = (m: number | null) => REMINDERS.find((r) => r.value === (m == null ? "" : String(m)))?.label ?? `${m} minutos antes`;

export const isLink = (v: string | null | undefined) => !!v && /^https?:\/\//.test(v);
