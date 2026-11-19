import { ButtonHTMLAttributes, ReactNode } from 'react';

export function Btn({ primary, className = '', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      {...p}
      className={`rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-50 ${
        primary ? 'border-blue-600 bg-blue-50 text-slate-900 hover:bg-blue-100' : 'border-slate-300 bg-white hover:bg-slate-50'
      } ${className}`}
    />
  );
}

export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`rounded-xl border border-slate-200 bg-white p-5 ${className}`}>{children}</div>
);

export const inputCls = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';

export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="mb-3 block text-sm">
    <span className="mb-1 block text-slate-600">{label}</span>
    {children}
  </label>
);

const LABEL: Record<string, string> = {
  DRAFT: 'Draft', SHARED: 'Shared', APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested',
  OPEN: 'Open', ANSWERED: 'Answered', CLOSED: 'Closed', ACTIVE: 'Active', ARCHIVED: 'Archived',
  ON_HOLD: 'On hold', COMPLETED: 'Completed',
};
const TONE: Record<string, string> = {
  SHARED: 'border-blue-500 bg-blue-50', APPROVED: 'border-green-600 bg-green-50',
  CHANGES_REQUESTED: 'border-amber-500 bg-amber-50', OPEN: 'border-blue-500 bg-blue-50',
};
export const Pill = ({ status }: { status: string }) => (
  <span className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs ${TONE[status] ?? 'border-slate-300 bg-white text-slate-600'}`}>
    {LABEL[status] ?? status}
  </span>
);

export const ErrorText = ({ text }: { text?: string | null }) =>
  text ? <p role="alert" className="mb-3 text-sm text-red-600">{text}</p> : null;

export const Empty = ({ text }: { text: string }) => <p className="py-4 text-sm text-slate-500">{text}</p>;
