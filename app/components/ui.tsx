import React from 'react';

type IconComponent = React.ComponentType<{ className?: string }>;

export function Card({
  children,
  className = '',
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_rgba(15,23,42,0.04)] ${className}`}
    >
      {children}
    </div>
  );
}

const buttonVariants = {
  primary:
    'bg-blue-600 text-white shadow-sm shadow-blue-600/20 hover:bg-blue-700 focus-visible:ring-blue-500',
  secondary:
    'bg-slate-100 text-slate-700 hover:bg-slate-200 focus-visible:ring-slate-400',
  outline:
    'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-slate-400',
  danger:
    'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 focus-visible:ring-red-500',
} as const;

export function Button({
  children,
  onClick,
  variant = 'primary',
  className = '',
  disabled = false,
  type = 'button',
  title,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: keyof typeof buttonVariants;
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
  'aria-label'?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={`inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${buttonVariants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  leading,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  leading?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        {leading}
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h2>
          {description ? (
            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
  className = '',
  label = 'Sections',
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
  label?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={`flex gap-1 overflow-x-auto border-b border-slate-200 ${className}`}
    >
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
              isActive
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  className = '',
}: {
  icon?: IconComponent;
  title: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-10 text-center ${className}`}
    >
      {Icon ? (
        <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm ring-1 ring-slate-200">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      ) : null}
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children ? <div className="mt-1 max-w-md text-sm leading-6 text-slate-500">{children}</div> : null}
    </div>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm"
    >
      <span
        className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
        aria-hidden="true"
      />
      <p className="text-sm font-medium text-slate-600">{label}</p>
    </div>
  );
}

export function Dropzone({
  onActivate,
  icon: Icon,
  title,
  hint,
  tone = 'blue',
  children,
}: {
  onActivate: () => void;
  icon: IconComponent;
  title: string;
  hint?: string;
  tone?: 'blue' | 'emerald';
  children?: React.ReactNode;
}) {
  const toneClass =
    tone === 'emerald'
      ? 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100'
      : 'bg-blue-50 text-blue-600 group-hover:bg-blue-100';
  const hoverClass =
    tone === 'emerald'
      ? 'hover:border-emerald-400 hover:bg-emerald-50/40'
      : 'hover:border-blue-400 hover:bg-blue-50/50';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onActivate();
        }
      }}
      className={`group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50/70 px-6 py-8 text-center transition ${hoverClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2`}
    >
      <span className={`mb-3 flex h-12 w-12 items-center justify-center rounded-2xl transition-colors ${toneClass}`}>
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="font-medium text-slate-800">{title}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      {children}
    </div>
  );
}
