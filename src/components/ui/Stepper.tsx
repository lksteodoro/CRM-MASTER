import { Check } from 'lucide-react';
import clsx from 'clsx';

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex w-full items-center">
      {steps.map((label, i) => {
        const stepNumber = i + 1;
        const isDone = stepNumber < current;
        const isActive = stepNumber === current;
        return (
          <div key={label} className="flex flex-1 items-center last:flex-initial">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={clsx(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors',
                  isDone && 'border-[var(--color-brand)] bg-[var(--color-brand)] text-white',
                  isActive && 'border-[var(--color-brand)] text-[var(--color-brand)]',
                  !isDone && !isActive && 'border-[var(--color-border)] text-[var(--color-text-faint)]'
                )}
              >
                {isDone ? <Check size={14} /> : stepNumber}
              </div>
              <span
                className={clsx(
                  'whitespace-nowrap text-[11px]',
                  isActive ? 'font-medium text-[var(--color-text)]' : 'text-[var(--color-text-faint)]'
                )}
              >
                {label}
              </span>
            </div>
            {stepNumber < steps.length && (
              <div
                className={clsx(
                  'mx-2 h-px flex-1',
                  isDone ? 'bg-[var(--color-brand)]' : 'bg-[var(--color-border)]'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
